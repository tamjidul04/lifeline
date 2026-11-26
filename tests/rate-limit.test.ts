import { describe, expect, it } from "vitest";
import { clientIpFrom } from "@/lib/rate-limit";
import { ACCOUNT_LIMIT, IP_LIMIT, retryAfterSeconds } from "@/lib/login-limit";

describe("clientIpFrom (spoof resistance)", () => {
  it("prefers the platform-set x-real-ip over a client-sent x-forwarded-for", () => {
    const h = new Headers({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.2.3.4" });
    expect(clientIpFrom(h)).toBe("9.9.9.9");
  });
  it("uses the RIGHT-most x-forwarded-for entry, never the client-controlled left-most", () => {
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 10.0.0.1, 203.0.113.7" });
    expect(clientIpFrom(h)).toBe("203.0.113.7");
  });
  it("falls back to 'local' with no headers", () => {
    expect(clientIpFrom(new Headers())).toBe("local");
  });
});

describe("failed sign-in window", () => {
  const NOW = 10_000_000;
  /** Failure times as seconds ago, newest first. */
  const ago = (...secs: number[]) => secs.map((s) => new Date(NOW - s * 1000));

  it("allows attempts below the limit", () => {
    expect(retryAfterSeconds(ago(1, 2, 3, 4), ACCOUNT_LIMIT, NOW)).toBe(0);
  });
  it("blocks at the 5th failure until the oldest of them is 5 minutes old", () => {
    expect(retryAfterSeconds(ago(1, 2, 3, 4, 60), ACCOUNT_LIMIT, NOW)).toBe(240);
  });
  it("allows again once the window has passed", () => {
    expect(retryAfterSeconds(ago(1, 2, 3, 4, 300), ACCOUNT_LIMIT, NOW)).toBe(0);
  });
  it("limits one address across many accounts", () => {
    expect(IP_LIMIT.max).toBe(30);
    expect(retryAfterSeconds(ago(...Array.from({ length: 29 }, (_, i) => i + 1)), IP_LIMIT, NOW)).toBe(0);
    expect(retryAfterSeconds(ago(...Array.from({ length: 30 }, (_, i) => i + 1)), IP_LIMIT, NOW)).toBeGreaterThan(0);
  });
});
