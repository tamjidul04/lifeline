import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const units = await prisma.bloodUnit.count();
  const users = await prisma.user.count();
  console.log(`units=${units} users=${users}`);

  const hospital = await prisma.hospital.findFirstOrThrow();
  const unit = await prisma.bloodUnit.findFirstOrThrow({ where: { status: "AVAILABLE", expiresAt: { gt: new Date() } } });
  const make = () =>
    prisma.bloodRequest.create({
      data: {
        hospitalId: hospital.id,
        createdById: hospital.staffId,
        bloodType: unit.bloodType,
        component: unit.component,
        unitsRequested: 1,
        urgency: "ROUTINE",
        idempotencyKey: `verify-${Math.random()}`,
        requestHash: "x",
      },
    });
  const [r1, r2] = [await make(), await make()];

  await prisma.reservation.create({ data: { requestId: r1.id, unitId: unit.id } });
  let blocked = false;
  try {
    await prisma.reservation.create({ data: { requestId: r2.id, unitId: unit.id } });
  } catch (e) {
    blocked = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
  }
  console.log(`double reservation blocked by DB: ${blocked}`);

  let checkBlocked = false;
  try {
    await prisma.bloodRequest.create({
      data: { hospitalId: hospital.id, createdById: hospital.staffId, bloodType: "O_POS", component: "RBC",
        unitsRequested: 0, urgency: "ROUTINE", idempotencyKey: `verify-${Math.random()}`, requestHash: "x" },
    });
  } catch {
    checkBlocked = true;
  }
  console.log(`unitsRequested=0 blocked by CHECK: ${checkBlocked}`);

  // clean up the verification rows
  await prisma.reservation.deleteMany({ where: { requestId: { in: [r1.id, r2.id] } } });
  await prisma.bloodRequest.deleteMany({ where: { id: { in: [r1.id, r2.id] } } });
  if (!blocked || !checkBlocked) process.exit(1);
}

main().finally(() => prisma.$disconnect());
