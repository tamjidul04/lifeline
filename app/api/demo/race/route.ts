import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { runLastUnitRace } from "@/lib/demo";

export const maxDuration = 60;

/** A05 demo: 10 parallel requests for one unit, on temporary data. Any signed-in user may run it. */
export const POST = handle(async () => {
  await requireUser();
  return { race: await runLastUnitRace() };
});
