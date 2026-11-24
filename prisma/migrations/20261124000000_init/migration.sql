-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'BANK', 'HOSPITAL', 'DONOR');

-- CreateEnum
CREATE TYPE "BloodType" AS ENUM ('O_NEG', 'O_POS', 'A_NEG', 'A_POS', 'B_NEG', 'B_POS', 'AB_NEG', 'AB_POS');

-- CreateEnum
CREATE TYPE "Component" AS ENUM ('RBC', 'PLASMA', 'PLATELETS');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('AVAILABLE', 'ISSUED', 'RETIRED');

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('CRITICAL', 'URGENT', 'ROUTINE');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('OPEN', 'MATCHED', 'PARTIAL', 'DELIVERED', 'CANCELLED', 'UNFULFILLABLE');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'DELIVERED', 'RELEASED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bank" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "managerId" TEXT NOT NULL,

    CONSTRAINT "Bank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hospital" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "staffId" TEXT NOT NULL,

    CONSTRAINT "Hospital_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Donor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bloodType" "BloodType" NOT NULL,
    "lastDonationAt" TIMESTAMP(3),
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Donor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BloodUnit" (
    "id" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "bloodType" "BloodType" NOT NULL,
    "component" "Component" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "UnitStatus" NOT NULL DEFAULT 'AVAILABLE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BloodUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BloodRequest" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "bloodType" "BloodType" NOT NULL,
    "component" "Component" NOT NULL,
    "unitsRequested" INTEGER NOT NULL,
    "urgency" "Urgency" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'OPEN',
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "explanation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BloodRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Bank_managerId_key" ON "Bank"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "Hospital_staffId_key" ON "Hospital"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "Donor_userId_key" ON "Donor"("userId");

-- CreateIndex
CREATE INDEX "BloodUnit_bankId_status_idx" ON "BloodUnit"("bankId", "status");

-- CreateIndex
CREATE INDEX "BloodUnit_component_bloodType_expiresAt_idx" ON "BloodUnit"("component", "bloodType", "expiresAt");

-- CreateIndex
CREATE INDEX "BloodRequest_hospitalId_status_idx" ON "BloodRequest"("hospitalId", "status");

-- CreateIndex
CREATE INDEX "BloodRequest_status_createdAt_idx" ON "BloodRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BloodRequest_hospitalId_idempotencyKey_key" ON "BloodRequest"("hospitalId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Reservation_requestId_idx" ON "Reservation"("requestId");

-- CreateIndex
CREATE INDEX "Reservation_unitId_status_idx" ON "Reservation"("unitId", "status");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- AddForeignKey
ALTER TABLE "Bank" ADD CONSTRAINT "Bank_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hospital" ADD CONSTRAINT "Hospital_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donor" ADD CONSTRAINT "Donor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BloodUnit" ADD CONSTRAINT "BloodUnit_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BloodRequest" ADD CONSTRAINT "BloodRequest_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BloodRequest" ADD CONSTRAINT "BloodRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "BloodRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "BloodUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== Hand-written constraints (Prisma cannot express these) =====

-- Request size sanity: 1..20 units
ALTER TABLE "BloodRequest" ADD CONSTRAINT "BloodRequest_unitsRequested_check"
  CHECK ("unitsRequested" BETWEEN 1 AND 20);

-- Version counters never negative
ALTER TABLE "BloodUnit" ADD CONSTRAINT "BloodUnit_version_check" CHECK ("version" >= 0);

-- THE A05 GUARANTEE: a unit can have at most ONE live (ACTIVE or DELIVERED) reservation.
-- Two concurrent reservers cannot both insert; the loser gets a unique violation (P2002).
CREATE UNIQUE INDEX "Reservation_one_live_per_unit"
  ON "Reservation" ("unitId")
  WHERE "status" IN ('ACTIVE', 'DELIVERED');
