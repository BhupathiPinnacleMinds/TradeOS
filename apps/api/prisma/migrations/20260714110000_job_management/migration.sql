CREATE TYPE "JobStatus_new" AS ENUM ('NEW', 'SCHEDULED', 'ON_THE_WAY', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED');
CREATE TYPE "JobPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

ALTER TABLE "Job" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "JobStatus" RENAME TO "JobStatus_old";
ALTER TYPE "JobStatus_new" RENAME TO "JobStatus";

ALTER TABLE "Job"
  ADD COLUMN "assignedToUserId" TEXT,
  ADD COLUMN "jobNumber" TEXT,
  ADD COLUMN "tradeType" TEXT,
  ADD COLUMN "priority" "JobPriority" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "scheduledStart" TIMESTAMP(3),
  ADD COLUMN "scheduledEnd" TIMESTAMP(3),
  ADD COLUMN "estimatedDurationMinutes" INTEGER,
  ADD COLUMN "actualStart" TIMESTAMP(3),
  ADD COLUMN "actualEnd" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "addressLine1" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN "suburb" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "postcode" TEXT,
  ADD COLUMN "accessInstructions" TEXT,
  ADD COLUMN "customerNotes" TEXT,
  ADD COLUMN "internalNotes" TEXT,
  ADD COLUMN "requiresQuote" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requiresInvoice" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "invoiceCreated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "quoteCreated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "createdBy" TEXT,
  ADD COLUMN "updatedBy" TEXT;

ALTER TABLE "Job"
  ALTER COLUMN "status" TYPE "JobStatus"
  USING (
    CASE
      WHEN "status"::text IN ('LEAD', 'QUOTED') THEN 'NEW'
      ELSE "status"::text
    END
  )::"JobStatus";

UPDATE "Job"
SET
  "scheduledStart" = COALESCE("startsAt", "createdAt"),
  "scheduledEnd" = "endsAt",
  "addressLine1" = COALESCE(NULLIF("address", ''), 'Address not recorded'),
  "suburb" = 'Sydney',
  "state" = 'NSW',
  "postcode" = '2000';

WITH numbered AS (
  SELECT
    id,
    "businessId",
    ROW_NUMBER() OVER (PARTITION BY "businessId" ORDER BY "createdAt", id) AS sequence
  FROM "Job"
)
UPDATE "Job"
SET "jobNumber" = 'JOB-' || EXTRACT(YEAR FROM "Job"."createdAt")::int::text || '-' || LPAD(numbered.sequence::text, 6, '0')
FROM numbered
WHERE "Job".id = numbered.id;

ALTER TABLE "Job"
  ALTER COLUMN "status" SET DEFAULT 'NEW',
  ALTER COLUMN "scheduledStart" SET NOT NULL,
  ALTER COLUMN "addressLine1" SET NOT NULL,
  ALTER COLUMN "suburb" SET NOT NULL,
  ALTER COLUMN "state" SET NOT NULL,
  ALTER COLUMN "postcode" SET NOT NULL,
  ALTER COLUMN "jobNumber" SET NOT NULL;

ALTER TABLE "Job" DROP COLUMN "startsAt";
ALTER TABLE "Job" DROP COLUMN "endsAt";
ALTER TABLE "Job" DROP COLUMN "address";

DROP TYPE "JobStatus_old";

CREATE TABLE "JobSequence" (
  "businessId" TEXT NOT NULL,
  "nextNumber" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobSequence_pkey" PRIMARY KEY ("businessId")
);

INSERT INTO "JobSequence" ("businessId", "nextNumber", "updatedAt")
SELECT
  "Business".id,
  COALESCE(job_counts.count, 0) + 1,
  NOW()
FROM "Business"
LEFT JOIN (
  SELECT "businessId", COUNT(*)::int AS count
  FROM "Job"
  GROUP BY "businessId"
) AS job_counts ON job_counts."businessId" = "Business".id;

CREATE UNIQUE INDEX "Job_businessId_jobNumber_key" ON "Job"("businessId", "jobNumber");
CREATE INDEX "Job_businessId_priority_scheduledStart_idx" ON "Job"("businessId", "priority", "scheduledStart");
CREATE INDEX "Job_businessId_assignedToUserId_scheduledStart_idx" ON "Job"("businessId", "assignedToUserId", "scheduledStart");
CREATE INDEX "Job_businessId_isArchived_idx" ON "Job"("businessId", "isArchived");

ALTER TABLE "Job" ADD CONSTRAINT "Job_assignedToUserId_businessId_fkey" FOREIGN KEY ("assignedToUserId", "businessId") REFERENCES "User"("id", "businessId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobSequence" ADD CONSTRAINT "JobSequence_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
