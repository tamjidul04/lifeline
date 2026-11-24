/**
 * Fixed-window counter of FAILED login attempts.
 * In-memory: on serverless each instance has its own map, so this slows brute force but is not a
 * global guarantee. Documented limitation (a shared store such as Redis would fix it).
 */
export class FailureLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max = 5,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Seconds until the key may try again, or 0 if allowed. */
  retryAfter(key: string): number {
    const entry = this.hits.get(key);
    if (!entry) return 0;
    const t = this.now();
    if (t >= entry.resetAt) {
      this.hits.delete(key);
      return 0;
    }
    return entry.count >= this.max ? Math.ceil((entry.resetAt - t) / 1000) : 0;
  }

  recordFailure(key: string): void {
    const t = this.now();
    const entry = this.hits.get(key);
    if (!entry || t >= entry.resetAt) this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
    else entry.count++;
  }

  clear(key: string): void {
    this.hits.delete(key);
  }
}

/** One account from one source: 5 failures per 5 minutes (short, so a fumbled demo login recovers fast). */
export const accountLimiter = new FailureLimiter(5, 5 * 60 * 1000);
/** One source across ALL emails: stops password spraying (1 guess each against many accounts). */
export const ipLimiter = new FailureLimiter(30, 15 * 60 * 1000);

/**
 * Client IP that the client cannot forge on Vercel: x-real-ip and x-vercel-forwarded-for are set
 * by the platform. Falls back to the RIGHT-most x-forwarded-for entry (appended by the nearest
 * proxy); the left-most entry is client-controlled and must never be trusted.
 */
export function clientIpFrom(headers: Headers): string {
  const real = headers.get("x-real-ip") ?? headers.get("x-vercel-forwarded-for");
  if (real) return real.split(",")[0].trim();
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",").at(-1)!.trim();
  return "local";
}
