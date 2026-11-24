import { describe, expect, it } from "vitest";
import type { BloodType } from "@prisma/client";
import { compatibleTypes, isCompatible, RBC_CAN_RECEIVE, URGENCY_POLICY } from "@/lib/compat";
import { abo, BLOOD_TYPE_ORDER, bloodTypeLabel, isRhNegative } from "@/lib/blood";

// Independent derivation from immunology, used to check every cell of the hand-written tables.
const antigens = (t: BloodType) => new Set(abo(t) === "AB" ? ["A", "B"] : abo(t) === "O" ? [] : [abo(t)]);
const subset = (a: Set<string>, b: Set<string>) => [...a].every((x) => b.has(x));

// RBC: donor cells must not carry an ABO antigen the recipient lacks; Rh− recipients need Rh− cells.
const rbcRule = (donor: BloodType, recipient: BloodType) =>
  subset(antigens(donor), antigens(recipient)) && (!isRhNegative(recipient) || isRhNegative(donor));
// Plasma: donor plasma carries antibodies against antigens the donor lacks, so the donor must have
// every antigen the recipient has. Rh is irrelevant.
const plasmaRule = (donor: BloodType, recipient: BloodType) => subset(antigens(recipient), antigens(donor));

const pairs = BLOOD_TYPE_ORDER.flatMap((r) => BLOOD_TYPE_ORDER.map((d) => [r, d] as const));

describe("RBC table: all 64 cells", () => {
  it.each(pairs)("recipient %s / donor %s matches the immunology rule", (recipient, donor) => {
    expect(RBC_CAN_RECEIVE[recipient].includes(donor)).toBe(rbcRule(donor, recipient));
    expect(isCompatible(donor, recipient, "RBC")).toBe(rbcRule(donor, recipient));
  });

  it("an Rh-negative recipient NEVER receives Rh-positive red cells", () => {
    for (const r of BLOOD_TYPE_ORDER.filter(isRhNegative))
      for (const d of BLOOD_TYPE_ORDER.filter((t) => !isRhNegative(t))) expect(isCompatible(d, r, "RBC")).toBe(false);
  });

  it("O− is the universal red-cell donor and AB+ the universal recipient", () => {
    for (const r of BLOOD_TYPE_ORDER) expect(isCompatible("O_NEG", r, "RBC")).toBe(true);
    for (const d of BLOOD_TYPE_ORDER) expect(isCompatible(d, "AB_POS", "RBC")).toBe(true);
  });

  it("AB− can receive AB−, A−, B−, O− only (the case an earlier review got wrong)", () => {
    expect([...RBC_CAN_RECEIVE.AB_NEG].sort()).toEqual(["AB_NEG", "A_NEG", "B_NEG", "O_NEG"].sort());
    expect(isCompatible("AB_POS", "AB_NEG", "RBC")).toBe(false);
  });

  it("exact match is the identical type; substitutes exclude it", () => {
    for (const r of BLOOD_TYPE_ORDER) {
      const c = compatibleTypes(r, "RBC");
      expect(c.exact).toEqual([r]);
      expect(c.substitutes).not.toContain(r);
    }
  });
});

describe("Plasma table: all 64 cells (reverse direction, Rh ignored)", () => {
  it.each(pairs)("recipient %s / donor %s matches the immunology rule", (recipient, donor) => {
    expect(isCompatible(donor, recipient, "PLASMA")).toBe(plasmaRule(donor, recipient));
  });

  it("AB plasma is universal; O plasma only goes to O", () => {
    for (const r of BLOOD_TYPE_ORDER) expect(isCompatible("AB_POS", r, "PLASMA")).toBe(true);
    expect(isCompatible("O_NEG", "A_POS", "PLASMA")).toBe(false);
    expect(isCompatible("O_POS", "O_NEG", "PLASMA")).toBe(true); // Rh ignored for plasma
  });

  it("exact = same ABO group regardless of Rh", () => {
    expect(compatibleTypes("A_NEG", "PLASMA").exact).toEqual(["A_NEG", "A_POS"]);
  });
});

describe("Platelets", () => {
  it("any type is acceptable; same ABO group is preferred", () => {
    for (const [r, d] of pairs) expect(isCompatible(d, r, "PLATELETS")).toBe(true);
    expect(compatibleTypes("B_POS", "PLATELETS").exact).toEqual(["B_NEG", "B_POS"]);
  });
});

describe("urgency policy and labels", () => {
  it("routine never allows substitutes; critical has no distance cap", () => {
    expect(URGENCY_POLICY.ROUTINE.allowSubstitutes).toBe(false);
    expect(URGENCY_POLICY.CRITICAL.maxSubstituteKm).toBe(Infinity);
  });
  it("labels are human-readable", () => {
    expect(bloodTypeLabel("AB_NEG")).toBe("AB−");
    expect(BLOOD_TYPE_ORDER.map(bloodTypeLabel)).toEqual(["O−", "O+", "A−", "A+", "B−", "B+", "AB−", "AB+"]);
  });
});
