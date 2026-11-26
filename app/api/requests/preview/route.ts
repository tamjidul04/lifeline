import { handle, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { createRequestSchema } from "@/lib/schemas";
import { previewRequest } from "@/lib/requests";

/** Dry run of the matching engine on current stock. Reserves and writes nothing. */
export const POST = handle(async (req) => {
  const actor = await requireUser(["HOSPITAL"]);
  const input = createRequestSchema.parse(await readJson(req));
  return { plan: await previewRequest(actor, input) };
});
