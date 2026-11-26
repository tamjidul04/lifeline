import { describe, expect, it } from "vitest";
import type { Actor } from "@/lib/access";
import { bloodTypesMatching, buildUnitOrder, buildUnitWhere, derivedUnitStatus } from "@/lib/unit-query";
import { fulfilmentRate } from "@/lib/stats";
import { createUnitSchema, listUnitsSchema, updateUnitSchema } from "@/lib/schemas";

const NOW = new Date("2026-11-25T12:00:00Z");
const base = { name: "x", email: "x@y.z", hospitalId: null, donorId: null };
const bankA: Actor = { ...base, id: "u1", role: "BANK", bankId: "BANK_A" };
const admin: Actor = { ...base, id: "u2", role: "ADMIN", bankId: null };

describe("unit scope", () => {
  it("a bank can only ever query its own bank, even if it asks for another", () => {
    const w = JSON.stringify(buildUnitWhere(bankA, { bankId: "BANK_B" }, NOW));
    expect(w).toContain("BANK_A");
    expect(w).not.toContain("BANK_B");
  });
  it("admin can narrow to a bank", () => {
    expect(JSON.stringify(buildUnitWhere(admin, { bankId: "BANK_B" }, NOW))).toContain("BANK_B");
  });
  it("a bank with no bankId matches nothing", () => {
    const broken: Actor = { ...base, id: "u3", role: "BANK", bankId: null };
    expect(JSON.stringify(buildUnitWhere(broken, {}, NOW))).toContain("__none__");
  });
});

describe("derived status filters mirror availableUnitWhere", () => {
  it("AVAILABLE excludes expired and live-reserved units", () => {
    const w = JSON.stringify(buildUnitWhere(admin, { status: "AVAILABLE" }, NOW));
    expect(w).toContain('"expiresAt":{"gt"');
    expect(w).toContain('"reservations":{"none"');
  });
  it("EXPIRED = still marked available but past expiry", () => {
    expect(JSON.stringify(buildUnitWhere(admin, { status: "EXPIRED" }, NOW))).toContain('"lte"');
  });
  it("derivedUnitStatus", () => {
    const future = new Date(NOW.getTime() + 3_600_000), past = new Date(NOW.getTime() - 1);
    expect(derivedUnitStatus({ status: "AVAILABLE", expiresAt: future, hasActiveReservation: false }, NOW)).toBe("AVAILABLE");
    expect(derivedUnitStatus({ status: "AVAILABLE", expiresAt: future, hasActiveReservation: true }, NOW)).toBe("RESERVED");
    expect(derivedUnitStatus({ status: "AVAILABLE", expiresAt: past, hasActiveReservation: false }, NOW)).toBe("EXPIRED");
    expect(derivedUnitStatus({ status: "ISSUED", expiresAt: past, hasActiveReservation: false }, NOW)).toBe("ISSUED");
    expect(derivedUnitStatus({ status: "RETIRED", expiresAt: future, hasActiveReservation: false }, NOW)).toBe("RETIRED");
  });
});

describe("search and sort", () => {
  it.each([["ab-", ["AB_NEG"]], ["AB−", ["AB_NEG"]], ["o+", ["O_POS"]], ["O_NEG", ["O_NEG"]], ["a", []], ["riverside", []]])(
    "blood type search %s",
    (q, expected) => expect(bloodTypesMatching(q)).toEqual(expected),
  );
  it("sorts are deterministic (id tie-break)", () => {
    for (const s of ["expiry_asc", "expiry_desc", "type", "newest"] as const) {
      expect(JSON.stringify(buildUnitOrder(s))).toContain('"id":"asc"');
    }
  });
  it("combined filters are ANDed", () => {
    const w = buildUnitWhere(admin, { bloodType: "O_POS", component: "RBC", expiringWithinHours: 48, q: "central" }, NOW);
    expect((w as { AND: unknown[] }).AND.length).toBe(4);
  });
});

describe("fulfilment rate (delivered / (delivered + released); active excluded)", () => {
  it.each([[0, 0, null], [3, 1, 75], [0, 4, 0], [5, 0, 100], [1, 2, 33.3]])("%i delivered, %i released -> %s", (d, r, e) =>
    expect(fulfilmentRate(d, r)).toBe(e),
  );
});

describe("input validation", () => {
  it("rejects past, malformed and absurd expiry; bad quantities", () => {
    const ok = { bloodType: "O_POS", component: "RBC", quantity: 2, expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
    expect(createUnitSchema.safeParse(ok).success).toBe(true);
    expect(createUnitSchema.safeParse({ ...ok, expiresAt: "2020-01-01T00:00:00Z" }).success).toBe(false);
    expect(createUnitSchema.safeParse({ ...ok, expiresAt: "tomorrow" }).success).toBe(false);
    expect(createUnitSchema.safeParse({ ...ok, expiresAt: "2099-01-01T00:00:00Z" }).success).toBe(false);
    expect(createUnitSchema.safeParse({ ...ok, quantity: 0 }).success).toBe(false);
    expect(createUnitSchema.safeParse({ ...ok, quantity: 51 }).success).toBe(false);
  });
  it("list params are bounded", () => {
    expect(listUnitsSchema.safeParse({ pageSize: "1000" }).success).toBe(false);
    expect(listUnitsSchema.safeParse({ page: "0" }).success).toBe(false);
    expect(listUnitsSchema.safeParse({ sort: "random" }).success).toBe(false);
    expect(listUnitsSchema.parse({}).pageSize).toBe(25);
  });
});

describe("unit update validation", () => {
  const later = () => new Date(Date.now() + 86_400_000).toISOString();
  it("accepts a full edit and a retire", () => {
    expect(updateUnitSchema.safeParse({ action: "EDIT", version: 0, bloodType: "O_POS", component: "RBC", expiresAt: later() }).success).toBe(true);
    expect(updateUnitSchema.safeParse({ action: "RETIRE", version: 3 }).success).toBe(true);
  });
  it("rejects unknown actions, a missing version and a past expiry, and strips a smuggled status", () => {
    expect(updateUnitSchema.safeParse({ action: "DELETE", version: 0 }).success).toBe(false);
    expect(updateUnitSchema.safeParse({ action: "RETIRE" }).success).toBe(false);
    expect(updateUnitSchema.safeParse({ action: "EDIT", version: 0, bloodType: "O_POS", component: "RBC", expiresAt: "2020-01-01T00:00:00Z" }).success).toBe(false);
    const parsed = updateUnitSchema.parse({ action: "EDIT", version: 0, bloodType: "O_POS", component: "RBC", expiresAt: later(), status: "ISSUED" });
    expect("status" in parsed).toBe(false);
  });
});
