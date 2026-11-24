/**
 * Runs the matching engine (read-only) on the live demo stock and prints its decisions.
 *   npx tsx --env-file=.env scripts/explain-demo.ts
 */
import { PrismaClient, type BloodType, type Component, type Urgency } from "@prisma/client";
import { planAllocation } from "../lib/rules";
import { availableUnitWhere } from "../lib/inventory";

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const hospital = await prisma.hospital.findFirstOrThrow({ where: { name: "City General Hospital" } });
  const units = await prisma.bloodUnit.findMany({ where: availableUnitWhere(now), include: { bank: true } });
  const candidates = units.map((u) => ({
    id: u.id, bankId: u.bankId, bankName: u.bank.name, bankLat: u.bank.lat, bankLng: u.bank.lng,
    bloodType: u.bloodType, component: u.component, expiresAt: u.expiresAt,
  }));
  const donors = (await prisma.donor.findMany({ include: { user: true } })).map((d) => ({
    id: d.id, name: d.user.name, bloodType: d.bloodType, lastDonationAt: d.lastDonationAt, lat: d.lat, lng: d.lng,
  }));

  const cases: [string, BloodType, Component, number, Urgency][] = [
    ["Normal routine request", "A_POS", "RBC", 3, "ROUTINE"],
    ["Conflicting constraints (routine, only substitutes)", "A_NEG", "RBC", 3, "ROUTINE"],
    ["Infeasible: AB- x5", "AB_NEG", "RBC", 5, "CRITICAL"],
    ["Plasma", "O_POS", "PLASMA", 2, "URGENT"],
  ];
  for (const [title, bloodType, component, n, urgency] of cases) {
    const plan = planAllocation({ bloodType, component, units: n, urgency, hospital }, candidates, { now, donors });
    console.log(`\n=== ${title} -> ${plan.status}\n${plan.summary}`);
    plan.picks.forEach((p) => console.log(`  + ${p.reason}`));
    plan.swaps.forEach((s) => console.log(`  ~ ${s}`));
    plan.alternatives.forEach((a) => console.log(`  ? ${a.message}`));
  }
}

main().finally(() => prisma.$disconnect());
