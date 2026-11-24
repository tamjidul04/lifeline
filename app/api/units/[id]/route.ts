import * as z from "zod";
import { prisma } from "@/lib/db";
import { handle, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
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

const patchSchema = z.object({
  action: z.enum(["RETIRE"], { error: "Unsupported action." }),
  version: z.number().int().min(0, { error: "version is required for safe updates." }),
});

/** Retire a unit (units are never deleted). Optimistic concurrency via `version`. */
export const PATCH = handle(async (req, { params }: Ctx) => {
  const actor = await requireUser(["BANK", "ADMIN"]);
  const { id } = await params;
  const input = patchSchema.parse(await readJson(req));

  const unit = await prisma.bloodUnit.findUnique({ where: { id } });
  if (!unit) throw notFound("Blood unit");
  assertCanEditUnit(actor, unit);

  return prisma.$transaction(async (tx) => {
    // Compare-and-set FIRST: only succeeds if nobody changed the unit since the client read it.
    // This UPDATE also takes the row lock, so a concurrent reservation (which CASes the same row)
    // is serialised behind us and then sees status RETIRED.
    const res = await tx.bloodUnit.updateMany({
      where: { id, version: input.version, status: "AVAILABLE" },
      data: { status: "RETIRED", version: { increment: 1 } },
    });
    if (res.count === 0) throw conflict("This unit was changed by someone else. Refresh and try again.", "STALE_VERSION");

    // Throwing here rolls the retire back.
    const live = await tx.reservation.count({ where: { unitId: id, status: { in: ["ACTIVE", "DELIVERED"] } } });
    if (live > 0) throw conflict("This unit is reserved or issued and cannot be retired.", "UNIT_IN_USE");

    await audit({ actorId: actor.id, actorLabel: actor.email, action: "UNIT_RETIRED", entity: "BloodUnit", entityId: id }, tx);
    return { unit: await tx.bloodUnit.findUniqueOrThrow({ where: { id } }) };
  });
});
