-- Appointment visit-location snapshots.
-- Existing appointments are backfilled from their tenant-scoped job address.

CREATE TYPE "AppointmentLocationSource" AS ENUM (
  'CUSTOMER_SITE',
  'CUSTOMER_DEFAULT',
  'MANUAL'
);

ALTER TABLE "Appointment"
  ADD COLUMN "customerSiteId" TEXT,
  ADD COLUMN "locationSource" "AppointmentLocationSource" NOT NULL DEFAULT 'CUSTOMER_DEFAULT',
  ADD COLUMN "addressLine1" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN "suburb" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "postcode" TEXT,
  ADD COLUMN "accessInstructions" TEXT;

UPDATE "Appointment" AS appointment
SET
  "addressLine1" = job."addressLine1",
  "addressLine2" = job."addressLine2",
  "suburb" = job."suburb",
  "state" = job."state",
  "postcode" = job."postcode",
  "accessInstructions" = job."accessInstructions"
FROM "Job" AS job
WHERE appointment."jobId" = job."id"
  AND appointment."businessId" = job."businessId";

ALTER TABLE "Appointment"
  ALTER COLUMN "addressLine1" SET NOT NULL,
  ALTER COLUMN "suburb" SET NOT NULL,
  ALTER COLUMN "state" SET NOT NULL,
  ALTER COLUMN "postcode" SET NOT NULL;

CREATE INDEX "Appointment_businessId_customerSiteId_idx"
  ON "Appointment"("businessId", "customerSiteId");

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_customerSiteId_businessId_fkey"
  FOREIGN KEY ("customerSiteId", "businessId")
  REFERENCES "CustomerSite"("id", "businessId")
  ON DELETE NO ACTION
  ON UPDATE CASCADE;
