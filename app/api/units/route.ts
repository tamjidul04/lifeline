import { prisma } from "@/lib/db";
import { handle, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { createUnitSchema, listUnitsSchema } from "@/lib/schemas";
import { buildUnitOrder, buildUnitWhere, derivedUnitStatus } from "@/lib/unit-query";
import { forbidden } from "@/lib/errors";
import { audit } from "@/lib/audit";

/**
 * Inventory list with search (bank name or blood type), filters (type, component, status, bank,
 * expiring soon), sorting and pagination. BANK sees its own units; ADMIN sees all (read-only).
 */
export const GET = handle(async (req) => {
  const actor = await requireUser(["BANK", "ADMIN"]);
  const q = listUnitsSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const now = new Date();
  const where = buildUnitWhere(actor, q, now);

  const [total, units] = await Promise.all([
    prisma.bloodUnit.count({ where }),
    prisma.bloodUnit.findMany({
      where,
      orderBy: buildUnitOrder(q.sort),
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { bank: { select: { id: true, name: true } }, reservations: { where: { status: "ACTIVE" }, select: { id: true, requestId: true } } },
    }),
  ]);

  return {
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    units: units.map((u) => ({
      id: u.id,
      bloodType: u.bloodType,
      component: u.component,
      expiresAt: u.expiresAt,
      hoursLeft: Math.round(((u.expiresAt.getTime() - now.getTime()) / 3_600_000) * 10) / 10,
      status: derivedUnitStatus({ status: u.status, expiresAt: u.expiresAt, hasActiveReservation: u.reservations.length > 0 }, now),
      version: u.version,
      bank: u.bank,
      reservedForRequestId: u.reservations[0]?.requestId ?? null,
    })),
  };
});

/** A bank adds stock (1-50 identical units with one expiry). Admin is read-only on inventory. */
export const POST = handle(async (req) => {
  const actor = await requireUser(["BANK", "ADMIN"]);
  if (actor.role !== "BANK" || !actor.bankId) throw forbidden();
  const input = createUnitSchema.parse(await readJson(req));

  const bankId = actor.bankId;
  const created = await prisma.$transaction(async (tx) => {
    await tx.bloodUnit.createMany({
      data: Array.from({ length: input.quantity }, () => ({ bankId, bloodType: input.bloodType, component: input.component, expiresAt: input.expiresAt })),
    });
    await audit(
      {
        actorId: actor.id, actorLabel: actor.email, action: "UNITS_ADDED", entity: "BloodUnit",
        detail: { bankId, bloodType: input.bloodType, component: input.component, quantity: input.quantity, expiresAt: input.expiresAt.toISOString() },
      },
      tx,
    );
    return input.quantity;
  });
  return Response.json({ added: created }, { status: 201 });
});
