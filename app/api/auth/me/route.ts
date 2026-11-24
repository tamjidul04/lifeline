import { handle } from "@/lib/api";
import { actorDTO, requireUser } from "@/lib/auth";

export const GET = handle(async () => {
  const actor = await requireUser();
  return { user: actorDTO(actor) };
});
