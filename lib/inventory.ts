import type { Prisma } from "@prisma/client";

/**
 * THE definition of "available stock". Every query that counts or lists usable units MUST use
 * this, never `status: "AVAILABLE"` alone, because:
 * - expiry is derived from expiresAt (there is no EXPIRED status), and
 * - a reserved unit keeps status AVAILABLE; the live Reservation row is what holds it.
 * The `reservations: { none: ... }` clause is load-bearing (there is no RESERVED status).
 * Removing it would make reserved units look available again.
 */
export function availableUnitWhere(now: Date): Prisma.BloodUnitWhereInput {
  return {
    status: "AVAILABLE",
    expiresAt: { gt: now },
    reservations: { none: { status: { in: ["ACTIVE", "DELIVERED"] } } },
  };
}
