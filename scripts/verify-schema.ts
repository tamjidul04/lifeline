/**
 * Proves the database itself enforces the key invariants. Safe to run against the demo DB:
 * it works only on fixture rows it creates and always removes them, so seeded units are untouched.
 *   npm run verify:db
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
let failures = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
};
const rejects = async (fn: () => Promise<unknown>, code?: string) => {
  try {
    await fn();
    return false;
  } catch (e) {
    return code ? e instanceof Prisma.PrismaClientKnownRequestError && e.code === code : true;
  }
};

async function main() {
  const hospital = await prisma.hospital.findFirstOrThrow();
  const bank = await prisma.bank.findFirstOrThrow();
  const tag = `verify-${Date.now()}`;

  const unit = await prisma.bloodUnit.create({
    data: { bankId: bank.id, bloodType: "O_POS", component: "RBC", expiresAt: new Date(Date.now() + 86_400_000) },
  });
  const mkReq = (n: number, units = 1) =>
    prisma.bloodRequest.create({
      data: {
        hospitalId: hospital.id, createdById: hospital.staffId, bloodType: "O_POS", component: "RBC",
        unitsRequested: units, urgency: "ROUTINE", idempotencyKey: `${tag}-${n}`, requestHash: "x",
      },
    });

  const created: string[] = [];
  try {
    const r1 = await mkReq(1);
    const r2 = await mkReq(2);
    created.push(r1.id, r2.id);

    const first = await prisma.reservation.create({ data: { requestId: r1.id, unitId: unit.id } });
    check("second ACTIVE reservation on the same unit is rejected (P2002)",
      await rejects(() => prisma.reservation.create({ data: { requestId: r2.id, unitId: unit.id } }), "P2002"));

    await prisma.reservation.update({ where: { id: first.id }, data: { status: "RELEASED", releasedAt: new Date() } });
    const again = await prisma.reservation.create({ data: { requestId: r2.id, unitId: unit.id } });
    check("unit can be reserved again after the first reservation is RELEASED", !!again);

    check("DELIVERED without deliveredAt is rejected (CHECK)",
      await rejects(() => prisma.reservation.update({ where: { id: again.id }, data: { status: "DELIVERED" } })));

    for (const n of [0, 21, -1]) {
      check(`unitsRequested=${n} is rejected (CHECK 1..20)`, await rejects(async () => created.push((await mkReq(100 + n, n)).id)));
    }
    const twenty = await mkReq(120, 20);
    created.push(twenty.id);
    check("unitsRequested=20 is accepted (upper boundary)", !!twenty);

    check("duplicate idempotency key for the same hospital is rejected (P2002)", await rejects(() => mkReq(1), "P2002"));
  } finally {
    await prisma.reservation.deleteMany({ where: { unitId: unit.id } });
    await prisma.bloodRequest.deleteMany({ where: { id: { in: created } } });
    await prisma.bloodUnit.delete({ where: { id: unit.id } });
    await prisma.$disconnect();
  }

  console.log(failures === 0 ? "\nALL DB INVARIANTS HOLD" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
