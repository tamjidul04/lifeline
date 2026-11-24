import { describe, expect, it } from "vitest";
import type { Actor } from "@/lib/access";
import {
  assertCanEditUnit,
  assertCanManageRequest,
  assertCanViewRequest,
  assertCanViewUnit,
  requireRole,
} from "@/lib/access";
import { HttpError } from "@/lib/errors";

const base = { name: "x", email: "x@y.z", hospitalId: null, bankId: null, donorId: null };
const admin: Actor = { ...base, id: "a", role: "ADMIN" };
const hospA: Actor = { ...base, id: "ha", role: "HOSPITAL", hospitalId: "H_A" };
const hospB: Actor = { ...base, id: "hb", role: "HOSPITAL", hospitalId: "H_B" };
const bankA: Actor = { ...base, id: "ba", role: "BANK", bankId: "B_A" };
const bankB: Actor = { ...base, id: "bb", role: "BANK", bankId: "B_B" };
const donor: Actor = { ...base, id: "d", role: "DONOR", donorId: "D_1" };

function status(fn: () => void): number | "ok" {
  try {
    fn();
    return "ok";
  } catch (e) {
    if (e instanceof HttpError) return e.status;
    throw e;
  }
}

describe("requireRole", () => {
  it("allows listed roles and forbids others", () => {
    expect(status(() => requireRole(admin, ["ADMIN"]))).toBe("ok");
    expect(status(() => requireRole(donor, ["ADMIN"]))).toBe(403);
  });
});

describe("request visibility (resource isolation)", () => {
  const reqOfA = { hospitalId: "H_A", liveReservingBankIds: ["B_A"] };

  it("owning hospital can view", () => expect(status(() => assertCanViewRequest(hospA, reqOfA))).toBe("ok"));
  it("another hospital gets 404, not 403 (no id probing)", () =>
    expect(status(() => assertCanViewRequest(hospB, reqOfA))).toBe(404));
  it("bank holding a reservation can view", () => expect(status(() => assertCanViewRequest(bankA, reqOfA))).toBe("ok"));
  it("bank with no reservation on it gets 404", () => expect(status(() => assertCanViewRequest(bankB, reqOfA))).toBe(404));
  it("admin can view everything", () => expect(status(() => assertCanViewRequest(admin, reqOfA))).toBe("ok"));
  it("donor gets 404", () => expect(status(() => assertCanViewRequest(donor, reqOfA))).toBe(404));
  it("bank whose reservation was RELEASED loses access (not in live list) -> 404", () =>
    expect(status(() => assertCanViewRequest(bankA, { hospitalId: "H_A", liveReservingBankIds: [] }))).toBe(404));
  it("hospital with a null hospitalId cannot match a request with any id", () => {
    const broken: Actor = { ...base, id: "z", role: "HOSPITAL" };
    expect(status(() => assertCanViewRequest(broken, reqOfA))).toBe(404);
  });
});

describe("request management", () => {
  it("only the owning hospital can manage", () => {
    expect(status(() => assertCanManageRequest(hospA, { hospitalId: "H_A" }))).toBe("ok");
    expect(status(() => assertCanManageRequest(hospB, { hospitalId: "H_A" }))).toBe(404);
    expect(status(() => assertCanManageRequest(admin, { hospitalId: "H_A" }))).toBe(403);
    // Bank may not even know the request exists: 404, not 403.
    expect(status(() => assertCanManageRequest(bankA, { hospitalId: "H_A" }))).toBe(404);
  });
});

describe("unit access", () => {
  const unitOfA = { bankId: "B_A" };
  it("owning bank can view and edit", () => {
    expect(status(() => assertCanViewUnit(bankA, unitOfA))).toBe("ok");
    expect(status(() => assertCanEditUnit(bankA, unitOfA))).toBe("ok");
  });
  it("another bank gets 404 for view and edit", () => {
    expect(status(() => assertCanViewUnit(bankB, unitOfA))).toBe(404);
    expect(status(() => assertCanEditUnit(bankB, unitOfA))).toBe(404);
  });
  it("admin can view but not edit inventory", () => {
    expect(status(() => assertCanViewUnit(admin, unitOfA))).toBe("ok");
    expect(status(() => assertCanEditUnit(admin, unitOfA))).toBe(403);
  });
  it("hospitals and donors cannot see units", () => {
    expect(status(() => assertCanViewUnit(hospA, unitOfA))).toBe(404);
    expect(status(() => assertCanEditUnit(donor, unitOfA))).toBe(404);
  });
});
