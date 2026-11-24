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

// Distinct hours-until-expiry so first-expiry-first-out ordering is visible (no ties within a bank).
// Includes near-24h values either side of the "expiring soon" threshold.
const EXPIRY_HOURS = [6, 23, 25, 47, 72, 120, 200, 300, 450, 600, 720, 840];

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
      await tx.session.deleteMany(); // everyone is signed out by a reset
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

      // Donors with fixed locations (deterministic distances). Cooldown cases: 89 days (ineligible),
      // 91 days (eligible), never donated (eligible), 20 days (ineligible).
      const donors: [string, string, BloodType, number | null, number, number][] = [
        ["donor1@lifeline.demo", "Donor One", "O_NEG", 120, 23.76, 90.38],
        ["donor2@lifeline.demo", "Donor Two", "A_POS", 20, 23.81, 90.41],
        ["donor3@lifeline.demo", "Donor Three", "AB_NEG", null, 23.73, 90.43],
        ["donor4@lifeline.demo", "Donor Four", "B_POS", 200, 23.86, 90.37],
        ["donor5@lifeline.demo", "Donor Five", "O_POS", 91, 23.71, 90.4],
        ["donor6@lifeline.demo", "Donor Six", "A_NEG", 89, 23.79, 90.46],
      ];
      for (const [email, name, bloodType, daysAgo, lat, lng] of donors) {
        const u = await mk(email, name, "DONOR");
        await tx.donor.create({
          data: {
            userId: u.id,
            bloodType,
            lastDonationAt: daysAgo === null ? null : new Date(now - daysAgo * 24 * HOUR),
            lat,
            lng,
          },
        });
      }

      const units: { bankId: string; bloodType: BloodType; component: Component; expiresAt: Date }[] = [];
      const addUnits = (bankId: string, spec: [BloodType, Component, number][]) => {
        let i = 0;
        for (const [bloodType, component, count] of spec) {
          for (let c = 0; c < count; c++) {
            // AB- RBC at Central must stay valid for the race demo.
            // +5h per pass through the list keeps every expiry in a bank distinct.
            const hours =
              bloodType === "AB_NEG" ? 480 : EXPIRY_HOURS[i % EXPIRY_HOURS.length] + Math.floor(i / EXPIRY_HOURS.length) * 5;
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

      // The reset is itself audited, so the audit log is never empty after a reset.
      await tx.auditLog.create({
        data: { actorId: null, actorLabel: "system", action: "DEMO_RESET", entity: "System", detail: { units: units.length, accounts: accounts.length } },
      });
    },
    { timeout: 60_000, maxWait: 15_000 },
  );

  return accounts;
}
