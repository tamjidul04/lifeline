import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { requestHash } from "@/lib/requests";
import { toErrorResponse } from "@/lib/api";
import { isRetryable } from "@/lib/tx";
import { createRequestSchema, idempotencyKeySchema } from "@/lib/schemas";
import { withPoolDefaults } from "@/lib/db";

describe("connection pool defaults", () => {
  it("raises the pool unless the URL already chose", () => {
    const u = new URL(withPoolDefaults("postgresql://u:p@host/db?sslmode=require&pgbouncer=true")!);
    expect(u.searchParams.get("connection_limit")).toBe("20");
    expect(u.searchParams.get("pool_timeout")).toBe("20");
    expect(u.searchParams.get("pgbouncer")).toBe("true");
    expect(new URL(withPoolDefaults("postgresql://u:p@host/db?connection_limit=3")!).searchParams.get("connection_limit")).toBe("3");
    expect(withPoolDefaults(undefined)).toBeUndefined();
  });
});

const base = { bloodType: "O_POS", component: "RBC", unitsRequested: 2, urgency: "URGENT" } as const;

describe("requestHash (idempotency fingerprint)", () => {
  it("is stable for the same payload", () => expect(requestHash({ ...base })).toBe(requestHash({ ...base })));

  it.each([
    ["bloodType", { bloodType: "O_NEG" }],
    ["component", { component: "PLASMA" }],
    ["unitsRequested", { unitsRequested: 3 }],
    ["urgency", { urgency: "CRITICAL" }],
  ] as const)("changes when %s changes (so key reuse with a different body is a 409)", (_f, patch) => {
    expect(requestHash({ ...base, ...patch })).not.toBe(requestHash(base));
  });
});

describe("request input validation", () => {
  it.each([
    ["0 units", { unitsRequested: 0 }],
    ["21 units", { unitsRequested: 21 }],
    ["fractional units", { unitsRequested: 1.5 }],
    ["units as string", { unitsRequested: "2" }],
    ["unknown component", { component: "WHOLE" }],
    ["unknown urgency", { urgency: "ASAP" }],
  ])("rejects %s", (_l, patch) => expect(createRequestSchema.safeParse({ ...base, ...patch }).success).toBe(false));

  it("accepts the boundaries 1 and 20", () => {
    expect(createRequestSchema.safeParse({ ...base, unitsRequested: 1 }).success).toBe(true);
    expect(createRequestSchema.safeParse({ ...base, unitsRequested: 20 }).success).toBe(true);
  });

  it("Idempotency-Key: UUIDs ok; too short, too long or odd characters rejected", () => {
    expect(idempotencyKeySchema.safeParse(crypto.randomUUID()).success).toBe(true);
    expect(idempotencyKeySchema.safeParse("short").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("x".repeat(129)).success).toBe(false);
    expect(idempotencyKeySchema.safeParse("has spaces in it").success).toBe(false);
  });
});

describe("concurrency error handling", () => {
  const pgErr = (code: string, pg?: string) =>
    new Prisma.PrismaClientKnownRequestError("x", { code, clientVersion: "test", meta: pg ? { code: pg } : undefined });

  it("lock timeout / deadlock / serialization are retried; validation errors are not", () => {
    expect(isRetryable(pgErr("P2010", "55P03"))).toBe(true);
    expect(isRetryable(pgErr("P2010", "40P01"))).toBe(true);
    expect(isRetryable(pgErr("P2034"))).toBe(true);
    expect(isRetryable(pgErr("P2002"))).toBe(true);
    expect(isRetryable(pgErr("P2010", "23514"))).toBe(false); // CHECK violation: retrying cannot help
    expect(isRetryable(new Error("boom"))).toBe(false);
  });

  it("a full connection pool is retried and reported as BUSY (not 'database unreachable', not 500)", async () => {
    for (const e of [pgErr("P2024"), new Error("Timed out fetching a new connection from the connection pool. More info")]) {
      expect(isRetryable(e)).toBe(true);
      const res = toErrorResponse(e);
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe("BUSY");
    }
  });

  it("an unreachable database is still reported as DB_UNAVAILABLE and not retried as busy", async () => {
    const res = toErrorResponse(pgErr("P1001"));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("DB_UNAVAILABLE");
  });

  it("still-contended after retries -> 503 BUSY with Retry-After, never a raw 500", async () => {
    const res = toErrorResponse(pgErr("P2010", "55P03"));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("2");
    expect((await res.json()).error.code).toBe("BUSY");
  });
});
