import type { BloodType, Component, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { availableUnitWhere } from "./inventory";
import { donorEligibility } from "./donors";
import { BLOOD_TYPE_ORDER } from "./blood";
import type { Actor } from "./access";

const HOUR = 3_600_000;

export type StockCell = { bloodType: BloodType; component: Component; count: number };

/**
 * Fulfilment rate = delivered / (delivered + released), over CLOSED reservations only.
 * Reservations still ACTIVE are excluded (their outcome is not known yet).
 * Returns null when nothing has closed yet.
 */
export function fulfilmentRate(delivered: number, released: number): number | null {
  const closed = delivered + released;
  return closed === 0 ? null : Math.round((delivered / closed) * 1000) / 10;
}

/** Usable stock grouped by type and component, counted with the single availableUnitWhere definition. */
export async function stockSummary(bankId: string | null, now = new Date()) {
  const where: Prisma.BloodUnitWhereInput = { ...availableUnitWhere(now), ...(bankId ? { bankId } : {}) };
  const [groups, expiring48h, expiring24h] = await Promise.all([
    prisma.bloodUnit.groupBy({ by: ["bloodType", "component"], where, _count: { _all: true } }),
    prisma.bloodUnit.count({ where: { ...where, expiresAt: { gt: now, lte: new Date(now.getTime() + 48 * HOUR) } } }),
    prisma.bloodUnit.count({ where: { ...where, expiresAt: { gt: now, lte: new Date(now.getTime() + 24 * HOUR) } } }),
  ]);
  const cells: StockCell[] = groups
    .map((g) => ({ bloodType: g.bloodType, component: g.component, count: g._count._all }))
    .sort((a, b) => BLOOD_TYPE_ORDER.indexOf(a.bloodType) - BLOOD_TYPE_ORDER.indexOf(b.bloodType) || a.component.localeCompare(b.component));
  return { total: cells.reduce((s, c) => s + c.count, 0), expiringWithin48h: expiring48h, expiringWithin24h: expiring24h, byTypeAndComponent: cells };
}

export async function dashboardFor(actor: Actor, now = new Date()) {
  if (actor.role === "BANK" && actor.bankId) {
    const [stock, awaiting] = await Promise.all([
      stockSummary(actor.bankId, now),
      prisma.reservation.count({ where: { status: "ACTIVE", unit: { bankId: actor.bankId } } }),
    ]);
    return { role: actor.role, stock, reservationsAwaitingDelivery: awaiting };
  }

  if (actor.role === "HOSPITAL" && actor.hospitalId) {
    const groups = await prisma.bloodRequest.groupBy({ by: ["status"], where: { hospitalId: actor.hospitalId }, _count: { _all: true } });
    return { role: actor.role, requestsByStatus: Object.fromEntries(groups.map((g) => [g.status, g._count._all])) };
  }

  if (actor.role === "ADMIN") {
    const [stock, requestGroups, resGroups, users, audits] = await Promise.all([
      stockSummary(null, now),
      prisma.bloodRequest.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.reservation.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
      prisma.auditLog.count(),
    ]);
    const res = Object.fromEntries(resGroups.map((g) => [g.status, g._count._all]));
    return {
      role: actor.role,
      stock,
      requestsByStatus: Object.fromEntries(requestGroups.map((g) => [g.status, g._count._all])),
      reservations: { active: res.ACTIVE ?? 0, delivered: res.DELIVERED ?? 0, released: res.RELEASED ?? 0 },
      fulfilmentRatePercent: fulfilmentRate(res.DELIVERED ?? 0, res.RELEASED ?? 0),
      usersByRole: Object.fromEntries(users.map((g) => [g.role, g._count._all])),
      auditEntries: audits,
    };
  }

  if (actor.role === "DONOR" && actor.donorId) {
    const donor = await prisma.donor.findUniqueOrThrow({ where: { id: actor.donorId } });
    return {
      role: actor.role,
      donor: { bloodType: donor.bloodType, lastDonationAt: donor.lastDonationAt, ...donorEligibility(donor.lastDonationAt, now) },
    };
  }
  return { role: actor.role };
}
