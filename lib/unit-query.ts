import type { BloodType, Prisma } from "@prisma/client";
import { BLOOD_TYPE_ORDER, bloodTypeLabel } from "./blood";
import type { Actor } from "./access";

export type UnitFilters = {
  q?: string;
  bloodType?: BloodType;
  component?: "RBC" | "PLASMA" | "PLATELETS";
  status?: "AVAILABLE" | "RESERVED" | "ISSUED" | "RETIRED" | "EXPIRED";
  bankId?: string;
  expiringWithinHours?: number;
};

const LIVE = { status: { in: ["ACTIVE", "DELIVERED"] as ("ACTIVE" | "DELIVERED")[] } };

/** Accepts "ab-", "AB−", "o+", "O_NEG" ... and returns the matching blood types. */
export function bloodTypesMatching(q: string): BloodType[] {
  const norm = (s: string) => s.toLowerCase().replace("−", "-").replace(/\s/g, "");
  const needle = norm(q);
  if (!needle) return [];
  return BLOOD_TYPE_ORDER.filter((t) => norm(bloodTypeLabel(t)) === needle || t.toLowerCase() === needle.replace("-", "_neg").replace("+", "_pos"));
}

/**
 * Where-clause for the inventory list. Derived statuses mirror availableUnitWhere:
 *  EXPIRED   = not retired/issued and past expiry
 *  RESERVED  = unexpired, held by a live reservation
 *  AVAILABLE = unexpired, free
 */
export function buildUnitWhere(actor: Actor, f: UnitFilters, now: Date): Prisma.BloodUnitWhereInput {
  const and: Prisma.BloodUnitWhereInput[] = [];

  // Scope: a bank sees only its own units; admin sees all (and may narrow by bank).
  if (actor.role === "BANK") and.push({ bankId: actor.bankId ?? "__none__" });
  else if (f.bankId) and.push({ bankId: f.bankId });

  if (f.bloodType) and.push({ bloodType: f.bloodType });
  if (f.component) and.push({ component: f.component });

  switch (f.status) {
    case "AVAILABLE":
      and.push({ status: "AVAILABLE", expiresAt: { gt: now }, reservations: { none: LIVE } });
      break;
    case "RESERVED":
      and.push({ status: "AVAILABLE", expiresAt: { gt: now }, reservations: { some: { status: "ACTIVE" } } });
      break;
    case "EXPIRED":
      and.push({ status: "AVAILABLE", expiresAt: { lte: now } });
      break;
    case "ISSUED":
    case "RETIRED":
      and.push({ status: f.status });
      break;
  }

  if (f.expiringWithinHours) {
    and.push({ expiresAt: { gt: now, lte: new Date(now.getTime() + f.expiringWithinHours * 3_600_000) } });
  }

  if (f.q) {
    const types = bloodTypesMatching(f.q);
    and.push({ OR: [{ bank: { name: { contains: f.q, mode: "insensitive" } } }, ...(types.length ? [{ bloodType: { in: types } }] : [])] });
  }
  return and.length ? { AND: and } : {};
}

export function buildUnitOrder(sort: "expiry_asc" | "expiry_desc" | "type" | "newest"): Prisma.BloodUnitOrderByWithRelationInput[] {
  switch (sort) {
    case "expiry_desc": return [{ expiresAt: "desc" }, { id: "asc" }];
    case "type": return [{ bloodType: "asc" }, { component: "asc" }, { expiresAt: "asc" }, { id: "asc" }];
    case "newest": return [{ createdAt: "desc" }, { id: "asc" }];
    default: return [{ expiresAt: "asc" }, { id: "asc" }];
  }
}

/** Derived status for display, consistent with the filters above. */
export function derivedUnitStatus(u: { status: string; expiresAt: Date; hasActiveReservation: boolean }, now: Date) {
  if (u.status === "ISSUED" || u.status === "RETIRED") return u.status;
  if (u.expiresAt <= now) return "EXPIRED";
  return u.hasActiveReservation ? "RESERVED" : "AVAILABLE";
}
