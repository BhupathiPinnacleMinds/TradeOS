-- Add technician execution workflow status.
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'PAUSED';

-- Add source-of-truth execution timestamps and persisted completion totals.
ALTER TABLE "Appointment"
  ADD COLUMN "travelStartedAt" TIMESTAMP(3),
  ADD COLUMN "arrivedAt" TIMESTAMP(3),
  ADD COLUMN "workStartedAt" TIMESTAMP(3),
  ADD COLUMN "currentWorkStartedAt" TIMESTAMP(3),
  ADD COLUMN "pausedAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "totalTravelMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalWorkMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalPausedMinutes" INTEGER NOT NULL DEFAULT 0;

-- Store customer signatures as tenant-scoped audit records.
CREATE TABLE "AppointmentSignature" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "customerName" TEXT,
  "signerTitle" TEXT,
  "consentText" TEXT NOT NULL,
  "signatureData" JSONB,
  "skipReason" TEXT,
  "capturedByUserId" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3),
  "skippedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AppointmentSignature_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppointmentSignature_businessId_appointmentId_key"
  ON "AppointmentSignature"("businessId", "appointmentId");
CREATE INDEX "AppointmentSignature_businessId_jobId_createdAt_idx"
  ON "AppointmentSignature"("businessId", "jobId", "createdAt");
CREATE INDEX "AppointmentSignature_businessId_capturedByUserId_createdAt_idx"
  ON "AppointmentSignature"("businessId", "capturedByUserId", "createdAt");

ALTER TABLE "AppointmentSignature"
  ADD CONSTRAINT "AppointmentSignature_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AppointmentSignature"
  ADD CONSTRAINT "AppointmentSignature_appointmentId_businessId_fkey"
  FOREIGN KEY ("appointmentId", "businessId") REFERENCES "Appointment"("id", "businessId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AppointmentSignature"
  ADD CONSTRAINT "AppointmentSignature_jobId_businessId_fkey"
  FOREIGN KEY ("jobId", "businessId") REFERENCES "Job"("id", "businessId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AppointmentSignature"
  ADD CONSTRAINT "AppointmentSignature_capturedByUserId_businessId_fkey"
  FOREIGN KEY ("capturedByUserId", "businessId") REFERENCES "User"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;
