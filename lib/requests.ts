import { createHash } from "node:crypto";
import type { Prisma, RequestStatus } from "@prisma/client";
import { prisma } from "./db";
import { assertCanManageRequest, type Actor } from "./access";
import { conflict, forbidden, HttpError, notFound } from "./errors";
import { availableUnitWhere } from "./inventory";
import { compatibleTypes } from "./compat";
import { planAllocation, type MatchPlan } from "./rules";
import { assertTransition } from "./state";
import { audit } from "./audit";
import { LOCK_TIMEOUT, setLockTimeout, TX_OPTIONS, withTxRetry } from "./tx";
import type { CreateRequestInput } from "./schemas";

/** Anti-griefing: a hospital may hold at most this many requests that still hold or seek stock. */
export const MAX_OPEN_REQUESTS = 5;
const ACTIVE_STATUSES: RequestStatus[] = ["OPEN", "MATCHED", "PARTIAL"];

/** Hash of every field that defines a request; same Idempotency-Key with a different hash -> 409. */
export function requestHash(r: CreateRequestInput): string {
  return createHash("sha256").update(JSON.stringify([r.bloodType, r.component, r.unitsRequested, r.urgency])).digest("hex");
}

export const requestInclude = {
  hospital: { select: { id: true, name: true } },
  reservations: {
    orderBy: { createdAt: "asc" },
    include: {
      unit: { select: { id: true, bankId: true, bloodType: true, component: true, expiresAt: true, bank: { select: { name: true } } } },
    },
  },
} satisfies Prisma.BloodRequestInclude;

type RequestWithRelations = Prisma.BloodRequestGetPayload<{ include: typeof requestInclude }>;

/** Public view: never expose idempotency internals; a bank sees only its own live reservations. */
export function requestDTO(r: RequestWithRelations, viewer?: Actor) {
  const { idempotencyKey, requestHash: hash, ...rest } = r;
  void idempotencyKey;
  void hash;
  const reservations =
    viewer?.role === "BANK"
      ? r.reservations.filter((x) => x.unit.bankId === viewer.bankId && x.status !== "RELEASED")
      : r.reservations;
  return { ...rest, reservations };
}

function explanationJson(plan: MatchPlan, decidedAt: Date): Prisma.InputJsonValue {
  return {
    decidedAt: decidedAt.toISOString(),
    summary: plan.summary,
    picks: plan.picks.map((p) => ({ unitId: p.unitId, bankName: p.bankName, bloodType: p.bloodType, km: p.km, score: p.score, reason: p.reason })),
    swaps: plan.swaps,
    alternatives: plan.alternatives,
    rejections: plan.rejections,
  } as Prisma.InputJsonValue;
}

type UnitRow = Prisma.BloodUnitGetPayload<{ include: { bank: true } }>;

/** Replan rounds before settling for the units we already hold (each round excludes lost units). */
const MAX_REPLANS = 8;
/** Hard ceiling on request creation per hospital per hour, whatever the outcome (anti-flooding). */
export const MAX_REQUESTS_PER_HOUR = 30;

/**
 * Lock the given units for this transaction, but only those that are STILL available, and skip
 * (never wait for) rows another transaction holds. Returns the ids we now hold.
 * Availability is re-checked in the same statement, so a unit whose reservation committed after
 * we planned is not returned. The partial unique index remains the final backstop.
 */
async function lockAvailable(tx: Prisma.TransactionClient, ids: string[], now: Date): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT u.id FROM "BloodUnit" u
    WHERE u.id = ANY(${ids})
      AND u.status = 'AVAILABLE'
      AND u."expiresAt" > ${now.toISOString()}::timestamp
      AND NOT EXISTS (SELECT 1 FROM "Reservation" r WHERE r."unitId" = u.id AND r.status IN ('ACTIVE', 'DELIVERED'))
    ORDER BY u.id
    FOR UPDATE OF u SKIP LOCKED`;
  return rows.map((r) => r.id);
}

/**
 * Create a request and atomically reserve the best compatible units (A05 + A02).
 *
 * Concurrency design (ONE read-committed transaction, retried on transient conflicts):
 * 1. Per-hospital advisory lock: same-hospital creates run one at a time, so the idempotency
 *    lookup and the request caps cannot race.
 * 2. The engine plans on current stock; we lock ONLY the units it picked, FOR UPDATE SKIP LOCKED,
 *    re-checking availability in that same statement. A unit another in-flight request already
 *    holds is skipped, excluded, and the plan is recomputed. Requests for the same blood type
 *    therefore run in parallel, take different units, and never wait on or deadlock each other.
 *    The loser of a last-unit race finds nothing left and is told UNFULFILLABLE, with alternatives.
 * 3. We insert the Reservations and set the status through the state machine. The partial unique
 *    index (one live reservation per unit) is the database-level backstop: a double reservation
 *    is impossible even if the logic above were wrong.
 * Lock order (all write paths): request row -> reservation rows -> unit rows. Create only touches
 * units it never waits for, and deliver/cancel lock the request first, so no cycle can form.
 * Locks are held for few round trips: uncontended reads (hospital, donors) happen before the
 * transaction and the full response is loaded after commit.
 */
export async function createRequest(actor: Actor, input: CreateRequestInput, idempotencyKey: string) {
  if (actor.role !== "HOSPITAL" || !actor.hospitalId) throw forbidden();
  const hospitalId = actor.hospitalId;
  const hash = requestHash(input);

  const [hospital, donorRows] = await Promise.all([
    prisma.hospital.findUniqueOrThrow({ where: { id: hospitalId } }),
    input.component === "RBC" ? prisma.donor.findMany({ include: { user: { select: { name: true } } } }) : Promise.resolve([]),
  ]);
  const donors = donorRows.map((d) => ({
    id: d.id, name: d.user.name, bloodType: d.bloodType, lastDonationAt: d.lastDonationAt, lat: d.lat, lng: d.lng,
  }));

  const outcome = await withTxRetry(() =>
    prisma.$transaction(async (tx) => {
      // One round trip: transaction-local lock timeout + per-hospital serialisation.
      // DO NOT split this into two statements: lock_timeout only covers the advisory-lock wait when
      // set_config and pg_advisory_xact_lock are in the SAME statement (measured: split -> no timeout).
      await tx.$executeRaw`SELECT set_config('lock_timeout', ${LOCK_TIMEOUT}, true), pg_advisory_xact_lock(hashtext(${hospitalId}))`;

      const existing = await tx.bloodRequest.findUnique({
        where: { hospitalId_idempotencyKey: { hospitalId, idempotencyKey } },
        select: { id: true, requestHash: true },
      });
      if (existing) {
        if (existing.requestHash !== hash) {
          throw conflict("This Idempotency-Key was already used for a different request.", "IDEMPOTENCY_KEY_REUSED");
        }
        return { id: existing.id, replayed: true };
      }

      const lastHour = await tx.bloodRequest.count({ where: { hospitalId, createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
      if (lastHour >= MAX_REQUESTS_PER_HOUR) {
        throw new HttpError(429, `Too many requests from your hospital in the last hour (limit ${MAX_REQUESTS_PER_HOUR}). Please wait.`, "RATE_LIMITED", {
          retryAfterSeconds: 300,
        });
      }

      const active = await tx.bloodRequest.count({ where: { hospitalId, status: { in: ACTIVE_STATUSES } } });
      if (active >= MAX_OPEN_REQUESTS) {
        throw conflict(
          `Your hospital already has ${active} active requests (limit ${MAX_OPEN_REQUESTS}). Cancel or complete one first.`,
          "TOO_MANY_ACTIVE_REQUESTS",
        );
      }

      const created = await tx.bloodRequest.create({
        data: { hospitalId, createdById: actor.id, ...input, idempotencyKey, requestHash: hash },
      });

      const now = new Date();
      const compat = compatibleTypes(input.bloodType, input.component);
      const candidateWhere = {
        ...availableUnitWhere(now),
        component: input.component,
        bloodType: { in: [...compat.exact, ...compat.substitutes] },
      };
      const spec = { bloodType: input.bloodType, component: input.component, units: input.unitsRequested, urgency: input.urgency, hospital };
      const toCandidates = (rows: UnitRow[]) =>
        rows.map((u) => ({
          id: u.id, bankId: u.bankId, bankName: u.bank.name, bankLat: u.bank.lat, bankLng: u.bank.lng,
          bloodType: u.bloodType, component: u.component, expiresAt: u.expiresAt,
        }));

      // Plan on current (unlocked) stock, then lock ONLY the picks. A pick that another request holds
      // (SKIP LOCKED) or that is no longer available is excluded and we replan on what remains.
      // Rows are never waited for, so same-type requests run in parallel and cannot deadlock.
      const excluded = new Set<string>();
      const held = new Set<string>();
      let plan: MatchPlan | null = null;
      for (let attempt = 0; attempt < MAX_REPLANS && !plan; attempt++) {
        const rows = await tx.bloodUnit.findMany({
          where: { ...candidateWhere, ...(excluded.size ? { id: { notIn: [...excluded] } } : {}) },
          include: { bank: true },
        });
        const trial = planAllocation(spec, toCandidates(rows), { now, donors });
        const wanted = trial.picks.map((p) => p.unitId).filter((id) => !held.has(id));
        for (const id of await lockAvailable(tx, wanted, now)) held.add(id);
        const missing = trial.picks.map((p) => p.unitId).filter((id) => !held.has(id));
        if (missing.length === 0) plan = trial;
        else missing.forEach((id) => excluded.add(id));
      }
      if (!plan) {
        // Pathological contention: settle for the units we actually hold.
        const rows = held.size ? await tx.bloodUnit.findMany({ where: { ...candidateWhere, id: { in: [...held] } }, include: { bank: true } }) : [];
        plan = planAllocation(spec, toCandidates(rows), { now, donors });
      }

      if (plan.picks.length > 0) {
        await tx.reservation.createMany({
          data: plan.picks.map((p) => ({ requestId: created.id, unitId: p.unitId, reason: p.reason })),
        });
        await tx.bloodUnit.updateMany({ where: { id: { in: plan.picks.map((p) => p.unitId) } }, data: { version: { increment: 1 } } });
      }

      assertTransition("OPEN", plan.status);
      await tx.bloodRequest.update({ where: { id: created.id }, data: { status: plan.status, explanation: explanationJson(plan, now) } });
      await audit(
        {
          actorId: actor.id, actorLabel: actor.email, action: "REQUEST_CREATED", entity: "BloodRequest", entityId: created.id,
          detail: { status: plan.status, requested: input.unitsRequested, reserved: plan.picks.length, urgency: input.urgency },
        },
        tx,
      );
      return { id: created.id, replayed: false };
    }, TX_OPTIONS),
  );

  // Committed: locks are released; load the full response outside the transaction.
  const request = await prisma.bloodRequest.findUniqueOrThrow({ where: { id: outcome.id }, include: requestInclude });
  return { request, replayed: outcome.replayed };
}

/** What the engine would do with current stock. Read-only: no locks, no writes. */
export async function previewRequest(actor: Actor, input: CreateRequestInput): Promise<MatchPlan> {
  if (actor.role !== "HOSPITAL" || !actor.hospitalId) throw forbidden();
  const now = new Date();
  const compat = compatibleTypes(input.bloodType, input.component);
  const [hospital, units, donorRows] = await Promise.all([
    prisma.hospital.findUniqueOrThrow({ where: { id: actor.hospitalId } }),
    prisma.bloodUnit.findMany({
      where: { ...availableUnitWhere(now), component: input.component, bloodType: { in: [...compat.exact, ...compat.substitutes] } },
      include: { bank: true },
    }),
    input.component === "RBC" ? prisma.donor.findMany({ include: { user: { select: { name: true } } } }) : Promise.resolve([]),
  ]);
  return planAllocation(
    { bloodType: input.bloodType, component: input.component, units: input.unitsRequested, urgency: input.urgency, hospital },
    units.map((u) => ({
      id: u.id, bankId: u.bankId, bankName: u.bank.name, bankLat: u.bank.lat, bankLng: u.bank.lng,
      bloodType: u.bloodType, component: u.component, expiresAt: u.expiresAt,
    })),
    {
      now,
      donors: donorRows.map((d) => ({ id: d.id, name: d.user.name, bloodType: d.bloodType, lastDonationAt: d.lastDonationAt, lat: d.lat, lng: d.lng })),
    },
  );
}

/** Lock a request row so cancel and deliver on the same request run one at a time. */
async function lockRequest(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "BloodRequest" WHERE id = ${id} FOR UPDATE`;
  return rows.length > 0;
}

/**
 * Cancel a request and release its ACTIVE reservations back to stock. Already-delivered units stay
 * delivered. Cancelling an already-cancelled request is a safe no-op (duplicate click).
 */
export async function cancelRequest(actor: Actor, id: string) {
  return withTxRetry(() =>
    prisma.$transaction(async (tx) => {
      await setLockTimeout(tx);
      if (!(await lockRequest(tx, id))) throw notFound("Request");
      // Status is read AFTER the lock, so a concurrent deliver/cancel has already committed.
      const current = await tx.bloodRequest.findUniqueOrThrow({ where: { id } });
      assertCanManageRequest(actor, current);

      if (current.status === "CANCELLED") {
        return { request: await tx.bloodRequest.findUniqueOrThrow({ where: { id }, include: requestInclude }), alreadyCancelled: true, released: 0 };
      }
      assertTransition(current.status, "CANCELLED");

      const now = new Date();
      const released = await tx.reservation.updateMany({
        where: { requestId: id, status: "ACTIVE" },
        data: { status: "RELEASED", releasedAt: now },
      });
      await tx.bloodRequest.update({ where: { id }, data: { status: "CANCELLED" } });
      await audit(
        { actorId: actor.id, actorLabel: actor.email, action: "REQUEST_CANCELLED", entity: "BloodRequest", entityId: id, detail: { released: released.count } },
        tx,
      );
      return { request: await tx.bloodRequest.findUniqueOrThrow({ where: { id }, include: requestInclude }), alreadyCancelled: false, released: released.count };
    }, TX_OPTIONS),
  );
}

/**
 * The owning bank marks one reserved unit as delivered (bank-attested). The unit becomes ISSUED.
 * When no ACTIVE reservations remain, the request becomes DELIVERED. Delivering twice is a no-op.
 */
export async function deliverReservation(actor: Actor, reservationId: string) {
  if (actor.role !== "BANK" || !actor.bankId) throw forbidden();
  const bankId = actor.bankId;

  return withTxRetry(() =>
    prisma.$transaction(async (tx) => {
      await setLockTimeout(tx);
      const found = await tx.reservation.findUnique({ where: { id: reservationId }, include: { unit: true } });
      if (!found || found.unit.bankId !== bankId) throw notFound("Reservation");

      // Same lock order as cancel: request row first.
      await lockRequest(tx, found.requestId);
      const resv = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId } });

      const result = async (alreadyDelivered: boolean) => ({
        request: await tx.bloodRequest.findUniqueOrThrow({ where: { id: found.requestId }, include: requestInclude }),
        alreadyDelivered,
      });

      if (resv.status === "DELIVERED") return result(true);
      if (resv.status === "RELEASED") {
        throw conflict("This reservation was released because the request was cancelled.", "RESERVATION_RELEASED");
      }

      const now = new Date();
      if (found.unit.expiresAt <= now) throw conflict("This unit has expired and must not be issued.", "UNIT_EXPIRED");

      const issued = await tx.bloodUnit.updateMany({
        where: { id: found.unitId, status: "AVAILABLE" },
        data: { status: "ISSUED", version: { increment: 1 } },
      });
      if (issued.count === 0) throw conflict("This unit is no longer available to issue.", "UNIT_UNAVAILABLE");

      await tx.reservation.update({ where: { id: reservationId }, data: { status: "DELIVERED", deliveredAt: now } });

      const stillActive = await tx.reservation.count({ where: { requestId: found.requestId, status: "ACTIVE" } });
      if (stillActive === 0) {
        const req = await tx.bloodRequest.findUniqueOrThrow({ where: { id: found.requestId } });
        assertTransition(req.status, "DELIVERED");
        await tx.bloodRequest.update({ where: { id: found.requestId }, data: { status: "DELIVERED" } });
      }
      await audit(
        {
          actorId: actor.id, actorLabel: actor.email, action: "UNIT_DELIVERED", entity: "Reservation", entityId: reservationId,
          detail: { requestId: found.requestId, unitId: found.unitId, requestComplete: stillActive === 0 },
        },
        tx,
      );
      return result(false);
    }, TX_OPTIONS),
  );
}
