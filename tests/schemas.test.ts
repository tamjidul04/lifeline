import { describe, expect, it } from "vitest";
import { createStaffSchema, loginSchema, registerSchema } from "@/lib/schemas";

describe("email normalisation", () => {
  it("trims and lowercases so case variants collide on the unique index", () => {
    expect(loginSchema.parse({ email: "  Admin@LifeLine.Demo ", password: "x" }).email).toBe("admin@lifeline.demo");
  });
  it("rejects malformed emails", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });
});

describe("registration", () => {
  const ok = { name: "Ann Donor", email: "ann@example.com", password: "secret123", bloodType: "O_NEG" };

  it("accepts a valid donor", () => expect(registerSchema.safeParse(ok).success).toBe(true));

  it("ignores a smuggled role field (cannot self-register as ADMIN)", () => {
    const parsed = registerSchema.parse({ ...ok, role: "ADMIN" });
    expect("role" in parsed).toBe(false);
  });

  it.each([
    ["short password", { password: "a1" }],
    ["password without number", { password: "abcdefgh" }],
    ["password without letter", { password: "12345678" }],
    ["password over bcrypt limit", { password: "a1".repeat(40) }],
    ["invalid blood type", { bloodType: "AB" }],
    ["lowercase blood type", { bloodType: "o_neg" }],
    ["1-char name", { name: "A" }],
    ["latitude out of range", { lat: 91 }],
    ["latitude as string", { lat: "23.7" }],
  ])("rejects %s", (_label, patch) => {
    expect(registerSchema.safeParse({ ...ok, ...patch }).success).toBe(false);
  });
});

describe("staff creation", () => {
  const ok = { name: "Bank Lead", email: "b@x.com", password: "secret123", role: "BANK", orgName: "Bank X", lat: 1, lng: 2 };
  it("accepts BANK and HOSPITAL", () => {
    expect(createStaffSchema.safeParse(ok).success).toBe(true);
    expect(createStaffSchema.safeParse({ ...ok, role: "HOSPITAL" }).success).toBe(true);
  });
  it("refuses to create ADMIN or DONOR through the staff endpoint", () => {
    expect(createStaffSchema.safeParse({ ...ok, role: "ADMIN" }).success).toBe(false);
    expect(createStaffSchema.safeParse({ ...ok, role: "DONOR" }).success).toBe(false);
  });
});
