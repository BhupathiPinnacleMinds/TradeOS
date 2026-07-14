CREATE TYPE "ContactPreference" AS ENUM ('PHONE', 'SMS', 'EMAIL', 'ANY');
CREATE TYPE "CustomerType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'REAL_ESTATE', 'STRATA', 'BUILDER', 'OTHER');

ALTER TABLE "Customer"
  RENAME COLUMN company TO "companyName";

ALTER TABLE "Customer"
  RENAME COLUMN address TO "addressLine1";

ALTER TABLE "Customer"
  ALTER COLUMN "firstName" DROP NOT NULL,
  ADD COLUMN "displayName" TEXT,
  ADD COLUMN "emailNormalised" TEXT,
  ADD COLUMN "phoneNormalised" TEXT,
  ADD COLUMN "alternatePhone" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN suburb TEXT,
  ADD COLUMN state TEXT,
  ADD COLUMN postcode TEXT,
  ADD COLUMN "contactPreference" "ContactPreference" NOT NULL DEFAULT 'ANY',
  ADD COLUMN "customerType" "CustomerType" NOT NULL DEFAULT 'RESIDENTIAL',
  ADD COLUMN tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "createdBy" TEXT,
  ADD COLUMN "updatedBy" TEXT;

UPDATE "Customer"
SET
  "displayName" = COALESCE(NULLIF(TRIM(CONCAT_WS(' ', "firstName", "lastName")), ''), NULLIF("companyName", ''), 'Customer'),
  "emailNormalised" = LOWER(NULLIF(TRIM(email), '')),
  "phoneNormalised" = REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9+]', '', 'g'),
  "isArchived" = status = 'ARCHIVED',
  "archivedAt" = CASE WHEN status = 'ARCHIVED' THEN "updatedAt" ELSE NULL END;

UPDATE "Customer"
SET "phoneNormalised" = NULL
WHERE "phoneNormalised" = '';

ALTER TABLE "Customer"
  ALTER COLUMN "displayName" SET NOT NULL;

ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Customer_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CustomerSite" (
  id TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  label TEXT NOT NULL,
  "addressLine1" TEXT NOT NULL,
  "addressLine2" TEXT,
  suburb TEXT NOT NULL,
  state TEXT NOT NULL,
  postcode TEXT NOT NULL,
  "accessInstructions" TEXT,
  "siteContactName" TEXT,
  "siteContactPhone" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomerSite_pkey" PRIMARY KEY (id)
);

ALTER TABLE "CustomerSite"
  ADD CONSTRAINT "CustomerSite_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomerSite_customerId_businessId_fkey" FOREIGN KEY ("customerId", "businessId") REFERENCES "Customer"("id", "businessId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "CustomerSite_id_businessId_key" ON "CustomerSite"("id", "businessId");
CREATE INDEX "CustomerSite_businessId_customerId_isArchived_idx" ON "CustomerSite"("businessId", "customerId", "isArchived");
CREATE INDEX "CustomerSite_businessId_state_suburb_idx" ON "CustomerSite"("businessId", state, suburb);

DROP INDEX IF EXISTS "Customer_businessId_status_idx";
CREATE INDEX "Customer_businessId_isArchived_idx" ON "Customer"("businessId", "isArchived");
CREATE INDEX "Customer_businessId_customerType_idx" ON "Customer"("businessId", "customerType");
CREATE INDEX "Customer_businessId_state_suburb_idx" ON "Customer"("businessId", state, suburb);
CREATE INDEX "Customer_businessId_emailNormalised_idx" ON "Customer"("businessId", "emailNormalised");
CREATE INDEX "Customer_businessId_phoneNormalised_idx" ON "Customer"("businessId", "phoneNormalised");
