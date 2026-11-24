import { describe, expect, it } from "vitest";
import { FailureLimiter, clientIpFrom } from "@/lib/rate-limit";

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

describe("FailureLimiter", () => {
  it("allows 5 failures then blocks, and unblocks after the window", () => {
    let now = 0;
    const l = new FailureLimiter(5, 60_000, () => now);
    for (let i = 0; i < 5; i++) {
      expect(l.retryAfter("k")).toBe(0);
      l.recordFailure("k");
    }
    expect(l.retryAfter("k")).toBe(60);
    now = 30_000;
    expect(l.retryAfter("k")).toBe(30);
    now = 60_000;
    expect(l.retryAfter("k")).toBe(0);
  });

  it("keys are independent and a success clears the counter", () => {
    const l = new FailureLimiter(2, 60_000, () => 0);
    l.recordFailure("a");
    l.recordFailure("a");
    expect(l.retryAfter("a")).toBeGreaterThan(0);
    expect(l.retryAfter("b")).toBe(0);
    l.clear("a");
    expect(l.retryAfter("a")).toBe(0);
  });
});
