CREATE TYPE "InvoicePaymentDeclarationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

ALTER TABLE "Business"
ADD COLUMN "paymentAccountName" TEXT,
ADD COLUMN "paymentBankName" TEXT,
ADD COLUMN "paymentBsb" TEXT,
ADD COLUMN "paymentAccountNumber" TEXT,
ADD COLUMN "paymentReferenceInstructions" TEXT,
ADD COLUMN "paymentInstructions" TEXT;

CREATE TABLE "InvoicePaymentDeclaration" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "reference" TEXT,
  "note" TEXT,
  "status" "InvoicePaymentDeclarationStatus" NOT NULL DEFAULT 'PENDING',
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "paymentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InvoicePaymentDeclaration_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InvoicePaymentDeclaration_businessId_invoiceId_status_idx" ON "InvoicePaymentDeclaration"("businessId", "invoiceId", "status");
CREATE INDEX "InvoicePaymentDeclaration_businessId_customerId_idx" ON "InvoicePaymentDeclaration"("businessId", "customerId");
CREATE INDEX "InvoicePaymentDeclaration_businessId_status_submittedAt_idx" ON "InvoicePaymentDeclaration"("businessId", "status", "submittedAt");
CREATE INDEX "InvoicePaymentDeclaration_businessId_paymentId_idx" ON "InvoicePaymentDeclaration"("businessId", "paymentId");

ALTER TABLE "InvoicePaymentDeclaration"
ADD CONSTRAINT "InvoicePaymentDeclaration_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoicePaymentDeclaration"
ADD CONSTRAINT "InvoicePaymentDeclaration_invoiceId_businessId_fkey"
FOREIGN KEY ("invoiceId", "businessId") REFERENCES "Invoice"("id", "businessId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoicePaymentDeclaration"
ADD CONSTRAINT "InvoicePaymentDeclaration_customerId_businessId_fkey"
FOREIGN KEY ("customerId", "businessId") REFERENCES "Customer"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvoicePaymentDeclaration"
ADD CONSTRAINT "InvoicePaymentDeclaration_paymentId_businessId_fkey"
FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
