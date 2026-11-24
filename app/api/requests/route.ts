import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handle, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { createRequestSchema, idempotencyKeySchema, listRequestsSchema } from "@/lib/schemas";
import { createRequest, requestDTO, requestInclude } from "@/lib/requests";
import { HttpError } from "@/lib/errors";

/**
 * List requests visible to the caller, with filters and sorting.
 * HOSPITAL: own requests · BANK: requests holding a live reservation on its units · ADMIN: all.
 */
export const GET = handle(async (req) => {
  const actor = await requireUser(["ADMIN", "HOSPITAL", "BANK"]);
  const q = listRequestsSchema.parse(Object.fromEntries(req.nextUrl.searchParams));

  const scope: Prisma.BloodRequestWhereInput =
    actor.role === "HOSPITAL"
      ? { hospitalId: actor.hospitalId ?? "__none__" }
      : actor.role === "BANK"
        ? { reservations: { some: { status: { in: ["ACTIVE", "DELIVERED"] }, unit: { bankId: actor.bankId ?? "__none__" } } } }
        : {};

  const requests = await prisma.bloodRequest.findMany({
    where: { ...scope, status: q.status, urgency: q.urgency, bloodType: q.bloodType },
    orderBy: [{ createdAt: q.sort === "newest" ? "desc" : "asc" }, { id: "asc" }],
    take: q.limit,
    include: requestInclude,
  });
  return { requests: requests.map((r) => requestDTO(r, actor)) };
});

/** Hospital creates a request; units are matched and reserved atomically. Requires Idempotency-Key. */
export const POST = handle(async (req) => {
  const actor = await requireUser(["HOSPITAL"]);
  const rawKey = req.headers.get("idempotency-key");
  if (!rawKey) throw new HttpError(400, "Idempotency-Key header is required.", "IDEMPOTENCY_KEY_REQUIRED");
  const key = idempotencyKeySchema.parse(rawKey);
  const input = createRequestSchema.parse(await readJson(req));

  const { request, replayed } = await createRequest(actor, input, key);
  return Response.json(
    { request: requestDTO(request, actor), replayed },
    { status: replayed ? 200 : 201, headers: replayed ? { "Idempotent-Replayed": "true" } : undefined },
  );
});
