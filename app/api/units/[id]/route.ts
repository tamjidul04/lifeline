import { prisma } from "@/lib/db";
import { handle, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { updateUnitSchema } from "@/lib/schemas";
import { assertCanEditUnit, assertCanViewUnit } from "@/lib/access";
import { conflict, notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req, { params }: Ctx) => {
  const actor = await requireUser(["ADMIN", "BANK"]);
  const { id } = await params;
  const unit = await prisma.bloodUnit.findUnique({ where: { id } });
  if (!unit) throw notFound("Blood unit");
  assertCanViewUnit(actor, unit);
  return { unit };
});

/**
 * Correct a unit's details (EDIT) or retire it (units are never deleted).
 * Optimistic concurrency via `version`. Only a free unit may change:
 *  - held or issued units are refused, so a reserved bag cannot be altered under a hospital;
 *  - an EXPIRED unit cannot be edited (a new date must never bring expired blood back), only retired.
 */
export const PATCH = handle(async (req, { params }: Ctx) => {
  const actor = await requireUser(["BANK", "ADMIN"]);
  const { id } = await params;
  const input = updateUnitSchema.parse(await readJson(req));

  const unit = await prisma.bloodUnit.findUnique({ where: { id } });
  if (!unit) throw notFound("Blood unit");
  assertCanEditUnit(actor, unit);
  if (input.action === "EDIT" && unit.expiresAt <= new Date()) {
    throw conflict("An expired unit cannot be edited. Retire it instead.", "UNIT_EXPIRED");
  }

  return prisma.$transaction(async (tx) => {
    const change =
      input.action === "EDIT"
        ? { bloodType: input.bloodType, component: input.component, expiresAt: input.expiresAt }
        : { status: "RETIRED" as const };

    // Compare-and-set FIRST: only succeeds if nobody changed the unit since the client read it.
    // This UPDATE also takes the row lock, so a concurrent reservation skips this row, and one that
    // planned on the old details sees a new version and refuses it.
    const res = await tx.bloodUnit.updateMany({
      where: {
        id,
        version: input.version,
        status: "AVAILABLE",
        ...(input.action === "EDIT" ? { expiresAt: { gt: new Date() } } : {}),
      },
      data: { ...change, version: { increment: 1 } },
    });
    if (res.count === 0) throw conflict("This unit was changed by someone else. Refresh and try again.", "STALE_VERSION");

    // Throwing here rolls the change back.
    const live = await tx.reservation.count({ where: { unitId: id, status: { in: ["ACTIVE", "DELIVERED"] } } });
    if (live > 0) throw conflict("This unit is reserved or issued and cannot be changed.", "UNIT_IN_USE");

    const updated = await tx.bloodUnit.findUniqueOrThrow({ where: { id } });
    const snapshot = (u: typeof updated) => ({ bloodType: u.bloodType, component: u.component, expiresAt: u.expiresAt.toISOString() });
    await audit(
      {
        actorId: actor.id,
        actorLabel: actor.email,
        entity: "BloodUnit",
        entityId: id,
        action: input.action === "EDIT" ? "UNIT_UPDATED" : "UNIT_RETIRED",
        ...(input.action === "EDIT" ? { detail: { before: snapshot(unit), after: snapshot(updated) } } : {}),
      },
      tx,
    );
    return { unit: updated };
  });
});
