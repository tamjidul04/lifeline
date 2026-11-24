import { PrismaClient } from "@prisma/client";
import { resetDemoData } from "../lib/seed";

const prisma = new PrismaClient();

async function main() {
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error("Set SEED_PASSWORD (min 8 chars) in .env before seeding.");
  }
  const accounts = await resetDemoData(prisma, password);
  console.log(`Seeded ${accounts.length} accounts:`);
  for (const a of accounts) console.log(`  ${a.role.padEnd(8)} ${a.email}`);
  console.log("All accounts use the SEED_PASSWORD from your .env.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
