import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { dashboardFor } from "@/lib/stats";

/** Role-specific aggregates (stock by type, expiring soon, request counts, fulfilment rate). */
export const GET = handle(async () => {
  const actor = await requireUser();
  return { dashboard: await dashboardFor(actor) };
});
