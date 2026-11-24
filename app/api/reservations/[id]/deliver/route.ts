import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { deliverReservation, requestDTO } from "@/lib/requests";

type Ctx = { params: Promise<{ id: string }> };

/** The owning bank marks a reserved unit as delivered. Repeating it is a safe no-op. */
export const POST = handle(async (_req, { params }: Ctx) => {
  const actor = await requireUser(["BANK"]);
  const { id } = await params;
  const { request, alreadyDelivered } = await deliverReservation(actor, id);
  return { request: requestDTO(request, actor), alreadyDelivered };
});
