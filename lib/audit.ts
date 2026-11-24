import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Append an audit entry. Pass `tx` to write it inside the same transaction as the change.
 * Without `tx` it is best-effort: an audit failure is logged but never breaks the user's action.
 */
export async function audit(
  entry: {
    actorId: string | null;
    /** Human-readable actor: an email, or "system". Keeps rows attributable after user deletion. */
    actorLabel?: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    detail?: Prisma.InputJsonValue;
  },
  tx?: Tx,
): Promise<void> {
  const data = { ...entry, entityId: entry.entityId ?? null, actorLabel: entry.actorLabel ?? (entry.actorId ? null : "system") };
  if (tx) {
    await tx.auditLog.create({ data });
    return;
  }
  try {
    await prisma.auditLog.create({ data });
  } catch (err) {
    console.error("[audit] failed to write entry", entry.action, err);
  }
}
