/**
 * End-to-end checks for inventory, search/filter/sort, dashboard, audit and admin reset.
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env scripts/api-smoke.ts
 * NOTE: the last step calls "Reset demo data", which restores the seed and signs everyone out.
 */
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PW = process.env.SEED_PASSWORD!;
const prisma = new PrismaClient();
let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
  if (!ok) failures++;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test script inspects arbitrary JSON
type Json = any;
async function call(path: string, cookie = "", init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  if (init.body) headers.set("content-type", "application/json");
  const res = await fetch(BASE + path, { ...init, headers });
  const json: Json = await res.json().catch(() => null);
  return { status: res.status, json };
}
async function login(email: string) {
  const res = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PW }),
  });
  if (res.status !== 200) throw new Error(`login ${email}: ${res.status}`);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}
const sortedBy = <T,>(xs: T[], key: (x: T) => number, dir: 1 | -1) => xs.every((x, i) => i === 0 || (key(xs[i - 1]) - key(x)) * dir <= 0);

async function main() {
  const [admin, central, riverside, city, north, donor] = await Promise.all(
    ["admin", "bank.central", "bank.riverside", "hospital.city", "hospital.north", "donor1"].map((n) => login(`${n}@lifeline.demo`)),
  );
  const banks = await prisma.bank.findMany({ select: { id: true, name: true } });
  const centralId = banks.find((b) => b.name.startsWith("Central"))!.id;
  const riversideId = banks.find((b) => b.name.startsWith("Riverside"))!.id;

  // ---- access
  check("hospital cannot list inventory -> 403", (await call("/api/units", city)).status === 403);
  check("donor cannot list inventory -> 403", (await call("/api/units", donor)).status === 403);
  check("anonymous -> 401", (await call("/api/units")).status === 401);

  // ---- scoping
  const c1 = await call("/api/units?pageSize=100", central);
  check("bank lists only its own units", c1.status === 200 && c1.json.units.every((u: Json) => u.bank.id === centralId) && c1.json.total > 0);
  const snoop = await call(`/api/units?pageSize=100&bankId=${riversideId}`, central);
  check("bank asking for another bank's units still gets only its own", snoop.json.units.every((u: Json) => u.bank.id === centralId));
  const a1 = await call("/api/units?pageSize=100", admin);
  check("admin sees both banks", new Set(a1.json.units.map((u: Json) => u.bank.id)).size === 2);
  const aR = await call(`/api/units?pageSize=100&bankId=${riversideId}`, admin);
  check("admin can narrow to one bank", aR.json.units.length > 0 && aR.json.units.every((u: Json) => u.bank.id === riversideId));

  // ---- filter / search / sort / pagination
  const avail = await call("/api/units?pageSize=100&status=AVAILABLE", admin);
  const expired = await call("/api/units?pageSize=100&status=EXPIRED", admin);
  check("status=AVAILABLE contains no expired units", avail.json.units.every((u: Json) => u.hoursLeft > 0 && u.status === "AVAILABLE"));
  check("status=EXPIRED finds the 2 seeded expired units", expired.json.total === 2 && expired.json.units.every((u: Json) => u.hoursLeft <= 0));
  check("AVAILABLE + EXPIRED = all unretired units", avail.json.total + expired.json.total === a1.json.total);

  const abneg = await call("/api/units?pageSize=100&q=ab-", admin);
  check("search 'ab-' finds only AB− units", abneg.json.units.length > 0 && abneg.json.units.every((u: Json) => u.bloodType === "AB_NEG"));
  const byBank = await call("/api/units?pageSize=100&q=riverside", admin);
  check("search by bank name", byBank.json.units.length > 0 && byBank.json.units.every((u: Json) => u.bank.id === riversideId));
  const combo = await call("/api/units?pageSize=100&bloodType=O_POS&component=RBC&status=AVAILABLE&sort=expiry_asc", admin);
  check("combined filters (type + component + status)", combo.json.units.length > 0 && combo.json.units.every((u: Json) => u.bloodType === "O_POS" && u.component === "RBC"));
  check("sort expiry ascending", sortedBy(combo.json.units, (u: Json) => +new Date(u.expiresAt), 1));
  const desc = await call("/api/units?pageSize=100&sort=expiry_desc", admin);
  check("sort expiry descending", sortedBy(desc.json.units, (u: Json) => +new Date(u.expiresAt), -1));
  const soon = await call("/api/units?pageSize=100&expiringWithinHours=48&status=AVAILABLE", admin);
  check("expiring within 48h", soon.json.units.length > 0 && soon.json.units.every((u: Json) => u.hoursLeft > 0 && u.hoursLeft <= 48));
  const p1 = await call("/api/units?pageSize=10&page=1&sort=expiry_asc", admin);
  const p2 = await call("/api/units?pageSize=10&page=2&sort=expiry_asc", admin);
  const ids1 = new Set(p1.json.units.map((u: Json) => u.id));
  check("pagination: pages are disjoint and total is consistent", p2.json.units.every((u: Json) => !ids1.has(u.id)) && p1.json.total === a1.json.total && p1.json.totalPages === Math.ceil(a1.json.total / 10));
  check("bad params -> 400", (await call("/api/units?pageSize=5000", admin)).status === 400 && (await call("/api/units?sort=bogus", admin)).status === 400);

  // ---- adding stock
  const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
  const add = await call("/api/units", central, { method: "POST", body: JSON.stringify({ bloodType: "B_NEG", component: "RBC", quantity: 3, expiresAt: future }) });
  check("bank adds 3 units -> 201", add.status === 201 && add.json.added === 3);
  const after = await call("/api/units?pageSize=100&bloodType=B_NEG&component=RBC&status=AVAILABLE", central);
  check("added units appear in the bank's inventory", after.json.units.filter((u: Json) => +new Date(u.expiresAt) === +new Date(future)).length === 3);
  check("past expiry -> 400", (await call("/api/units", central, { method: "POST", body: JSON.stringify({ bloodType: "B_NEG", component: "RBC", quantity: 1, expiresAt: "2020-01-01T00:00:00Z" }) })).status === 400);
  check("quantity 0 -> 400", (await call("/api/units", central, { method: "POST", body: JSON.stringify({ bloodType: "B_NEG", component: "RBC", quantity: 0, expiresAt: future }) })).status === 400);
  check("admin cannot add stock -> 403", (await call("/api/units", admin, { method: "POST", body: JSON.stringify({ bloodType: "B_NEG", component: "RBC", quantity: 1, expiresAt: future }) })).status === 403);

  // ---- dashboards use the single availability definition
  const dbAvailable = await prisma.bloodUnit.count({ where: { status: "AVAILABLE", expiresAt: { gt: new Date() }, reservations: { none: { status: { in: ["ACTIVE", "DELIVERED"] } } } } });
  const dashAdmin = await call("/api/dashboard", admin);
  check("admin dashboard stock = DB count excluding expired", dashAdmin.json.dashboard.stock.total === dbAvailable, `${dashAdmin.json.dashboard.stock.total} vs ${dbAvailable}`);
  check("stock cells add up to the total", dashAdmin.json.dashboard.stock.byTypeAndComponent.reduce((s: number, c: Json) => s + c.count, 0) === dashAdmin.json.dashboard.stock.total);
  const dashBank = await call("/api/dashboard", central);
  check("bank dashboard counts only its own stock", dashBank.json.dashboard.stock.total > 0 && dashBank.json.dashboard.stock.total < dashAdmin.json.dashboard.stock.total);

  // ---- request lists are scoped, filterable, and reservations show up in the dashboard
  const create = await call("/api/requests", city, {
    method: "POST", headers: { "idempotency-key": randomUUID() },
    body: JSON.stringify({ bloodType: "A_POS", component: "RBC", unitsRequested: 2, urgency: "ROUTINE" }),
  });
  check("hospital creates a request that matches", create.status === 201 && create.json.request.status === "MATCHED" && create.json.request.reservations.length === 2);
  check("explanation is stored", create.json.request.explanation?.picks?.length === 2 && String(create.json.request.explanation.summary).length > 0);
  const mine = await call("/api/requests?status=MATCHED", city);
  check("hospital list shows own matched request", mine.json.requests.some((r: Json) => r.id === create.json.request.id));
  const theirs = await call("/api/requests", north);
  check("other hospital's list does not include it", !theirs.json.requests.some((r: Json) => r.id === create.json.request.id));
  const bankView = await call("/api/requests", riverside);
  check("bank list shows requests holding its units; each reservation is its own", bankView.json.requests.every((r: Json) => r.reservations.every((x: Json) => x.unit.bankId === riversideId)));
  const dashHosp = await call("/api/dashboard", city);
  check("hospital dashboard counts by status", dashHosp.json.dashboard.requestsByStatus.MATCHED >= 1);
  check("bank dashboard shows reservations awaiting delivery", (await call("/api/dashboard", riverside)).json.dashboard.reservationsAwaitingDelivery >= 0);

  // ---- audit log
  check("audit: bank -> 403", (await call("/api/admin/audit", central)).status === 403);
  const audit = await call("/api/admin/audit?action=UNITS_ADDED", admin);
  check("audit: admin filters by action", audit.status === 200 && audit.json.total >= 1 && audit.json.entries.every((e: Json) => e.action === "UNITS_ADDED"));
  const auditReq = await call("/api/admin/audit?action=REQUEST_CREATED&q=hospital.city", admin);
  check("audit: search by actor", auditReq.json.entries.length >= 1 && auditReq.json.entries.every((e: Json) => e.actorLabel.includes("hospital.city")));

  // ---- admin reset (last: signs everyone out)
  check("reset: hospital -> 403", (await call("/api/admin/reset", city, { method: "POST" })).status === 403);
  const [r1, r2] = await Promise.all([call("/api/admin/reset", admin, { method: "POST" }), call("/api/admin/reset", admin, { method: "POST" })]);
  check("two simultaneous resets both succeed without error", [r1.status, r2.status].every((s) => s === 200), `${r1.status},${r2.status}`);
  check("reset signs everyone out", (await call("/api/auth/me", admin)).status === 401);
  const units = await prisma.bloodUnit.count();
  const users = await prisma.user.count();
  const reqs = await prisma.bloodRequest.count();
  check("seed restored exactly once (47 units, 11 users, 0 requests)", units === 47 && users === 11 && reqs === 0, `${units}/${users}/${reqs}`);
  const adminAgain = await login("admin@lifeline.demo");
  const log = await call("/api/admin/audit?action=DEMO_RESET", adminAgain);
  check("reset is recorded in the audit log", log.json.total >= 1);

  await prisma.$disconnect();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
