import { describe, expect, it } from "vitest";
import type { RequestStatus } from "@prisma/client";
import { donorEligibility, suggestDonors } from "@/lib/donors";
import { assertTransition, canTransition, isTerminal, TRANSITIONS } from "@/lib/state";
import { HttpError } from "@/lib/errors";
import { distanceKm, transitMinutes } from "@/lib/geo";

const NOW = new Date("2026-11-25T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("donor 90-day cooldown boundaries", () => {
  it.each([
    ["never donated", null, true, 0],
    ["89 days ago", daysAgo(89), false, 1],
    ["exactly 90 days ago", daysAgo(90), true, 0],
    ["91 days ago", daysAgo(91), true, 0],
    ["date in the future (bad data) is ignored", new Date(NOW.getTime() + 5 * 86_400_000), true, 0],
  ])("%s", (_l, last, eligible, days) => {
    expect(donorEligibility(last as Date | null, NOW)).toEqual({ eligible, daysUntilEligible: days });
  });
});

describe("donor suggestions", () => {
  const hospital = { lat: 23.75, lng: 90.39 };
  const donors = [
    { id: "d1", name: "Near O−", bloodType: "O_NEG" as const, lastDonationAt: daysAgo(120), lat: 23.76, lng: 90.39 },
    { id: "d2", name: "Far AB−", bloodType: "AB_NEG" as const, lastDonationAt: null, lat: 23.85, lng: 90.39 },
    { id: "d3", name: "Cooling A−", bloodType: "A_NEG" as const, lastDonationAt: daysAgo(10), lat: 23.75, lng: 90.39 },
    { id: "d4", name: "Rh+ O+", bloodType: "O_POS" as const, lastDonationAt: null, lat: 23.75, lng: 90.39 },
  ];
  it("AB− patient: only eligible Rh− red-cell-compatible donors, nearest first", () => {
    expect(suggestDonors("AB_NEG", hospital, donors, NOW).map((d) => d.id)).toEqual(["d1", "d2"]);
  });
  it("donors are red-cell sources: an O+ patient can be helped by O− and O+ donors only", () => {
    expect(suggestDonors("O_POS", hospital, donors, NOW).map((d) => d.id).sort()).toEqual(["d1", "d4"]);
  });
});

describe("request state machine", () => {
  const all = Object.keys(TRANSITIONS) as RequestStatus[];
  it.each(all.flatMap((f) => all.map((t) => [f, t] as const)))("%s -> %s follows the table", (from, to) => {
    const allowed = TRANSITIONS[from].includes(to);
    expect(canTransition(from, to)).toBe(allowed);
    if (allowed) expect(() => assertTransition(from, to)).not.toThrow();
    else {
      try {
        assertTransition(from, to);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).status).toBe(409);
      }
    }
  });
  it("delivered and cancelled are terminal; cancel after deliver is illegal", () => {
    expect(isTerminal("DELIVERED")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(canTransition("DELIVERED", "CANCELLED")).toBe(false);
  });
});

describe("geo", () => {
  it("distance is symmetric and ~111 km per degree of latitude", () => {
    const a = { lat: 23, lng: 90 }, b = { lat: 24, lng: 90 };
    expect(distanceKm(a, b)).toBeCloseTo(111.2, 0);
    expect(distanceKm(a, b)).toBeCloseTo(distanceKm(b, a), 9);
  });
  it("transit = 30 min handling + 40 km/h", () => expect(transitMinutes(40)).toBe(90));
});
