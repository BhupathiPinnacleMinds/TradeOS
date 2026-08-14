-- Additive payment receipt foundation for Accounts Receivable Phase 2.
-- Existing invoices, payments and generated invoice PDFs are preserved.

CREATE TABLE "InvoiceReceiptDocument" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "receiptNumber" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL,
  "checksum" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,

  CONSTRAINT "InvoiceReceiptDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReceiptSequence" (
  "businessId" TEXT NOT NULL,
  "nextNumber" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ReceiptSequence_pkey" PRIMARY KEY ("businessId")
);

CREATE UNIQUE INDEX "InvoiceReceiptDocument_businessId_receiptNumber_key"
  ON "InvoiceReceiptDocument"("businessId", "receiptNumber");

CREATE UNIQUE INDEX "InvoiceReceiptDocument_businessId_paymentId_key"
  ON "InvoiceReceiptDocument"("businessId", "paymentId");

CREATE UNIQUE INDEX "InvoiceReceiptDocument_businessId_objectKey_key"
  ON "InvoiceReceiptDocument"("businessId", "objectKey");

CREATE INDEX "InvoiceReceiptDocument_businessId_invoiceId_idx"
  ON "InvoiceReceiptDocument"("businessId", "invoiceId");

CREATE INDEX "InvoiceReceiptDocument_businessId_paymentId_idx"
  ON "InvoiceReceiptDocument"("businessId", "paymentId");

CREATE UNIQUE INDEX "Payment_id_businessId_key"
  ON "Payment"("id", "businessId");

ALTER TABLE "InvoiceReceiptDocument"
  ADD CONSTRAINT "InvoiceReceiptDocument_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceReceiptDocument"
  ADD CONSTRAINT "InvoiceReceiptDocument_invoiceId_businessId_fkey"
  FOREIGN KEY ("invoiceId", "businessId") REFERENCES "Invoice"("id", "businessId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceReceiptDocument"
  ADD CONSTRAINT "InvoiceReceiptDocument_paymentId_businessId_fkey"
  FOREIGN KEY ("paymentId", "businessId") REFERENCES "Payment"("id", "businessId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceReceiptDocument"
  ADD CONSTRAINT "InvoiceReceiptDocument_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReceiptSequence"
  ADD CONSTRAINT "ReceiptSequence_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
