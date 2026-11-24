import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { prisma } from "./db";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, sessionCookieOptions, verifySession } from "./session";
import { requireRole, type Actor } from "./access";
import { unauthorized } from "./errors";

/**
 * Resolve the signed-in user from the session cookie AND the database.
 * - The Session row must exist and be unexpired, so logout/reset revoke copied cookies at once.
 * - The role comes from the User row, never from the cookie.
 * `cache()` only de-duplicates within one React render pass; in Route Handlers it is a no-op
 * (per the Next.js docs), so every API call does a fresh lookup.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const payload = await verifySession(token);
  if (!payload) return null;

  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    select: {
      id: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          role: true,
          name: true,
          email: true,
          bank: { select: { id: true } },
          hospital: { select: { id: true } },
          donor: { select: { id: true } },
        },
      },
    },
  });
  if (!session || session.expiresAt <= new Date()) return null;

  const user = session.user;
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    bankId: user.bank?.id ?? null,
    hospitalId: user.hospital?.id ?? null,
    donorId: user.donor?.id ?? null,
    sessionId: session.id,
  };
});

/** Create a server-side session and set the signed cookie. Route Handlers / Server Actions only. */
export async function startSession(userId: string): Promise<void> {
  const session = await prisma.session.create({
    data: { userId, expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000) },
  });
  (await cookies()).set(SESSION_COOKIE, await signSession({ sid: session.id }), sessionCookieOptions());
}

/** Delete this device's session row and cookie. Safe to call when already signed out. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const payload = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (payload) await prisma.session.deleteMany({ where: { id: payload.sid } });
  jar.delete(SESSION_COOKIE);
}

/** For Route Handlers: throws 401 if signed out, 403 if the role is not allowed. */
export async function requireUser(roles?: readonly Role[]): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw unauthorized();
  if (roles) requireRole(actor, roles);
  return actor;
}

/** For pages: redirects instead of throwing. */
export async function requirePageUser(roles?: readonly Role[]): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (roles && !roles.includes(actor.role)) redirect("/dashboard?denied=1");
  return actor;
}

/** Safe public view of an actor (never includes the password hash or session id). */
export function actorDTO(a: Actor) {
  return { id: a.id, name: a.name, email: a.email, role: a.role, bankId: a.bankId, hospitalId: a.hospitalId, donorId: a.donorId };
}
