import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { handle, readJson } from "@/lib/api";
import { loginSchema } from "@/lib/schemas";
import { accountLimiter, clientIpFrom, ipLimiter } from "@/lib/rate-limit";
import { startSession } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { audit } from "@/lib/audit";

// Compared against when the email does not exist, so both failure paths take the same time.
let dummyHash: string | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync("not-a-real-password-0", 10));

const INVALID = () => new HttpError(401, "Invalid email or password.", "INVALID_CREDENTIALS");

export const POST = handle(async (req) => {
  const { email, password } = loginSchema.parse(await readJson(req));
  const ip = clientIpFrom(req.headers);
  const accountKey = `${ip}|${email}`;

  const wait = Math.max(accountLimiter.retryAfter(accountKey), ipLimiter.retryAfter(ip));
  if (wait > 0) {
    throw new HttpError(429, `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`, "RATE_LIMITED", {
      retryAfterSeconds: wait,
    });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? getDummyHash());

  if (!user || !ok) {
    accountLimiter.recordFailure(accountKey);
    ipLimiter.recordFailure(ip);
    await audit({ actorId: user?.id ?? null, actorLabel: email, action: "LOGIN_FAILED", entity: "User", entityId: user?.id, detail: { ip } });
    // Same message whether the email exists or not: no user enumeration.
    throw INVALID();
  }

  accountLimiter.clear(accountKey);
  await startSession(user.id);
  await audit({ actorId: user.id, actorLabel: user.email, action: "LOGIN", entity: "User", entityId: user.id });

  return { user: { id: user.id, name: user.name, email: user.email, role: user.role } };
});
