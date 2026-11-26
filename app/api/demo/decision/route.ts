import * as z from "zod";
import { handle, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { runDecisionScenario } from "@/lib/demo";

const schema = z.object({ scenario: z.enum(["conflict", "infeasible"], { error: "Unknown scenario." }) });

/** A02 demo: the real engine on a fixed shelf. Writes nothing. */
export const POST = handle(async (req) => {
  await requireUser();
  const { scenario } = schema.parse(await readJson(req));
  return runDecisionScenario(scenario);
});
