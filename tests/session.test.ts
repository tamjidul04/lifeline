import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { signSession, verifySession } from "@/lib/session";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-that-is-definitely-longer-than-32-chars";
});

describe("session tokens", () => {
  it("round-trips a session id", async () => {
    const token = await signSession({ sid: "sess_1" });
    expect(await verifySession(token)).toEqual({ sid: "sess_1" });
  });

  it("carries no role or user data (the database is authoritative)", async () => {
    const token = await signSession({ sid: "sess_1" });
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "jti"]);
  });

  it("rejects a tampered token (session id swapped)", async () => {
    const token = await signSession({ sid: "sess_1" });
    const [h, p, s] = token.split(".");
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    payload.jti = "sess_someone_else";
    const forged = [h, Buffer.from(JSON.stringify(payload)).toString("base64url"), s].join(".");
    expect(await verifySession(forged)).toBeNull();
  });

  it("rejects a token signed with another secret", async () => {
    const other = new TextEncoder().encode("some-other-secret-also-longer-than-32-chars!");
    const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setJti("x").setExpirationTime("1h").sign(other);
    expect(await verifySession(token)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const key = new TextEncoder().encode(process.env.SESSION_SECRET);
    const past = Math.floor(Date.now() / 1000) - 60;
    const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setJti("x").setIssuedAt(past - 10).setExpirationTime(past).sign(key);
    expect(await verifySession(token)).toBeNull();
  });

  it("rejects the 'none' algorithm", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ jti: "x", exp: 9999999999 })).toString("base64url");
    expect(await verifySession(`${header}.${body}.`)).toBeNull();
  });

  it("rejects a validly signed token without a session id", async () => {
    const key = new TextEncoder().encode(process.env.SESSION_SECRET);
    const token = await new SignJWT({ role: "ADMIN" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(key);
    expect(await verifySession(token)).toBeNull();
  });

  it("handles missing and garbage tokens", async () => {
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession("not-a-jwt")).toBeNull();
  });
});
