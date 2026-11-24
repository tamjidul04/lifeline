import { prisma } from "@/lib/db";
import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { assertCanViewRequest } from "@/lib/access";
import { notFound } from "@/lib/errors";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req, { params }: Ctx) => {
  const actor = await requireUser(["ADMIN", "HOSPITAL", "BANK"]);
  const { id } = await params;

  const request = await prisma.bloodRequest.findUnique({
    where: { id },
    include: {
      hospital: { select: { id: true, name: true } },
      reservations: {
        orderBy: { createdAt: "asc" },
        include: { unit: { select: { id: true, bankId: true, bloodType: true, component: true, expiresAt: true, bank: { select: { name: true } } } } },
      },
    },
  });
  if (!request) throw notFound("Request");

  const live = request.reservations.filter((r) => r.status !== "RELEASED");
  assertCanViewRequest(actor, {
    hospitalId: request.hospitalId,
    liveReservingBankIds: live.map((r) => r.unit.bankId),
  });

  // A bank only sees its own live reservations.
  const reservations = actor.role === "BANK" ? live.filter((r) => r.unit.bankId === actor.bankId) : request.reservations;

  // Never expose idempotency internals.
  const { idempotencyKey, requestHash, ...rest } = request;
  void idempotencyKey;
  void requestHash;
  return { request: { ...rest, reservations } };
});
