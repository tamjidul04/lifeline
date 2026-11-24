import type { Role } from "@prisma/client";
import { forbidden, notFound } from "./errors";

/**
 * Who is acting, and which organisation they belong to.
 * Built once per request by `requireUser()` from the database (not from the cookie alone).
 */
export type Actor = {
  id: string;
  role: Role;
  name: string;
  email: string;
  hospitalId: string | null;
  bankId: string | null;
  donorId: string | null;
  sessionId?: string;
};

export function requireRole(actor: Actor, roles: readonly Role[]): void {
  if (!roles.includes(actor.role)) throw forbidden();
}

/**
 * Can this actor SEE a blood request?
 * - ADMIN: all requests
 * - HOSPITAL: only its own hospital's requests
 * - BANK: only requests with a LIVE (ACTIVE or DELIVERED) reservation on one of its units.
 *   A bank whose reservation was RELEASED no longer has a stake and loses access.
 * - DONOR: none
 * Anything else is reported as 404 so request ids cannot be probed.
 */
export function assertCanViewRequest(
  actor: Actor,
  request: { hospitalId: string; liveReservingBankIds: readonly string[] },
): void {
  if (actor.role === "ADMIN") return;
  if (actor.role === "HOSPITAL" && actor.hospitalId === request.hospitalId) return;
  if (actor.role === "BANK" && actor.bankId && request.liveReservingBankIds.includes(actor.bankId)) return;
  throw notFound("Request");
}

/**
 * Only the hospital that created a request may cancel it.
 * Admin can already see every request, so 403 leaks nothing; everyone else gets 404.
 */
export function assertCanManageRequest(actor: Actor, request: { hospitalId: string }): void {
  if (actor.role === "HOSPITAL" && actor.hospitalId === request.hospitalId) return;
  if (actor.role === "ADMIN") throw forbidden();
  throw notFound("Request");
}

/** Banks see only their own units; admins see all (read-only). */
export function assertCanViewUnit(actor: Actor, unit: { bankId: string }): void {
  if (actor.role === "ADMIN") return;
  if (actor.role === "BANK" && actor.bankId === unit.bankId) return;
  throw notFound("Blood unit");
}

/** Only the owning bank may change a unit. Admin is read-only on inventory. */
export function assertCanEditUnit(actor: Actor, unit: { bankId: string }): void {
  if (actor.role === "BANK" && actor.bankId === unit.bankId) return;
  if (actor.role === "ADMIN") throw forbidden();
  throw notFound("Blood unit");
}
