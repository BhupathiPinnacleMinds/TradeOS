-- Quote module foundation: lifecycle, cents-based totals, revisions and sequencing.

ALTER TYPE "QuoteStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "QuoteStatus" ADD VALUE IF NOT EXISTS 'CONVERTED';

DO $$ BEGIN
  CREATE TYPE "QuotePricingMode" AS ENUM ('GST_EXCLUSIVE', 'GST_INCLUSIVE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "QuoteDiscountType" AS ENUM ('NONE', 'FIXED', 'PERCENTAGE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "QuoteDepositType" AS ENUM ('NONE', 'FIXED', 'PERCENTAGE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "QuoteLineItemType" AS ENUM ('LABOUR', 'MATERIAL', 'SERVICE', 'FEE', 'DISCOUNT', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Quote" RENAME COLUMN "number" TO "quoteNumber";
ALTER TABLE "Quote" RENAME COLUMN "subtotal" TO "subtotalDecimal";
ALTER TABLE "Quote" RENAME COLUMN "gst" TO "gstDecimal";
ALTER TABLE "Quote" RENAME COLUMN "total" TO "totalDecimal";
ALTER TABLE "Quote" RENAME COLUMN "notes" TO "customerNotes";

ALTER TABLE "Quote"
  ADD COLUMN "customerSiteId" TEXT,
  ADD COLUMN "sourceAppointmentId" TEXT,
  ADD COLUMN "title" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'AUD',
  ADD COLUMN "pricingMode" "QuotePricingMode" NOT NULL DEFAULT 'GST_EXCLUSIVE',
  ADD COLUMN "gstRateBasisPoints" INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN "subtotalCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "discountType" "QuoteDiscountType" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "discountValue" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "discountCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "gstCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "depositType" "QuoteDepositType" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "depositValue" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "depositCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "internalNotes" TEXT,
  ADD COLUMN "termsAndConditions" TEXT,
  ADD COLUMN "viewedAt" TIMESTAMP(3),
  ADD COLUMN "acceptedAt" TIMESTAMP(3),
  ADD COLUMN "declinedAt" TIMESTAMP(3),
  ADD COLUMN "expiredAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "convertedAt" TIMESTAMP(3),
  ADD COLUMN "acceptedByName" TEXT,
  ADD COLUMN "acceptedByEmail" TEXT,
  ADD COLUMN "acceptanceIp" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "createdBy" TEXT,
  ADD COLUMN "updatedBy" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

UPDATE "Quote"
SET
  "title" = COALESCE("quoteNumber", 'Quote'),
  "subtotalCents" = ROUND("subtotalDecimal" * 100)::INTEGER,
  "gstCents" = ROUND("gstDecimal" * 100)::INTEGER,
  "totalCents" = ROUND("totalDecimal" * 100)::INTEGER;

ALTER TABLE "Quote" ALTER COLUMN "title" SET NOT NULL;

ALTER TABLE "Quote" DROP COLUMN "subtotalDecimal";
ALTER TABLE "Quote" DROP COLUMN "gstDecimal";
ALTER TABLE "Quote" DROP COLUMN "totalDecimal";

ALTER INDEX IF EXISTS "Quote_businessId_number_key" RENAME TO "Quote_businessId_quoteNumber_key";

DROP INDEX IF EXISTS "Quote_businessId_customerId_idx";
DROP INDEX IF EXISTS "Quote_businessId_status_issueDate_idx";

CREATE INDEX "Quote_businessId_status_issueDate_idx" ON "Quote"("businessId", "status", "issueDate");
CREATE INDEX "Quote_businessId_expiryDate_idx" ON "Quote"("businessId", "expiryDate");
CREATE INDEX "Quote_businessId_customerId_idx" ON "Quote"("businessId", "customerId");
CREATE INDEX "Quote_businessId_jobId_idx" ON "Quote"("businessId", "jobId");
CREATE INDEX "Quote_businessId_createdBy_idx" ON "Quote"("businessId", "createdBy");

ALTER TABLE "Quote"
  ADD CONSTRAINT "Quote_customerSiteId_businessId_fkey"
    FOREIGN KEY ("customerSiteId", "businessId") REFERENCES "CustomerSite"("id", "businessId") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Quote_sourceAppointmentId_businessId_fkey"
    FOREIGN KEY ("sourceAppointmentId", "businessId") REFERENCES "Appointment"("id", "businessId") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Quote_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Quote_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QuoteLineItem" RENAME COLUMN "sortOrder" TO "position";
ALTER TABLE "QuoteLineItem" RENAME COLUMN "description" TO "name";
ALTER TABLE "QuoteLineItem" RENAME COLUMN "unitPrice" TO "unitPriceDecimal";
ALTER TABLE "QuoteLineItem" RENAME COLUMN "total" TO "totalDecimal";

ALTER TABLE "QuoteLineItem"
  ADD COLUMN "type" "QuoteLineItemType" NOT NULL DEFAULT 'SERVICE',
  ADD COLUMN "description" TEXT,
  ADD COLUMN "unit" TEXT NOT NULL DEFAULT 'item',
  ADD COLUMN "unitPriceCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "taxable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "lineSubtotalCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lineGstCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lineTotalCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "QuoteLineItem"
  ALTER COLUMN "quantity" TYPE DECIMAL(10,3);

UPDATE "QuoteLineItem"
SET
  "unitPriceCents" = ROUND("unitPriceDecimal" * 100)::INTEGER,
  "lineSubtotalCents" = ROUND("totalDecimal" * 100)::INTEGER,
  "lineTotalCents" = ROUND("totalDecimal" * 100)::INTEGER;

ALTER TABLE "QuoteLineItem" DROP COLUMN "unitPriceDecimal";
ALTER TABLE "QuoteLineItem" DROP COLUMN "totalDecimal";

DROP INDEX IF EXISTS "QuoteLineItem_businessId_quoteId_idx";
CREATE INDEX "QuoteLineItem_businessId_quoteId_idx" ON "QuoteLineItem"("businessId", "quoteId");
CREATE INDEX "QuoteLineItem_businessId_quoteId_position_idx" ON "QuoteLineItem"("businessId", "quoteId", "position");

CREATE TABLE "QuoteRevision" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "QuoteStatus" NOT NULL,
  "snapshot" JSONB NOT NULL,
  "reason" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuoteRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuoteRevision_businessId_quoteId_version_key" ON "QuoteRevision"("businessId", "quoteId", "version");
CREATE INDEX "QuoteRevision_businessId_quoteId_createdAt_idx" ON "QuoteRevision"("businessId", "quoteId", "createdAt");

ALTER TABLE "QuoteRevision"
  ADD CONSTRAINT "QuoteRevision_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "QuoteRevision_quoteId_businessId_fkey"
    FOREIGN KEY ("quoteId", "businessId") REFERENCES "Quote"("id", "businessId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "QuoteSequence" (
  "businessId" TEXT NOT NULL,
  "nextNumber" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuoteSequence_pkey" PRIMARY KEY ("businessId")
);

INSERT INTO "QuoteSequence" ("businessId", "nextNumber", "updatedAt")
SELECT
  "businessId",
  COALESCE(MAX(NULLIF(REGEXP_REPLACE("quoteNumber", '\D', '', 'g'), '')::INTEGER), 0) + 1,
  CURRENT_TIMESTAMP
FROM "Quote"
GROUP BY "businessId"
ON CONFLICT ("businessId") DO NOTHING;

ALTER TABLE "QuoteSequence"
  ADD CONSTRAINT "QuoteSequence_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
