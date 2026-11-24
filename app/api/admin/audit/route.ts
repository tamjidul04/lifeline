import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { listAuditSchema } from "@/lib/schemas";

/** Admin-only audit trail, newest first, with filters and pagination. */
export const GET = handle(async (req) => {
  await requireUser(["ADMIN"]);
  const q = listAuditSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const where: Prisma.AuditLogWhereInput = {
    action: q.action,
    entity: q.entity,
    ...(q.q ? { OR: [{ actorLabel: { contains: q.q, mode: "insensitive" } }, { entityId: { contains: q.q } }] } : {}),
  };
  const [total, entries] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)), entries };
});
