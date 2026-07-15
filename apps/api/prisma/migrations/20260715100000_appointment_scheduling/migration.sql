-- Create Appointment scheduling model for multi-visit jobs.

CREATE TYPE "AppointmentStatus" AS ENUM (
  'SCHEDULED',
  'CONFIRMED',
  'ON_THE_WAY',
  'ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW'
);

CREATE TYPE "AppointmentType" AS ENUM (
  'INSPECTION',
  'INSTALLATION',
  'MAINTENANCE',
  'RETURN_VISIT',
  'EMERGENCY_VISIT'
);

CREATE TABLE "Appointment" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "assignedUserId" TEXT,
  "appointmentNumber" TEXT NOT NULL,
  "appointmentType" "AppointmentType" NOT NULL DEFAULT 'INSPECTION',
  "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
  "scheduledStart" TIMESTAMP(3) NOT NULL,
  "scheduledEnd" TIMESTAMP(3) NOT NULL,
  "actualStart" TIMESTAMP(3),
  "actualEnd" TIMESTAMP(3),
  "estimatedDurationMinutes" INTEGER,
  "travelDurationMinutes" INTEGER,
  "travelDistanceKm" DECIMAL(8, 2),
  "notes" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppointmentSequence" (
  "businessId" TEXT NOT NULL,
  "nextNumber" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AppointmentSequence_pkey" PRIMARY KEY ("businessId")
);

CREATE UNIQUE INDEX "Appointment_businessId_appointmentNumber_key"
  ON "Appointment"("businessId", "appointmentNumber");

CREATE UNIQUE INDEX "Appointment_id_businessId_key"
  ON "Appointment"("id", "businessId");

CREATE INDEX "Appointment_businessId_jobId_idx"
  ON "Appointment"("businessId", "jobId");

CREATE INDEX "Appointment_businessId_assignedUserId_scheduledStart_idx"
  ON "Appointment"("businessId", "assignedUserId", "scheduledStart");

CREATE INDEX "Appointment_businessId_status_scheduledStart_idx"
  ON "Appointment"("businessId", "status", "scheduledStart");

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_jobId_businessId_fkey"
  FOREIGN KEY ("jobId", "businessId") REFERENCES "Job"("id", "businessId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_assignedUserId_businessId_fkey"
  FOREIGN KEY ("assignedUserId", "businessId") REFERENCES "User"("id", "businessId") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_updatedBy_fkey"
  FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AppointmentSequence"
  ADD CONSTRAINT "AppointmentSequence_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill one appointment for existing jobs so the new scheduling layer
-- immediately has live data without requiring manual re-entry.
INSERT INTO "Appointment" (
  "id",
  "businessId",
  "jobId",
  "assignedUserId",
  "appointmentNumber",
  "appointmentType",
  "status",
  "scheduledStart",
  "scheduledEnd",
  "actualStart",
  "actualEnd",
  "estimatedDurationMinutes",
  "notes",
  "createdBy",
  "updatedBy",
  "createdAt",
  "updatedAt"
)
SELECT
  'appt_' || md5(random()::TEXT || clock_timestamp()::TEXT || "id"),
  "businessId",
  "id",
  "assignedToUserId",
  'APT-' || EXTRACT(YEAR FROM "scheduledStart")::INT || '-' ||
    lpad(row_number() OVER (PARTITION BY "businessId" ORDER BY "scheduledStart", "createdAt")::TEXT, 6, '0'),
  'INSPECTION',
  CASE
    WHEN "status" = 'ON_THE_WAY' THEN 'ON_THE_WAY'::"AppointmentStatus"
    WHEN "status" = 'IN_PROGRESS' THEN 'IN_PROGRESS'::"AppointmentStatus"
    WHEN "status" = 'COMPLETED' THEN 'COMPLETED'::"AppointmentStatus"
    WHEN "status" = 'CANCELLED' THEN 'CANCELLED'::"AppointmentStatus"
    ELSE 'SCHEDULED'::"AppointmentStatus"
  END,
  "scheduledStart",
  COALESCE(
    "scheduledEnd",
    "scheduledStart" + (COALESCE("estimatedDurationMinutes", 120) || ' minutes')::INTERVAL
  ),
  "actualStart",
  "actualEnd",
  "estimatedDurationMinutes",
  "internalNotes",
  "createdBy",
  "updatedBy",
  "createdAt",
  "updatedAt"
FROM "Job"
WHERE "isArchived" = false;

INSERT INTO "AppointmentSequence" ("businessId", "nextNumber", "updatedAt")
SELECT
  "businessId",
  COUNT(*)::INT + 1,
  CURRENT_TIMESTAMP
FROM "Appointment"
GROUP BY "businessId"
ON CONFLICT ("businessId") DO UPDATE
SET "nextNumber" = EXCLUDED."nextNumber", "updatedAt" = CURRENT_TIMESTAMP;
