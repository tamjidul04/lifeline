import { prisma } from "@/lib/db";
import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { resetDemoData } from "@/lib/seed";
import { HttpError } from "@/lib/errors";

/**
 * Admin-only: restore the demo dataset. Everyone (including the caller) is signed out.
 * resetDemoData takes a transaction-level advisory lock, so two admins pressing it at once
 * run one after the other and cannot double-seed.
 */
export const POST = handle(async () => {
  await requireUser(["ADMIN"]);
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 8) throw new HttpError(500, "Demo reset is not configured on this server.", "RESET_NOT_CONFIGURED");

  const accounts = await resetDemoData(prisma, password);
  return { ok: true, accounts: accounts.length, message: "Demo data restored. Please sign in again." };
});
