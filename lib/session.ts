import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "lifeline_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours

/**
 * The cookie carries ONLY a signed session id. Who the user is and what role they have are read
 * from the database on every request (see lib/auth.ts), and the Session row can be deleted to
 * revoke the cookie immediately (logout, reset).
 */
export type SessionPayload = { sid: string };

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setJti(payload.sid)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key());
}

/**
 * Returns the payload for a valid, unexpired, untampered token; otherwise null. Never throws.
 * A valid signature is necessary but NOT sufficient: callers must also find the Session row.
 */
export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (typeof payload.jti !== "string" || !payload.jti) return null;
    return { sid: payload.jti };
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
