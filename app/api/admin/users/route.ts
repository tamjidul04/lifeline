import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handle, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { createStaffSchema } from "@/lib/schemas";
import { conflict } from "@/lib/errors";
import { audit } from "@/lib/audit";

export const GET = handle(async () => {
  await requireUser(["ADMIN"]);
  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { email: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      bank: { select: { id: true, name: true } },
      hospital: { select: { id: true, name: true } },
    },
  });
  return { users };
});

/**
 * Admin creates BANK or HOSPITAL accounts together with their organisation.
 * ADMIN accounts cannot be created through the API at all (privilege escalation guard).
 */
export const POST = handle(async (req) => {
  const admin = await requireUser(["ADMIN"]);
  const input = createStaffSchema.parse(await readJson(req));
  const passwordHash = await bcrypt.hash(input.password, 10);

  try {
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { email: input.email, name: input.name, role: input.role, passwordHash } });
      const org = { name: input.orgName, lat: input.lat, lng: input.lng };
      if (input.role === "BANK") await tx.bank.create({ data: { ...org, managerId: u.id } });
      else await tx.hospital.create({ data: { ...org, staffId: u.id } });
      await audit(
        { actorId: admin.id, actorLabel: admin.email, action: "USER_CREATED", entity: "User", entityId: u.id, detail: { role: input.role, orgName: input.orgName } },
        tx,
      );
      return u;
    });
    return Response.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw conflict("An account with this email already exists.", "EMAIL_TAKEN");
    }
    throw err;
  }
});
