import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "./db";
import { createRequest } from "./requests";
import { planAllocation, type CandidateUnit, type MatchPlan } from "./rules";
import type { Actor } from "./access";
import { conflict } from "./errors";

/**
 * Judge demo (A05 + A02). Both use the REAL production code paths.
 *
 * A05 creates a temporary bank, N temporary hospitals and ONE unit at a remote location, fires N
 * createRequest() calls in parallel against the real database, checks the invariants, and deletes
 * everything it made. Seeded demo data is never touched (routine requests only search 50 km).
 */
const PREFIX = "demo-race";
const DOMAIN = "@lifeline.invalid";
const HOSPITALS = 10;

async function removeFixtures(emails: { startsWith: string }) {
  const users = await prisma.user.findMany({ where: { email: { ...emails, endsWith: DOMAIN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return;
  const banks = await prisma.bank.findMany({ where: { managerId: { in: ids } }, select: { id: true } });
  const bankIds = banks.map((b) => b.id);
  const requests = await prisma.bloodRequest.findMany({ where: { createdById: { in: ids } }, select: { id: true } });
  const requestIds = requests.map((r) => r.id);
  await prisma.reservation.deleteMany({ where: { OR: [{ requestId: { in: requestIds } }, { unit: { bankId: { in: bankIds } } }] } });
  await prisma.bloodRequest.deleteMany({ where: { id: { in: requestIds } } });
  await prisma.bloodUnit.deleteMany({ where: { bankId: { in: bankIds } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.hospital.deleteMany({ where: { staffId: { in: ids } } });
  await prisma.bank.deleteMany({ where: { id: { in: bankIds } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

export type RaceResult = {
  hospitals: { name: string; status: string; unitReserved: boolean; milliseconds: number; summary: string }[];
  winners: number;
  liveReservationsOnUnit: number;
  unitsDoubleBooked: number;
  totalMilliseconds: number;
  passed: boolean;
};

let running = false;

export async function runLastUnitRace(): Promise<RaceResult> {
  if (running) throw conflict("A race is already running. Wait a few seconds and try again.", "DEMO_BUSY");
  running = true;
  const tag = `${PREFIX}-${Date.now()}-${randomBytes(3).toString("hex")}`;
  // Far from every seeded bank, and different on every run.
  const location = { lat: -55 + Math.random() * 20, lng: -140 + Math.random() * 40 };
  try {
    await sweepStale();
    // Temporary accounts get an unusable password hash: nobody can sign in as them.
    const passwordHash = `disabled:${randomBytes(24).toString("hex")}`;
    const bankUser = await prisma.user.create({ data: { email: `${tag}-bank${DOMAIN}`, name: "Demo race bank", role: "BANK", passwordHash } });
    const bank = await prisma.bank.create({ data: { name: "Demo Race Bank", ...location, managerId: bankUser.id } });
    const actors: Actor[] = await Promise.all(
      Array.from({ length: HOSPITALS }, async (_, i) => {
        const user = await prisma.user.create({
          data: {
            email: `${tag}-h${i}${DOMAIN}`, name: `Demo hospital ${i + 1}`, role: "HOSPITAL", passwordHash,
            hospital: { create: { name: `Demo Hospital ${i + 1}`, lat: location.lat + i * 0.001, lng: location.lng } },
          },
          include: { hospital: true },
        });
        return { id: user.id, role: "HOSPITAL" as const, name: user.name, email: user.email, hospitalId: user.hospital!.id, bankId: null, donorId: null };
      }),
    );
    const unit = await prisma.bloodUnit.create({
      data: { bankId: bank.id, bloodType: "AB_NEG", component: "RBC", expiresAt: new Date(Date.now() + 10 * 86_400_000) },
    });

    const started = Date.now();
    const results = await Promise.all(
      actors.map(async (actor, i) => {
        const t = Date.now();
        try {
          const { request } = await createRequest(
            actor,
            { bloodType: "AB_NEG", component: "RBC", unitsRequested: 1, urgency: "ROUTINE" },
            randomUUID(),
          );
          const explanation = request.explanation as { summary?: string } | null;
          return { name: `Hospital ${i + 1}`, status: request.status as string, unitReserved: request.reservations.length > 0, milliseconds: Date.now() - t, summary: explanation?.summary ?? "" };
        } catch (e) {
          console.error("[demo race] request failed", e);
          return { name: `Hospital ${i + 1}`, status: "ERROR", unitReserved: false, milliseconds: Date.now() - t, summary: "Request failed; see server log." };
        }
      }),
    );
    const totalMilliseconds = Date.now() - started;

    const live = await prisma.reservation.count({ where: { unitId: unit.id, status: { in: ["ACTIVE", "DELIVERED"] } } });
    const doubles = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM (
        SELECT "unitId" FROM "Reservation" WHERE status IN ('ACTIVE','DELIVERED') GROUP BY "unitId" HAVING COUNT(*) > 1
      ) d`;
    const winners = results.filter((r) => r.unitReserved).length;
    const unitsDoubleBooked = Number(doubles[0]?.n ?? 0);
    return {
      hospitals: results,
      winners,
      liveReservationsOnUnit: live,
      unitsDoubleBooked,
      totalMilliseconds,
      passed: winners === 1 && live === 1 && unitsDoubleBooked === 0 && results.every((r) => r.status !== "ERROR"),
    };
  } finally {
    await removeFixtures({ startsWith: tag }).catch((e) => console.error("[demo race] cleanup failed", e));
    running = false;
  }
}

/** Remove fixtures left behind if an earlier run was interrupted (older than 5 minutes). */
async function sweepStale() {
  const old = await prisma.user.findMany({
    where: { email: { startsWith: PREFIX, endsWith: DOMAIN }, createdAt: { lt: new Date(Date.now() - 5 * 60_000) } },
    select: { email: true },
  });
  for (const tag of new Set(old.map((u) => u.email.split("-").slice(0, 4).join("-")))) await removeFixtures({ startsWith: tag });
}

export type Scenario = "conflict" | "infeasible";

const SCENARIOS = {
  conflict: {
    title: "Conflicting constraints",
    description: "Routine A− red cells × 3. The shelf holds one A−, two O− (substitutes) and three A+ (incompatible).",
    request: { bloodType: "A_NEG", component: "RBC", units: 3, urgency: "ROUTINE" },
    shelf: [["A_NEG", 1], ["O_NEG", 2], ["A_POS", 3]],
  },
  infeasible: {
    title: "Infeasible request",
    description: "Critical AB− red cells × 4. The shelf holds only AB+ and A+: no Rh− patient may receive either.",
    request: { bloodType: "AB_NEG", component: "RBC", units: 4, urgency: "CRITICAL" },
    shelf: [["AB_POS", 3], ["A_POS", 4]],
  },
} as const;

/** Runs the real engine on a fixed, in-memory shelf, with the real registered donors. Writes nothing. */
export async function runDecisionScenario(id: Scenario): Promise<{ title: string; description: string; plan: MatchPlan }> {
  const s = SCENARIOS[id];
  const hospital = { lat: 23.75, lng: 90.39 };
  const now = new Date();
  let n = 0;
  const shelf: CandidateUnit[] = s.shelf.flatMap(([bloodType, count]) =>
    Array.from({ length: count }, () => ({
      id: `demo-${++n}`, bankId: "demo-bank", bankName: "Demo shelf", bankLat: 23.78, bankLng: 90.4,
      bloodType, component: "RBC" as const, expiresAt: new Date(now.getTime() + (24 + n * 30) * 3_600_000),
    })),
  );
  const donors = (await prisma.donor.findMany({ include: { user: { select: { name: true } } } })).map((d) => ({
    id: d.id, name: d.user.name, bloodType: d.bloodType, lastDonationAt: d.lastDonationAt, lat: d.lat, lng: d.lng,
  }));
  return { title: s.title, description: s.description, plan: planAllocation({ ...s.request, hospital }, shelf, { now, donors }) };
}
