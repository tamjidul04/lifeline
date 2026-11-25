import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Prisma's default pool is 2*CPUs+1 (9 here). A burst of concurrent requests (e.g. the race demo)
 * would exhaust it and time out, so unless the URL already sets them we raise the pool size and
 * wait up to 20s for a free connection. Neon's pooler multiplexes these onto few real connections.
 */
export function withPoolDefaults(url: string | undefined): string | undefined {
  if (!url) return url;
  const u = new URL(url);
  if (!u.searchParams.has("connection_limit")) u.searchParams.set("connection_limit", "20");
  if (!u.searchParams.has("pool_timeout")) u.searchParams.set("pool_timeout", "20");
  return u.toString();
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ datasourceUrl: withPoolDefaults(process.env.DATABASE_URL) });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
