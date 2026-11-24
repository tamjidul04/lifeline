import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Never wait forever for a row lock: give up after 8s (error 55P03, retried by withTxRetry). */
export const LOCK_TIMEOUT = "8s";

export async function setLockTimeout(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT set_config('lock_timeout', ${LOCK_TIMEOUT}, true)`;
}

// Postgres: serialization failure, deadlock detected, lock not available.
const RETRYABLE_PG_CODES = new Set(["40001", "40P01", "55P03"]);

/** Errors where re-running the whole transaction from scratch is safe and may succeed. */
export function isRetryable(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  // P2034 write conflict/deadlock, P2028 transaction API error (e.g. timed out),
  // P2002 unique violation (the one-live-reservation index caught a race we lost).
  if (["P2034", "P2028", "P2002"].includes(err.code)) return true;
  if (err.code === "P2010") return RETRYABLE_PG_CODES.has(String((err.meta as { code?: string } | undefined)?.code));
  return false;
}

/**
 * Run a transaction, retrying transient concurrency failures with jittered exponential backoff.
 * Each attempt is a fresh transaction (the failed one was rolled back), so retries are safe.
 */
export async function withTxRetry<T>(run: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await run();
    } catch (err) {
      if (i >= attempts || !isRetryable(err)) throw err;
      const delay = 40 * 2 ** (i - 1) + Math.floor(Math.random() * 40);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted };
