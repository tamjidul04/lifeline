import { handle } from "@/lib/api";
import { endSession, getActor } from "@/lib/auth";
import { audit } from "@/lib/audit";

/** Deletes the server-side session, so a copied cookie stops working immediately. */
export const POST = handle(async () => {
  const actor = await getActor();
  await endSession();
  if (actor) await audit({ actorId: actor.id, actorLabel: actor.email, action: "LOGOUT", entity: "User", entityId: actor.id });
  return { ok: true };
});
