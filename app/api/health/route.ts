import { prisma } from "@/lib/db";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Liveness + database check. 200 when the database answers within 8s, otherwise 503. */
export async function GET() {
  const started = Date.now();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
    ]);
    return Response.json({ ok: true, db: "up", latencyMs: Date.now() - started });
  } catch {
    return errorResponse(503, "DB_UNAVAILABLE", "The database is waking up or unreachable. Please retry in a few seconds.", undefined, {
      "Retry-After": "5",
    });
  }
}
