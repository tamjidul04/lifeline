import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { cancelRequest, requestDTO } from "@/lib/requests";

type Ctx = { params: Promise<{ id: string }> };

/** Owning hospital cancels; ACTIVE reservations return to stock. Repeating it is a safe no-op. */
export const POST = handle(async (_req, { params }: Ctx) => {
  const actor = await requireUser(["HOSPITAL", "ADMIN", "BANK"]);
  const { id } = await params;
  const { request, alreadyCancelled, released } = await cancelRequest(actor, id);
  return { request: requestDTO(request, actor), alreadyCancelled, released };
});
