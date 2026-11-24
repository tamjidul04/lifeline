/**
 * A05 proof: concurrency, atomic reservation and idempotency under real parallel HTTP load.
 *   BASE_URL=http://localhost:3000 ITERATIONS=100 npx tsx --env-file=.env scripts/race-test.ts
 *
 * Creates its own fixtures (a bank + 10 hospitals at a remote test location, so ROUTINE requests
 * can only match the fixture units) and removes them afterwards. Seeded demo data is untouched.
 */
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ITERATIONS = Number(process.env.ITERATIONS ?? 100);
const N_HOSPITALS = Math.max(5, Number(process.env.HOSPITALS ?? 10)); // >= 5: the cancel/deliver scenario uses hospital #1, bursts use #0
const PW = process.env.SEED_PASSWORD!;
const TAG = `race${Date.now()}`;
const LOC = { lat: 0.5, lng: 0.5 }; // far from every seeded bank, so ROUTINE (<=50 km) sees fixtures only
// The harness talks to the DB directly for fixtures. Over a slow or flaky link (e.g. a laptop far
// from the DB region) a connection can drop, so harness queries retry connection errors.
// This retry is for the TEST HARNESS only; the app's own transactions are tested as-is over HTTP.
const CONNECTION_ERRORS = new Set(["P1001", "P1002", "P1017", "P2024"]);
const prisma = new PrismaClient().$extends({
  query: {
    async $allOperations({ args, query }) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await query(args);
        } catch (e) {
          const code = (e as { code?: string }).code;
          if (attempt >= 6 || !code || !CONNECTION_ERRORS.has(code)) throw e;
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    },
  },
});

let violations = 0;
const fail = (msg: string) => {
  violations++;
  console.log(`  VIOLATION: ${msg}`);
};
const latencies: number[] = [];
const statusCounts: Record<number, number> = {};

async function call(path: string, cookie: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookie);
  if (init.body) headers.set("content-type", "application/json");
  const t = performance.now();
  const res = await fetch(BASE + path, { ...init, headers });
  latencies.push(performance.now() - t);
  statusCounts[res.status] = (statusCounts[res.status] ?? 0) + 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test script inspects arbitrary JSON
  const json: any = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function login(email: string) {
  const res = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

const createReq = (cookie: string, key: string, body: object) =>
  call("/api/requests", cookie, { method: "POST", body: JSON.stringify(body), headers: { "idempotency-key": key } });

const AB_NEG_1 = { bloodType: "AB_NEG", component: "RBC", unitsRequested: 1, urgency: "ROUTINE" };

const FIXTURE_EMAILS = { startsWith: "race", endsWith: "@lifeline.test" };

/** Remove ALL race fixtures, including any left behind by an earlier crashed run. */
async function removeFixtures() {
  const users = await prisma.user.findMany({ where: { email: FIXTURE_EMAILS }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return;
  const banks = await prisma.bank.findMany({ where: { managerId: { in: ids } }, select: { id: true } });
  const reqs = await prisma.bloodRequest.findMany({ where: { createdById: { in: ids } }, select: { id: true } });
  await prisma.reservation.deleteMany({
    where: { OR: [{ requestId: { in: reqs.map((r) => r.id) } }, { unit: { bankId: { in: banks.map((b) => b.id) } } }] },
  });
  await prisma.bloodRequest.deleteMany({ where: { id: { in: reqs.map((r) => r.id) } } });
  await prisma.bloodUnit.deleteMany({ where: { bankId: { in: banks.map((b) => b.id) } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.hospital.deleteMany({ where: { staffId: { in: ids } } });
  await prisma.bank.deleteMany({ where: { id: { in: banks.map((b) => b.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } }); // sessions cascade
}

async function main() {
  await removeFixtures();
  let races = 0, winnersTotal = 0, losersTotal = 0, idemBursts = 0, cancelDeliverRaces = 0;
  const outcomes: Record<string, number> = {};

  try {
    // ---------- fixtures ----------
    const passwordHash = await bcrypt.hash(PW, 10);
    const bankUser = await prisma.user.create({ data: { email: `${TAG}.bank@lifeline.test`, name: "Race Bank", role: "BANK", passwordHash } });
    const bank = await prisma.bank.create({ data: { name: "Race Test Bank", ...LOC, managerId: bankUser.id } });
    const hospUsers: { id: string; email: string }[] = [];
    for (let i = 0; i < N_HOSPITALS; i++) {
      const u = await prisma.user.create({ data: { email: `${TAG}.h${i}@lifeline.test`, name: `Race Hospital ${i}`, role: "HOSPITAL", passwordHash } });
      await prisma.hospital.create({ data: { name: `Race Hospital ${i}`, lat: LOC.lat + i * 0.001, lng: LOC.lng, staffId: u.id } });
      hospUsers.push(u);
    }
    const fixtureUserIds = [bankUser.id, ...hospUsers.map((u) => u.id)];
    const hospCookies: string[] = [];
    for (const u of hospUsers) hospCookies.push(await login(u.email));
    const bankCookie = await login(bankUser.email);

    const addUnits = (k: number) =>
      Promise.all(
        Array.from({ length: k }, () =>
          prisma.bloodUnit.create({
            data: { bankId: bank.id, bloodType: "AB_NEG", component: "RBC", expiresAt: new Date(Date.now() + 10 * 86_400_000) },
          }),
        ),
      );

    const cleanIteration = async () => {
      const reqs = await prisma.bloodRequest.findMany({ where: { createdById: { in: fixtureUserIds } }, select: { id: true } });
      await prisma.reservation.deleteMany({ where: { requestId: { in: reqs.map((r) => r.id) } } });
      await prisma.bloodRequest.deleteMany({ where: { id: { in: reqs.map((r) => r.id) } } });
      await prisma.bloodUnit.deleteMany({ where: { bankId: bank.id } });
    };

    console.log(`Race test against ${BASE}: ${ITERATIONS} iterations, ${N_HOSPITALS} parallel hospitals\n`);
    for (let it = 1; it <= ITERATIONS; it++) {
      // ---------- Scenario A: k units, N hospitals at once -> exactly k winners ----------
      const k = 1 + (it % 3);
      const units = await addUnits(k);
      const results = await Promise.all(hospCookies.map((c) => createReq(c, randomUUID(), AB_NEG_1)));
      races++;
      const statuses = results.map((r) => r.json?.request?.status ?? `HTTP${r.status}`);
      const winners = statuses.filter((s) => s === "MATCHED").length;
      const losers = statuses.filter((s) => s === "UNFULFILLABLE").length;
      winnersTotal += winners;
      losersTotal += losers;
      if (results.some((r) => r.status !== 201)) fail(`iter ${it}: non-201 responses ${results.map((r) => r.status).join(",")}`);
      if (winners !== k) fail(`iter ${it}: expected ${k} winners, got ${winners} (${statuses.join(",")})`);
      if (winners + losers !== N_HOSPITALS) fail(`iter ${it}: unexpected statuses ${statuses.join(",")}`);
      const live = await prisma.reservation.groupBy({
        by: ["unitId"],
        where: { unitId: { in: units.map((u) => u.id) }, status: { in: ["ACTIVE", "DELIVERED"] } },
        _count: true,
      });
      if (live.some((g) => g._count > 1)) fail(`iter ${it}: a unit has more than one live reservation`);
      if (live.length !== k) fail(`iter ${it}: ${live.length} units reserved, expected ${k}`);
      const loser = results.find((r) => r.json?.request?.status === "UNFULFILLABLE");
      if (loser && !String(loser.json.request.explanation?.summary ?? "").includes("None of")) fail(`iter ${it}: loser has no explanation`);

      // ---------- Scenario B: same Idempotency-Key fired 5x concurrently ----------
      if (it % 10 === 0) {
        idemBursts++;
        await cleanIteration();
        await addUnits(1);
        const key = randomUUID();
        const burst = await Promise.all(Array.from({ length: 5 }, () => createReq(hospCookies[0], key, AB_NEG_1)));
        const ids = new Set(burst.map((b) => b.json?.request?.id));
        const created = burst.filter((b) => b.status === 201).length;
        const replayed = burst.filter((b) => b.status === 200 && b.json?.replayed === true).length;
        if (ids.size !== 1) fail(`iter ${it}: idempotent burst produced ${ids.size} different requests`);
        if (created !== 1 || replayed !== 4) fail(`iter ${it}: burst got ${created} created / ${replayed} replayed`);
        const rows = await prisma.bloodRequest.count({ where: { idempotencyKey: key } });
        if (rows !== 1) fail(`iter ${it}: ${rows} rows for one Idempotency-Key`);

        const mismatch = await createReq(hospCookies[0], key, { ...AB_NEG_1, unitsRequested: 2 });
        if (mismatch.status !== 409 || mismatch.json?.error?.code !== "IDEMPOTENCY_KEY_REUSED") {
          fail(`iter ${it}: same key + different body returned ${mismatch.status}`);
        }
      }

      // ---------- Scenario C: cancel and deliver race on the same request ----------
      if (it % 10 === 5) {
        cancelDeliverRaces++;
        await cleanIteration();
        const [u] = await addUnits(1);
        const made = await createReq(hospCookies[1], randomUUID(), AB_NEG_1);
        const reqId = made.json?.request?.id;
        const resvId = made.json?.request?.reservations?.[0]?.id;
        if (!resvId) {
          fail(`iter ${it}: setup for cancel/deliver race did not reserve`);
        } else {
          const [c, d] = await Promise.all([
            call(`/api/requests/${reqId}/cancel`, hospCookies[1], { method: "POST" }),
            call(`/api/reservations/${resvId}/deliver`, bankCookie, { method: "POST" }),
          ]);
          const r = await prisma.bloodRequest.findUniqueOrThrow({ where: { id: reqId } });
          const resv = await prisma.reservation.findUniqueOrThrow({ where: { id: resvId } });
          const unit = await prisma.bloodUnit.findUniqueOrThrow({ where: { id: u.id } });
          const cancelled = r.status === "CANCELLED" && resv.status === "RELEASED" && unit.status === "AVAILABLE";
          const delivered = r.status === "DELIVERED" && resv.status === "DELIVERED" && unit.status === "ISSUED";
          const outcome = cancelled ? "cancel won" : delivered ? "deliver won" : "INCONSISTENT";
          outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
          if (!cancelled && !delivered) fail(`iter ${it}: inconsistent state ${r.status}/${resv.status}/${unit.status}`);
          const okPair = (c.status === 200 && d.status === 409) || (c.status === 409 && d.status === 200);
          if (!okPair) fail(`iter ${it}: cancel=${c.status} deliver=${d.status}, expected exactly one 409`);
        }
      }

      // Reset fixtures so every iteration starts from the same state.
      await cleanIteration();
      if (it % 10 === 0 || it === ITERATIONS) console.log(`  ${it}/${ITERATIONS} iterations, violations so far: ${violations}`);
    }

    // ---------- global invariant across the WHOLE database ----------
    const doubles = await prisma.$queryRaw<{ unitId: string; n: bigint }[]>`
      SELECT "unitId", COUNT(*) AS n FROM "Reservation" WHERE status IN ('ACTIVE','DELIVERED') GROUP BY "unitId" HAVING COUNT(*) > 1`;
    if (doubles.length > 0) fail(`database has ${doubles.length} unit(s) with more than one live reservation`);
  } finally {
    await removeFixtures();
    await prisma.$disconnect();
  }

  latencies.sort((a, b) => a - b);
  const pct = (p: number) => Math.round(latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))]);
  console.log(`
Last-unit races:        ${races} (${winnersTotal} winners, ${losersTotal} correctly refused)
Idempotent bursts:      ${idemBursts} (5 concurrent submits with one key -> 1 request each)
Cancel vs deliver:      ${cancelDeliverRaces} (${Object.entries(outcomes).map(([k, v]) => `${k}: ${v}`).join(", ")})
HTTP status counts:     ${JSON.stringify(statusCounts)}
Latency p50 / p95:      ${pct(50)} ms / ${pct(95)} ms
Invariant violations:   ${violations}
${violations === 0 ? "\nALL RACE INVARIANTS HOLD" : "\nRACE TEST FAILED"}`);
  process.exit(violations === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
