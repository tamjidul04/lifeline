import { prisma } from "@/lib/db";
import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { assertCanViewRequest } from "@/lib/access";
import { notFound } from "@/lib/errors";
import { requestDTO, requestInclude } from "@/lib/requests";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req, { params }: Ctx) => {
  const actor = await requireUser(["ADMIN", "HOSPITAL", "BANK"]);
  const { id } = await params;

  const request = await prisma.bloodRequest.findUnique({ where: { id }, include: requestInclude });
  if (!request) throw notFound("Request");

  assertCanViewRequest(actor, {
    hospitalId: request.hospitalId,
    liveReservingBankIds: request.reservations.filter((r) => r.status !== "RELEASED").map((r) => r.unit.bankId),
  });
  return { request: requestDTO(request, actor) };
});
