import { describe, expect, it } from "vitest";
import type { BloodType, Component, Urgency } from "@prisma/client";
import { planAllocation, type CandidateUnit, type RequestSpec } from "@/lib/rules";
import { compatibleTypes, isCompatible, URGENCY_POLICY } from "@/lib/compat";
import { BLOOD_TYPE_ORDER } from "@/lib/blood";
import { distanceKm, transitMinutes } from "@/lib/geo";

const NOW = new Date("2026-11-25T12:00:00Z");
const H = 3_600_000;
const HOSPITAL = { lat: 23.75, lng: 90.39 };
const BANKS = {
  near: { bankId: "near", bankName: "Near Bank", bankLat: 23.75, bankLng: 90.39 }, // 0 km
  mid: { bankId: "mid", bankName: "Mid Bank", bankLat: 23.75 + 0.27, bankLng: 90.39 }, // ~30 km
  far: { bankId: "far", bankName: "Far Bank", bankLat: 23.75 + 0.55, bankLng: 90.39 }, // ~61 km
};

let seq = 0;
function unit(bloodType: BloodType, hoursLeft: number, bank: keyof typeof BANKS = "near", component: Component = "RBC"): CandidateUnit {
  return { id: `u${String(++seq).padStart(3, "0")}`, ...BANKS[bank], bloodType, component, expiresAt: new Date(NOW.getTime() + hoursLeft * H) };
}
const req = (bloodType: BloodType, units: number, urgency: Urgency, component: Component = "RBC"): RequestSpec => ({
  bloodType, component, units, urgency, hospital: HOSPITAL,
});
const plan = (r: RequestSpec, c: CandidateUnit[], donors = undefined as Parameters<typeof planAllocation>[2]["donors"]) =>
  planAllocation(r, c, { now: NOW, donors });

describe("hard constraints", () => {
  it("prefers the exact type over the universal donor", () => {
    const p = plan(req("O_POS", 1, "CRITICAL"), [unit("O_NEG", 100), unit("O_POS", 100)]);
    expect(p.picks.map((x) => x.bloodType)).toEqual(["O_POS"]);
  });

  it("AB− critical with only O− and AB+ in stock: uses O−, never AB+", () => {
    const p = plan(req("AB_NEG", 2, "CRITICAL"), [unit("O_NEG", 100), unit("AB_POS", 100)]);
    expect(p.status).toBe("PARTIAL");
    expect(p.picks.map((x) => x.bloodType)).toEqual(["O_NEG"]);
    expect(p.rejections.INCOMPATIBLE_TYPE).toBe(1);
  });

  it("never allocates the wrong component", () => {
    const p = plan(req("A_POS", 1, "CRITICAL", "PLASMA"), [unit("A_POS", 100)]);
    expect(p.status).toBe("UNFULFILLABLE");
    expect(p.rejections.WRONG_COMPONENT).toBe(1);
  });

  it("plasma follows the reverse table: O patient may get AB plasma, AB patient may not get O plasma", () => {
    expect(plan(req("O_POS", 1, "CRITICAL", "PLASMA"), [unit("AB_NEG", 5000, "near", "PLASMA")]).status).toBe("MATCHED");
    expect(plan(req("AB_POS", 1, "CRITICAL", "PLASMA"), [unit("O_POS", 5000, "near", "PLASMA")]).status).toBe("UNFULFILLABLE");
  });

  it("expiry boundary: a unit expiring exactly now is expired", () => {
    const p = plan(req("O_POS", 1, "CRITICAL"), [unit("O_POS", 0), unit("O_POS", -1)]);
    expect(p.rejections.EXPIRED).toBe(2);
  });

  it("rejects a unit that would expire before the courier can deliver it", () => {
    const km = distanceKm(HOSPITAL, { lat: BANKS.far.bankLat, lng: BANKS.far.bankLng });
    const transitH = transitMinutes(km) / 60;
    const p = plan(req("O_POS", 2, "CRITICAL"), [unit("O_POS", transitH - 0.1, "far"), unit("O_POS", transitH + 0.5, "far")]);
    expect(p.rejections.EXPIRES_BEFORE_ARRIVAL).toBe(1);
    expect(p.picks).toHaveLength(1);
  });
});

describe("urgency policy", () => {
  it("ROUTINE with only substitute stock -> UNFULFILLABLE, explains the conflict, suggests URGENT", () => {
    const p = plan(req("A_POS", 1, "ROUTINE"), [unit("O_NEG", 100), unit("A_NEG", 100)]);
    expect(p.status).toBe("UNFULFILLABLE");
    expect(p.summary).toMatch(/Conflicting constraints/);
    expect(p.rejections.SUBSTITUTE_NOT_ALLOWED).toBe(2);
    const raise = p.alternatives.find((a) => a.kind === "RAISE_URGENCY");
    expect(raise && raise.kind === "RAISE_URGENCY" && raise.urgency).toBe("URGENT");
  });

  it("URGENT allows substitutes within 50 km only; CRITICAL at any distance", () => {
    const stock = [unit("O_NEG", 100, "mid"), unit("O_NEG", 100, "far")];
    expect(plan(req("A_POS", 2, "URGENT"), stock).picks.map((x) => x.bankId)).toEqual(["mid"]);
    expect(plan(req("A_POS", 2, "CRITICAL"), stock).picks).toHaveLength(2);
  });

  it("ROUTINE exact match beyond 50 km -> TOO_FAR with a 'farther banks' alternative", () => {
    const p = plan(req("B_POS", 1, "ROUTINE"), [unit("B_POS", 300, "far")]);
    expect(p.rejections.TOO_FAR).toBe(1);
    const far = p.alternatives.find((a) => a.kind === "FARTHER_BANKS");
    expect(far && far.kind === "FARTHER_BANKS" && far.banks[0].bankId).toBe("far");
  });
});

describe("ranking and optimisation", () => {
  it("first-expiry-first-out among equivalent units", () => {
    const p = plan(req("O_POS", 1, "ROUTINE"), [unit("O_POS", 300), unit("O_POS", 30), unit("O_POS", 600)]);
    expect(p.picks[0].hoursLeft).toBe(30);
    expect(p.picks[0].reason).toMatch(/exact match/);
  });

  it("PARTIAL reserves what exists and reports the shortfall", () => {
    const p = plan(req("O_POS", 5, "ROUTINE"), [unit("O_POS", 100), unit("O_POS", 200)]);
    expect(p.status).toBe("PARTIAL");
    expect(p.picks).toHaveLength(2);
    expect(p.alternatives[0]).toMatchObject({ kind: "PARTIAL_NOW", units: 2 });
  });

  it("local search swaps a unit to save a whole delivery when the trade-off is worth it", () => {
    // Greedy picks the two best units, one per bank. One swap puts both on the same bank.
    const a1 = unit("O_POS", 30, "near");
    const b1 = { ...unit("O_POS", 40, "near"), bankId: "other", bankName: "Other Bank", bankLat: 23.75 + 0.18 }; // ~20 km
    const a2 = unit("O_POS", 200, "near");
    const p = plan(req("O_POS", 2, "ROUTINE"), [a1, b1, a2]);
    expect(new Set(p.picks.map((x) => x.bankId))).toEqual(new Set(["near"]));
    expect(p.swaps).toHaveLength(1);
    expect(p.swaps[0]).toMatch(/fewer banks/);
  });

  it("does NOT swap when saving a delivery would waste a unit about to expire", () => {
    // Swapping b1 for a2 would save one delivery (+0.25), but b1 expires in 12h and a2 has
    // ~6 weeks left: losing b1's expiry priority costs more (~0.34). FEFO wins, two banks deliver.
    const a1 = unit("O_POS", 10, "near");
    const b1 = { ...unit("O_POS", 12, "near"), bankId: "other", bankName: "Other Bank" };
    const a2 = unit("O_POS", 1000, "near");
    const p = plan(req("O_POS", 2, "CRITICAL"), [a1, b1, a2]);
    expect(p.swaps).toHaveLength(0);
    expect(p.picks.map((x) => x.unitId).sort()).toEqual([a1.id, b1.id].sort());
  });

  it("is deterministic: shuffled input gives identical output", () => {
    const stock = BLOOD_TYPE_ORDER.flatMap((t, i) => [unit(t, 20 + i * 13, "near"), unit(t, 50 + i * 7, "mid")]);
    const r = req("AB_POS", 6, "CRITICAL");
    const a = plan(r, stock);
    const b = plan(r, [...stock].reverse());
    const c = plan(r, [...stock].sort((x, y) => x.bloodType.localeCompare(y.bloodType)));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
  });
});

describe("infeasible requests get useful alternatives", () => {
  it("AB− with no stock suggests eligible compatible donors, nearest first, skipping Rh+ and cooling-off donors", () => {
    const donors = [
      { id: "d1", name: "O− donor", bloodType: "O_NEG" as const, lastDonationAt: null, lat: 23.76, lng: 90.39 },
      { id: "d2", name: "AB+ donor", bloodType: "AB_POS" as const, lastDonationAt: null, lat: 23.75, lng: 90.39 },
      { id: "d3", name: "A− cooling", bloodType: "A_NEG" as const, lastDonationAt: new Date(NOW.getTime() - 10 * 86_400_000), lat: 23.75, lng: 90.39 },
    ];
    const p = plan(req("AB_NEG", 3, "CRITICAL"), [], donors);
    expect(p.status).toBe("UNFULFILLABLE");
    const call = p.alternatives.find((a) => a.kind === "CALL_DONORS");
    expect(call && call.kind === "CALL_DONORS" && call.donors.map((d) => d.id)).toEqual(["d1"]);
  });
});

describe("regressions from review C", () => {
  it("C-2: a unit id repeated in the input is never allocated twice", () => {
    const x = unit("O_POS", 100);
    const p = plan(req("O_POS", 2, "ROUTINE"), [x, { ...x }, { ...x }]);
    expect(p.picks.map((k) => k.unitId)).toEqual([x.id]);
    expect(p.status).toBe("PARTIAL");
  });

  it("C-4: no donor suggestions for plasma or platelet shortfalls (donors give red cells)", () => {
    const donors = [{ id: "d", name: "AB− donor", bloodType: "AB_NEG" as const, lastDonationAt: null, lat: 23.75, lng: 90.39 }];
    for (const c of ["PLASMA", "PLATELETS"] as const) {
      const p = plan(req("AB_POS", 1, "CRITICAL", c), [], donors);
      expect(p.alternatives.some((a) => a.kind === "CALL_DONORS")).toBe(false);
    }
    const rbc = plan(req("AB_POS", 1, "CRITICAL", "RBC"), [], donors);
    expect(rbc.alternatives.some((a) => a.kind === "CALL_DONORS")).toBe(true);
  });
});

describe("safety property (randomised, seeded)", () => {
  // Deterministic PRNG so failures are reproducible.
  let s = 42;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pickOf = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];

  it("500 random requests: never incompatible, expired, duplicated, over-allocated or against urgency policy", () => {
    const comps: Component[] = ["RBC", "PLASMA", "PLATELETS"];
    const urgencies: Urgency[] = ["ROUTINE", "URGENT", "CRITICAL"];
    for (let i = 0; i < 500; i++) {
      const r = req(pickOf(BLOOD_TYPE_ORDER), 1 + Math.floor(rnd() * 6), pickOf(urgencies), pickOf(comps));
      const base = Array.from({ length: Math.floor(rnd() * 25) }, () =>
        unit(pickOf(BLOOD_TYPE_ORDER), rnd() * 400 - 50, pickOf(["near", "mid", "far"] as const), pickOf(comps)),
      );
      // Sometimes repeat units to prove duplicates can never be double-allocated.
      const stock = rnd() < 0.3 ? [...base, ...base.slice(0, 5)] : base;
      const p = plan(r, stock);
      expect(p.picks.length).toBeLessThanOrEqual(r.units);
      expect(new Set(p.picks.map((x) => x.unitId)).size).toBe(p.picks.length);
      for (const pick of p.picks) {
        const u = stock.find((x) => x.id === pick.unitId)!;
        expect(u.component).toBe(r.component);
        expect(isCompatible(u.bloodType, r.bloodType, r.component)).toBe(true);
        expect(u.expiresAt.getTime()).toBeGreaterThan(NOW.getTime());
        const exact = compatibleTypes(r.bloodType, r.component).exact.includes(u.bloodType);
        const policy = URGENCY_POLICY[r.urgency];
        if (!exact) expect(policy.allowSubstitutes).toBe(true);
        expect(pick.km).toBeLessThanOrEqual((exact ? policy.maxExactKm : policy.maxSubstituteKm) + 0.05);
      }
      const expected = p.picks.length === r.units ? "MATCHED" : p.picks.length ? "PARTIAL" : "UNFULFILLABLE";
      expect(p.status).toBe(expected);
    }
  });
});
