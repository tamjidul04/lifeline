/**
 * End-to-end auth & isolation checks against a RUNNING app (local or live).
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env scripts/auth-smoke.ts
 * Uses SEED_PASSWORD for the demo accounts and Prisma to set up/clean up fixtures.
 */
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PW = process.env.SEED_PASSWORD!;
const prisma = new PrismaClient();

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
}

async function call(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test script inspects arbitrary JSON
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, setCookie: res.headers.get("set-cookie") ?? "", headers: res.headers };
}

async function login(email: string, password = PW) {
  const r = await call("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  const cookie = r.setCookie.split(";")[0];
  return { ...r, cookie };
}

async function main() {
  const stamp = Date.now();
  const tempEmails: string[] = [];
  let reqId: string | undefined;

  try {
    // --- health & unauthenticated access
    const h = await call("/api/health");
    check("health reports DB up", h.status === 200 && h.json?.db === "up", `status ${h.status}`);

    const anon = await call("/api/auth/me");
    check("API without session -> 401 JSON", anon.status === 401 && anon.json?.error?.code === "UNAUTHENTICATED");

    const page = await call("/dashboard");
    check("page without session -> redirect to /login", [307, 308].includes(page.status) && (page.headers.get("location") ?? "").includes("/login"));

    // --- login behaviour
    const wrongPw = await login("admin@lifeline.demo", "wrong-password-1");
    const noUser = await login(`nobody-${stamp}@lifeline.demo`, "wrong-password-1");
    check("wrong password -> 401", wrongPw.status === 401);
    check("unknown user and wrong password give IDENTICAL errors",
      noUser.status === 401 && JSON.stringify(noUser.json) === JSON.stringify(wrongPw.json));

    const mixedCase = await login("  ADMIN@LifeLine.Demo ");
    check("email is case-insensitive on login", mixedCase.status === 200);

    const admin = await login("admin@lifeline.demo");
    check("cookie is HttpOnly + SameSite=Lax + Max-Age",
      /httponly/i.test(admin.setCookie) && /samesite=lax/i.test(admin.setCookie) && /max-age=28800/i.test(admin.setCookie));

    const me = await call("/api/auth/me", { cookie: admin.cookie });
    check("session works and never returns passwordHash", me.status === 200 && me.json?.user?.role === "ADMIN" && !JSON.stringify(me.json).includes("passwordHash"));

    const tampered = admin.cookie.slice(0, -4) + "AAAA";
    check("tampered cookie -> 401", (await call("/api/auth/me", { cookie: tampered })).status === 401);

    // --- registration and privilege escalation
    const regEmail = `escalate-${stamp}@example.com`;
    tempEmails.push(regEmail);
    const reg = await call("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name: "Sneaky", email: regEmail, password: "secret123", bloodType: "O_NEG", role: "ADMIN" }),
    });
    check("self-register with role=ADMIN still creates a DONOR", reg.status === 201 && reg.json?.user?.role === "DONOR", `got ${reg.json?.user?.role}`);
    const stored = await prisma.user.findUnique({ where: { email: regEmail }, include: { bank: true, hospital: true, donor: true } });
    check("...and the STORED user is a DONOR with no bank/hospital", stored?.role === "DONOR" && !stored.bank && !stored.hospital && !!stored.donor);

    const dup = await call("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name: "Dup", email: regEmail.toUpperCase(), password: "secret123", bloodType: "A_POS" }),
    });
    check("duplicate email in different case -> 409", dup.status === 409 && dup.json?.error?.code === "EMAIL_TAKEN");

    const bad = await call("/api/auth/register", { method: "POST", body: JSON.stringify({ email: "x", password: "1" }) });
    check("invalid registration -> 400 with field details", bad.status === 400 && Array.isArray(bad.json?.error?.details));

    const badJson = await call("/api/auth/login", { method: "POST", body: "{not json" });
    check("malformed JSON -> 400, not 500", badJson.status === 400);

    const donor = await login("donor1@lifeline.demo");
    check("donor -> admin endpoint is 403", (await call("/api/admin/users", { cookie: donor.cookie })).status === 403);

    const staffAdmin = await call("/api/admin/users", {
      method: "POST",
      cookie: admin.cookie,
      body: JSON.stringify({ name: "Evil", email: `evil-${stamp}@x.com`, password: "secret123", role: "ADMIN", orgName: "X", lat: 1, lng: 1 }),
    });
    check("admin cannot create another ADMIN via API", staffAdmin.status === 400);

    // --- resource isolation: requests
    const [cityHosp, northHosp] = await Promise.all([
      prisma.hospital.findFirstOrThrow({ where: { staff: { email: "hospital.city@lifeline.demo" } } }),
      prisma.hospital.findFirstOrThrow({ where: { staff: { email: "hospital.north@lifeline.demo" } } }),
    ]);
    const req = await prisma.bloodRequest.create({
      data: {
        hospitalId: cityHosp.id, createdById: cityHosp.staffId, bloodType: "O_POS", component: "RBC",
        unitsRequested: 1, urgency: "ROUTINE", idempotencyKey: `smoke-${stamp}`, requestHash: "smoke",
      },
    });
    reqId = req.id;
    void northHosp;

    const city = await login("hospital.city@lifeline.demo");
    const north = await login("hospital.north@lifeline.demo");
    const central = await login("bank.central@lifeline.demo");
    const riverside = await login("bank.riverside@lifeline.demo");

    check("owning hospital can read its request", (await call(`/api/requests/${req.id}`, { cookie: city.cookie })).status === 200);
    const stolen = await call(`/api/requests/${req.id}`, { cookie: north.cookie });
    check("OTHER hospital reading request by id -> 404", stolen.status === 404);
    const ghost = await call(`/api/requests/does-not-exist`, { cookie: north.cookie });
    check("other hospital cannot tell 'exists' from 'missing'", JSON.stringify(stolen.json) === JSON.stringify(ghost.json));
    check("bank without a reservation on it -> 404", (await call(`/api/requests/${req.id}`, { cookie: central.cookie })).status === 404);
    check("admin can read any request", (await call(`/api/requests/${req.id}`, { cookie: admin.cookie })).status === 200);
    const leak = await call(`/api/requests/${req.id}`, { cookie: city.cookie });
    check("request response hides idempotency internals", !("idempotencyKey" in (leak.json?.request ?? {})));

    // --- resource isolation: units
    const centralUnit = await prisma.bloodUnit.findFirstOrThrow({
      where: { bank: { manager: { email: "bank.central@lifeline.demo" } }, status: "AVAILABLE", expiresAt: { gt: new Date() } },
    });
    const patch = (cookie: string, version: number) =>
      call(`/api/units/${centralUnit.id}`, { method: "PATCH", cookie, body: JSON.stringify({ action: "RETIRE", version }) });

    check("OTHER bank retiring a unit -> 404", (await patch(riverside.cookie, centralUnit.version)).status === 404);
    check("hospital retiring a unit -> 403", (await patch(city.cookie, centralUnit.version)).status === 403);
    check("admin is read-only on inventory -> 403", (await patch(admin.cookie, centralUnit.version)).status === 403);
    check("stale version -> 409", (await patch(central.cookie, centralUnit.version + 99)).status === 409);
    const own = await patch(central.cookie, centralUnit.version);
    check("owning bank can retire its unit", own.status === 200 && own.json?.unit?.status === "RETIRED");
    check("retiring twice -> 409 (duplicate action)", (await patch(central.cookie, centralUnit.version)).status === 409);
    await prisma.bloodUnit.update({ where: { id: centralUnit.id }, data: { status: "AVAILABLE" } });

    // --- bank visibility follows LIVE reservations only
    const resv = await prisma.reservation.create({ data: { requestId: req.id, unitId: centralUnit.id } });
    check("bank with an ACTIVE reservation can read the request", (await call(`/api/requests/${req.id}`, { cookie: central.cookie })).status === 200);
    check("a different bank still cannot", (await call(`/api/requests/${req.id}`, { cookie: riverside.cookie })).status === 404);
    await prisma.reservation.update({ where: { id: resv.id }, data: { status: "RELEASED", releasedAt: new Date() } });
    check("after the reservation is RELEASED the bank loses access -> 404", (await call(`/api/requests/${req.id}`, { cookie: central.cookie })).status === 404);

    // --- CSRF
    const csrf = await call("/api/auth/logout", { method: "POST", cookie: admin.cookie, headers: { origin: "https://evil.example" } });
    check("cross-site POST (foreign Origin) is blocked -> 403", csrf.status === 403 && csrf.json?.error?.code === "CSRF");
    const csrf2 = await call("/api/auth/logout", { method: "POST", cookie: admin.cookie, headers: { "sec-fetch-site": "cross-site" } });
    check("cross-site POST (Sec-Fetch-Site) is blocked -> 403", csrf2.status === 403 && csrf2.json?.error?.code === "CSRF");

    // --- logout revokes the session server-side
    const out = await call("/api/auth/logout", { method: "POST", cookie: donor.cookie });
    check("logout clears the cookie", out.status === 200 && /lifeline_session=;/.test(out.setCookie));
    const replay = await call("/api/auth/me", { cookie: donor.cookie });
    check("a COPIED cookie replayed after logout -> 401", replay.status === 401);
    const stillIn = await call("/api/auth/me", { cookie: admin.cookie });
    check("other users' sessions are unaffected", stillIn.status === 200);

    // --- rate limit (separate email so real accounts are not locked)
    const victim = `ratelimit-${stamp}@lifeline.demo`;
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await login(victim, "wrong-password-1")).status;
    check("6th failed login in a row -> 429", last === 429, `got ${last}`);
  } finally {
    if (reqId) {
      await prisma.reservation.deleteMany({ where: { requestId: reqId } });
      await prisma.bloodRequest.delete({ where: { id: reqId } }).catch(() => {});
    }
    for (const email of tempEmails) {
      const u = await prisma.user.findUnique({ where: { email } });
      if (u) {
        await prisma.donor.deleteMany({ where: { userId: u.id } });
        await prisma.auditLog.deleteMany({ where: { actorId: u.id } });
        await prisma.user.delete({ where: { id: u.id } }); // sessions cascade
      }
    }
    await prisma.$disconnect();
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
