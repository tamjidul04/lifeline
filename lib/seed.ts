import bcrypt from "bcryptjs";
import type { BloodType, Component, PrismaClient } from "@prisma/client";

const HOUR = 3600 * 1000;

// Units per bank: [bloodType, component, count]. AB- RBC at Central is deliberately a single
// unit: it is the "last available unit" used by the A05 race demo.
const CENTRAL: [BloodType, Component, number][] = [
  ["O_NEG", "RBC", 3], ["O_POS", "RBC", 5], ["A_POS", "RBC", 4], ["A_NEG", "RBC", 1],
  ["B_POS", "RBC", 3], ["AB_POS", "RBC", 2], ["AB_NEG", "RBC", 1],
  ["AB_POS", "PLASMA", 2], ["A_POS", "PLASMA", 2], ["O_POS", "PLASMA", 2],
  ["O_POS", "PLATELETS", 2], ["A_POS", "PLATELETS", 1],
];
const RIVERSIDE: [BloodType, Component, number][] = [
  ["O_NEG", "RBC", 2], ["O_POS", "RBC", 4], ["A_POS", "RBC", 3], ["B_NEG", "RBC", 1],
  ["B_POS", "RBC", 2], ["AB_POS", "RBC", 1],
  ["A_POS", "PLASMA", 1], ["B_POS", "PLASMA", 2], ["B_POS", "PLATELETS", 1],
];

// Spread of hours-until-expiry so FEFO and expiry rules are visible in the demo.
const EXPIRY_HOURS = [20, 60, 120, 240, 480, 840];

type Seeded = { email: string; role: string };

/**
 * Wipes all application data and re-creates the demo dataset. Idempotent.
 * Used by `npm run seed` and by the admin "Reset demo data" action.
 */
export async function resetDemoData(prisma: PrismaClient, password: string): Promise<Seeded[]> {
  const passwordHash = await bcrypt.hash(password, 10);
  const now = Date.now();
  const accounts: Seeded[] = [];

  await prisma.$transaction(
    async (tx) => {
      await tx.reservation.deleteMany();
      await tx.bloodRequest.deleteMany();
      await tx.bloodUnit.deleteMany();
      await tx.donor.deleteMany();
      await tx.bank.deleteMany();
      await tx.hospital.deleteMany();
      await tx.auditLog.deleteMany();
      await tx.user.deleteMany();

      const mk = async (email: string, name: string, role: "ADMIN" | "BANK" | "HOSPITAL" | "DONOR") => {
        accounts.push({ email, role });
        return tx.user.create({ data: { email, name, role, passwordHash } });
      };

      await mk("admin@lifeline.demo", "Demo Admin", "ADMIN");

      const bankUsers = [
        await mk("bank.central@lifeline.demo", "Central Bank Manager", "BANK"),
        await mk("bank.riverside@lifeline.demo", "Riverside Bank Manager", "BANK"),
      ];
      const banks = [
        await tx.bank.create({ data: { name: "Central Blood Bank", lat: 23.78, lng: 90.4, managerId: bankUsers[0].id } }),
        await tx.bank.create({ data: { name: "Riverside Blood Bank", lat: 23.7, lng: 90.45, managerId: bankUsers[1].id } }),
      ];

      const hospUsers = [
        await mk("hospital.city@lifeline.demo", "City Hospital Staff", "HOSPITAL"),
        await mk("hospital.north@lifeline.demo", "North Hospital Staff", "HOSPITAL"),
      ];
      await tx.hospital.create({ data: { name: "City General Hospital", lat: 23.75, lng: 90.39, staffId: hospUsers[0].id } });
      await tx.hospital.create({ data: { name: "North Medical Center", lat: 23.88, lng: 90.4, staffId: hospUsers[1].id } });

      // Donors: one recently donated (ineligible), one never donated (eligible), rest eligible.
      const donors: [string, string, BloodType, number | null][] = [
        ["donor1@lifeline.demo", "Donor One", "O_NEG", 120],
        ["donor2@lifeline.demo", "Donor Two", "A_POS", 20],
        ["donor3@lifeline.demo", "Donor Three", "AB_NEG", null],
        ["donor4@lifeline.demo", "Donor Four", "B_POS", 200],
        ["donor5@lifeline.demo", "Donor Five", "O_POS", 91],
        ["donor6@lifeline.demo", "Donor Six", "A_NEG", 89],
      ];
      for (const [email, name, bloodType, daysAgo] of donors) {
        const u = await mk(email, name, "DONOR");
        await tx.donor.create({
          data: {
            userId: u.id,
            bloodType,
            lastDonationAt: daysAgo === null ? null : new Date(now - daysAgo * 24 * HOUR),
            lat: 23.7 + Math.random() * 0.2,
            lng: 90.35 + Math.random() * 0.15,
          },
        });
      }

      const units: { bankId: string; bloodType: BloodType; component: Component; expiresAt: Date }[] = [];
      const addUnits = (bankId: string, spec: [BloodType, Component, number][]) => {
        let i = 0;
        for (const [bloodType, component, count] of spec) {
          for (let c = 0; c < count; c++) {
            // AB- RBC at Central must stay valid for the race demo.
            const hours = bloodType === "AB_NEG" ? 480 : EXPIRY_HOURS[i % EXPIRY_HOURS.length];
            units.push({ bankId, bloodType, component, expiresAt: new Date(now + hours * HOUR) });
            i++;
          }
        }
        // One already-expired unit per bank: must never be allocated.
        units.push({ bankId, bloodType: "O_POS", component: "RBC", expiresAt: new Date(now - 5 * HOUR) });
      };
      addUnits(banks[0].id, CENTRAL);
      addUnits(banks[1].id, RIVERSIDE);
      await tx.bloodUnit.createMany({ data: units });
    },
    { timeout: 60_000, maxWait: 15_000 },
  );

  return accounts;
}
