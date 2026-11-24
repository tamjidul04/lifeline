import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handle, readJson } from "@/lib/api";
import { registerSchema } from "@/lib/schemas";
import { startSession } from "@/lib/auth";
import { conflict } from "@/lib/errors";
import { audit } from "@/lib/audit";

// Default location when a donor does not share one (city centre of the demo region).
const DEFAULT_LOCATION = { lat: 23.78, lng: 90.4 };

/**
 * Public sign-up. Always creates a DONOR; staff accounts are created by an admin.
 * Two layers stop privilege escalation: registerSchema has no `role` field (unknown keys are
 * stripped), and the role below is hard-coded. The hard-coded role is the real control.
 */
export const POST = handle(async (req) => {
  const input = registerSchema.parse(await readJson(req));
  const passwordHash = await bcrypt.hash(input.password, 10);

  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { email: input.email, name: input.name, role: "DONOR", passwordHash },
      });
      await tx.donor.create({
        data: {
          userId: u.id,
          bloodType: input.bloodType,
          lat: input.lat ?? DEFAULT_LOCATION.lat,
          lng: input.lng ?? DEFAULT_LOCATION.lng,
        },
      });
      await audit({ actorId: u.id, actorLabel: u.email, action: "REGISTER", entity: "User", entityId: u.id, detail: { role: "DONOR" } }, tx);
      return u;
    });
  } catch (err) {
    // Emails are lowercased before insert, so "A@x.com" and "a@x.com" collide here (409, not 500).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw conflict("An account with this email already exists.", "EMAIL_TAKEN");
    }
    throw err;
  }

  await startSession(user.id);

  return Response.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } }, { status: 201 });
});
