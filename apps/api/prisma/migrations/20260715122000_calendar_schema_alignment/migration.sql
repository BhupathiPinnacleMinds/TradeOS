ALTER TABLE "Appointment" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "AppointmentSequence" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE INDEX IF NOT EXISTS "Job_businessId_status_scheduledStart_idx" ON "Job"("businessId", "status", "scheduledStart");
