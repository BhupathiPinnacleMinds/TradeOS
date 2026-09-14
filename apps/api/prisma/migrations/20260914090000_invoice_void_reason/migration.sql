-- Add explicit invoice void metadata without changing historical invoice records.
ALTER TABLE "Invoice"
  ADD COLUMN "voidReason" TEXT,
  ADD COLUMN "voidedBy" TEXT;

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_voidedBy_fkey"
  FOREIGN KEY ("voidedBy")
  REFERENCES "User"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "Invoice_businessId_voidedAt_idx" ON "Invoice"("businessId", "voidedAt");

