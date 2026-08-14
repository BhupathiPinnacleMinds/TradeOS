-- Invoice module foundation.
-- This migration preserves the original invoice/payment seed rows by
-- backfilling decimal money columns into integer cents before old columns are
-- removed.

ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'EFTPOS';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CHEQUE';

DROP INDEX IF EXISTS "Invoice_businessId_number_key";
DROP INDEX IF EXISTS "Payment_businessId_status_paidAt_idx";

ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "invoiceNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "customerSiteId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceQuoteId" TEXT,
  ADD COLUMN IF NOT EXISTS "title" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'AUD',
  ADD COLUMN IF NOT EXISTS "pricingMode" "QuotePricingMode" NOT NULL DEFAULT 'GST_EXCLUSIVE',
  ADD COLUMN IF NOT EXISTS "gstRateBasisPoints" INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS "subtotalCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discountType" "QuoteDiscountType" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "discountValue" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discountCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "gstCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "totalCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "creditAppliedCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "amountPaidCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "balanceDueCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "customerNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "internalNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentTerms" TEXT,
  ADD COLUMN IF NOT EXISTS "viewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "createdBy" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;

UPDATE "Invoice"
SET
  "invoiceNumber" = COALESCE("invoiceNumber", "number"),
  "title" = COALESCE("title", 'Invoice ' || "number"),
  "subtotalCents" = COALESCE("subtotalCents", ROUND("subtotal" * 100)::INTEGER, 0),
  "gstCents" = COALESCE("gstCents", ROUND("gst" * 100)::INTEGER, 0),
  "totalCents" = COALESCE("totalCents", ROUND("total" * 100)::INTEGER, 0),
  "amountPaidCents" = COALESCE("amountPaidCents", ROUND("amountPaid" * 100)::INTEGER, 0),
  "balanceDueCents" = GREATEST(
    0,
    COALESCE(ROUND("total" * 100)::INTEGER, "totalCents", 0)
      - COALESCE(ROUND("amountPaid" * 100)::INTEGER, "amountPaidCents", 0)
      - COALESCE("creditAppliedCents", 0)
  ),
  "customerNotes" = COALESCE("customerNotes", "notes"),
  "paidAt" = CASE
    WHEN "paidAt" IS NULL
      AND COALESCE(ROUND("amountPaid" * 100)::INTEGER, "amountPaidCents", 0)
        >= COALESCE(ROUND("total" * 100)::INTEGER, "totalCents", 0)
      AND COALESCE(ROUND("total" * 100)::INTEGER, "totalCents", 0) > 0
    THEN "updatedAt"
    ELSE "paidAt"
  END
WHERE "invoiceNumber" IS NULL OR "title" IS NULL;

ALTER TABLE "Invoice"
  ALTER COLUMN "invoiceNumber" SET NOT NULL,
  ALTER COLUMN "title" SET NOT NULL;

ALTER TABLE "InvoiceLineItem"
  ADD COLUMN IF NOT EXISTS "position" INTEGER,
  ADD COLUMN IF NOT EXISTS "type" "QuoteLineItemType" NOT NULL DEFAULT 'SERVICE',
  ADD COLUMN IF NOT EXISTS "name" TEXT,
  ADD COLUMN IF NOT EXISTS "unit" TEXT NOT NULL DEFAULT 'item',
  ADD COLUMN IF NOT EXISTS "unitPriceCents" INTEGER,
  ADD COLUMN IF NOT EXISTS "taxable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "lineSubtotalCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lineGstCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lineTotalCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "InvoiceLineItem"
SET
  "position" = COALESCE("position", "sortOrder", 0),
  "name" = COALESCE("name", NULLIF("description", ''), 'Line item'),
  "unitPriceCents" = COALESCE("unitPriceCents", ROUND("unitPrice" * 100)::INTEGER, 0),
  "lineSubtotalCents" = COALESCE("lineSubtotalCents", ROUND("total" * 100)::INTEGER, 0),
  "lineTotalCents" = COALESCE("lineTotalCents", ROUND("total" * 100)::INTEGER, 0);

ALTER TABLE "InvoiceLineItem"
  ALTER COLUMN "position" SET NOT NULL,
  ALTER COLUMN "name" SET NOT NULL,
  ALTER COLUMN "unitPriceCents" SET NOT NULL,
  ALTER COLUMN "description" DROP NOT NULL,
  ALTER COLUMN "quantity" TYPE DECIMAL(10,3);

ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "amountCents" INTEGER,
  ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "notes" TEXT,
  ADD COLUMN IF NOT EXISTS "createdBy" TEXT,
  ADD COLUMN IF NOT EXISTS "reversedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reversalReason" TEXT;

UPDATE "Payment"
SET
  "amountCents" = COALESCE("amountCents", ROUND("amount" * 100)::INTEGER, 0),
  "receivedAt" = COALESCE("receivedAt", "paidAt", "createdAt");

ALTER TABLE "Payment"
  ALTER COLUMN "amountCents" SET NOT NULL,
  ALTER COLUMN "receivedAt" SET NOT NULL;

ALTER TABLE "Invoice"
  DROP COLUMN IF EXISTS "amountPaid",
  DROP COLUMN IF EXISTS "gst",
  DROP COLUMN IF EXISTS "notes",
  DROP COLUMN IF EXISTS "number",
  DROP COLUMN IF EXISTS "subtotal",
  DROP COLUMN IF EXISTS "total";

ALTER TABLE "InvoiceLineItem"
  DROP COLUMN IF EXISTS "sortOrder",
  DROP COLUMN IF EXISTS "total",
  DROP COLUMN IF EXISTS "unitPrice";

ALTER TABLE "Payment"
  DROP COLUMN IF EXISTS "amount",
  DROP COLUMN IF EXISTS "paidAt",
  DROP COLUMN IF EXISTS "status",
  DROP COLUMN IF EXISTS "updatedAt";

CREATE TABLE IF NOT EXISTS "InvoicePdfDocument" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL,
  "checksum" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  CONSTRAINT "InvoicePdfDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InvoicePublicAccessToken" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastViewedAt" TIMESTAMP(3),
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "InvoicePublicAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InvoiceSequence" (
  "businessId" TEXT NOT NULL,
  "nextNumber" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("businessId")
);

INSERT INTO "InvoiceSequence" ("businessId", "nextNumber", "updatedAt")
SELECT "businessId", COUNT(*)::INTEGER + 1, CURRENT_TIMESTAMP
FROM "Invoice"
GROUP BY "businessId"
ON CONFLICT ("businessId") DO NOTHING;

CREATE INDEX IF NOT EXISTS "Invoice_businessId_jobId_idx" ON "Invoice"("businessId", "jobId");
CREATE INDEX IF NOT EXISTS "Invoice_businessId_sourceQuoteId_idx" ON "Invoice"("businessId", "sourceQuoteId");
CREATE INDEX IF NOT EXISTS "Invoice_businessId_createdBy_idx" ON "Invoice"("businessId", "createdBy");
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_businessId_invoiceNumber_key" ON "Invoice"("businessId", "invoiceNumber");
CREATE INDEX IF NOT EXISTS "InvoiceLineItem_businessId_invoiceId_position_idx" ON "InvoiceLineItem"("businessId", "invoiceId", "position");
CREATE INDEX IF NOT EXISTS "Payment_businessId_receivedAt_idx" ON "Payment"("businessId", "receivedAt");
CREATE INDEX IF NOT EXISTS "InvoicePdfDocument_businessId_invoiceId_idx" ON "InvoicePdfDocument"("businessId", "invoiceId");
CREATE UNIQUE INDEX IF NOT EXISTS "InvoicePdfDocument_businessId_invoiceId_version_key" ON "InvoicePdfDocument"("businessId", "invoiceId", "version");
CREATE UNIQUE INDEX IF NOT EXISTS "InvoicePdfDocument_businessId_objectKey_key" ON "InvoicePdfDocument"("businessId", "objectKey");
CREATE INDEX IF NOT EXISTS "InvoicePublicAccessToken_businessId_invoiceId_version_idx" ON "InvoicePublicAccessToken"("businessId", "invoiceId", "version");
CREATE INDEX IF NOT EXISTS "InvoicePublicAccessToken_expiresAt_idx" ON "InvoicePublicAccessToken"("expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "InvoicePublicAccessToken_tokenHash_key" ON "InvoicePublicAccessToken"("tokenHash");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerSiteId_businessId_fkey"
  FOREIGN KEY ("customerSiteId", "businessId") REFERENCES "CustomerSite"("id", "businessId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_sourceQuoteId_businessId_fkey"
  FOREIGN KEY ("sourceQuoteId", "businessId") REFERENCES "Quote"("id", "businessId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_updatedBy_fkey"
  FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvoicePdfDocument" ADD CONSTRAINT "InvoicePdfDocument_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoicePdfDocument" ADD CONSTRAINT "InvoicePdfDocument_invoiceId_businessId_fkey"
  FOREIGN KEY ("invoiceId", "businessId") REFERENCES "Invoice"("id", "businessId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoicePublicAccessToken" ADD CONSTRAINT "InvoicePublicAccessToken_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoicePublicAccessToken" ADD CONSTRAINT "InvoicePublicAccessToken_invoiceId_businessId_fkey"
  FOREIGN KEY ("invoiceId", "businessId") REFERENCES "Invoice"("id", "businessId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceSequence" ADD CONSTRAINT "InvoiceSequence_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
