import { prisma } from "./db";

/**
 * Failed sign-in limits, counted from the audit log in the database so that every server instance
 * shares the same count (a per-instance memory counter lets attempts spread across instances).
 * Limitation: attempts sent at exactly the same moment are all checked before any is recorded,
 * so a parallel burst can slip a few past the limit.
 */
export const ACCOUNT_LIMIT = { max: 5, windowMs: 5 * 60 * 1000 }; // one email from one address
export const IP_LIMIT = { max: 30, windowMs: 15 * 60 * 1000 }; // one address across all emails (spraying)

/**
 * Seconds to wait before another attempt, or 0 if allowed.
 * `recent` holds the times of the failures inside the window, newest first, at most `max` of them.
 */
export function retryAfterSeconds(recent: readonly Date[], limit: { max: number; windowMs: number }, now: number): number {
  if (recent.length < limit.max) return 0;
  // Allowed again once the oldest of the last `max` failures leaves the window.
  const oldest = recent[limit.max - 1].getTime();
  return Math.max(0, Math.ceil((oldest + limit.windowMs - now) / 1000));
}

export async function loginRetryAfter(email: string, ip: string, now = Date.now()): Promise<number> {
  const accountStart = new Date(now - ACCOUNT_LIMIT.windowMs);
  const fromIp = { detail: { path: ["ip"], equals: ip } };

  // A successful sign-in clears the account counter.
  const lastSuccess = await prisma.auditLog.findFirst({
    where: { action: "LOGIN", actorLabel: email, createdAt: { gt: accountStart } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const [account, address] = await Promise.all([
    prisma.auditLog.findMany({
      where: { action: "LOGIN_FAILED", actorLabel: email, createdAt: { gt: lastSuccess?.createdAt ?? accountStart }, ...fromIp },
      orderBy: { createdAt: "desc" },
      take: ACCOUNT_LIMIT.max,
      select: { createdAt: true },
    }),
    prisma.auditLog.findMany({
      where: { action: "LOGIN_FAILED", createdAt: { gt: new Date(now - IP_LIMIT.windowMs) }, ...fromIp },
      orderBy: { createdAt: "desc" },
      take: IP_LIMIT.max,
      select: { createdAt: true },
    }),
  ]);

  return Math.max(
    retryAfterSeconds(account.map((r) => r.createdAt), ACCOUNT_LIMIT, now),
    retryAfterSeconds(address.map((r) => r.createdAt), IP_LIMIT, now),
  );
}
