-- CreateEnum
CREATE TYPE "CustomerCommunicationChannel" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "CustomerCommunicationStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CustomerCommunicationType" AS ENUM ('APPOINTMENT_CONFIRMATION', 'APPOINTMENT_REMINDER', 'APPOINTMENT_RESCHEDULED', 'APPOINTMENT_CANCELLED', 'QUOTE_SENT', 'QUOTE_FOLLOW_UP', 'QUOTE_ACCEPTED', 'QUOTE_DECLINED', 'INVOICE_SENT', 'INVOICE_DUE_SOON', 'INVOICE_OVERDUE', 'PAYMENT_RECEIVED', 'JOB_COMPLETED');

-- AlterTable
ALTER TABLE "InvoiceLineItem" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InvoiceSequence" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "QuoteLineItem" ALTER COLUMN "position" DROP DEFAULT,
ALTER COLUMN "unitPriceCents" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "QuoteSequence" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "BusinessCommunicationSettings" (
    "businessId" TEXT NOT NULL,
    "appointmentConfirmationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "appointmentRemindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "appointmentReminderLeadMinutes" INTEGER NOT NULL DEFAULT 1440,
    "quoteFollowUpsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "quoteFollowUpDelayMinutes" INTEGER NOT NULL DEFAULT 4320,
    "invoiceDueSoonRemindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "invoiceDueSoonLeadMinutes" INTEGER NOT NULL DEFAULT 4320,
    "invoiceOverdueRemindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "invoiceOverdueDelayMinutes" INTEGER NOT NULL DEFAULT 1440,
    "paymentConfirmationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessCommunicationSettings_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE "CustomerCommunicationPreference" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerCommunicationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCommunication" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" "CustomerCommunicationChannel" NOT NULL,
    "type" "CustomerCommunicationType" NOT NULL,
    "status" "CustomerCommunicationStatus" NOT NULL DEFAULT 'DRAFT',
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "preview" TEXT,
    "relatedJobId" TEXT,
    "relatedAppointmentId" TEXT,
    "relatedQuoteId" TEXT,
    "relatedInvoiceId" TEXT,
    "relatedPaymentId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerCommunication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerCommunicationPreference_businessId_emailEnabled_sms_idx" ON "CustomerCommunicationPreference"("businessId", "emailEnabled", "smsEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCommunicationPreference_businessId_customerId_key" ON "CustomerCommunicationPreference"("businessId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCommunicationPreference_customerId_businessId_key" ON "CustomerCommunicationPreference"("customerId", "businessId");

-- CreateIndex
CREATE INDEX "CustomerCommunication_businessId_customerId_createdAt_idx" ON "CustomerCommunication"("businessId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerCommunication_businessId_status_scheduledFor_idx" ON "CustomerCommunication"("businessId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "CustomerCommunication_businessId_relatedAppointmentId_idx" ON "CustomerCommunication"("businessId", "relatedAppointmentId");

-- CreateIndex
CREATE INDEX "CustomerCommunication_businessId_relatedQuoteId_idx" ON "CustomerCommunication"("businessId", "relatedQuoteId");

-- CreateIndex
CREATE INDEX "CustomerCommunication_businessId_relatedInvoiceId_idx" ON "CustomerCommunication"("businessId", "relatedInvoiceId");

-- CreateIndex
CREATE INDEX "CustomerCommunication_businessId_relatedPaymentId_idx" ON "CustomerCommunication"("businessId", "relatedPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCommunication_businessId_idempotencyKey_key" ON "CustomerCommunication"("businessId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "BusinessCommunicationSettings" ADD CONSTRAINT "BusinessCommunicationSettings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCommunicationPreference" ADD CONSTRAINT "CustomerCommunicationPreference_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCommunicationPreference" ADD CONSTRAINT "CustomerCommunicationPreference_customerId_businessId_fkey" FOREIGN KEY ("customerId", "businessId") REFERENCES "Customer"("id", "businessId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCommunication" ADD CONSTRAINT "CustomerCommunication_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCommunication" ADD CONSTRAINT "CustomerCommunication_customerId_businessId_fkey" FOREIGN KEY ("customerId", "businessId") REFERENCES "Customer"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCommunication" ADD CONSTRAINT "CustomerCommunication_relatedJobId_businessId_fkey" FOREIGN KEY ("relatedJobId", "businessId") REFERENCES "Job"("id", "businessId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCommunication" ADD CONSTRAINT "CustomerCommunication_relatedAppointmentId_businessId_fkey" FOREIGN KEY ("relatedAppointmentId", "businessId") REFERENCES "Appointment"("id", "businessId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCommunication" ADD CONSTRAINT "CustomerCommunication_relatedQuoteId_businessId_fkey" FOREIGN KEY ("relatedQuoteId", "businessId") REFERENCES "Quote"("id", "businessId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCommunication" ADD CONSTRAINT "CustomerCommunication_relatedInvoiceId_businessId_fkey" FOREIGN KEY ("relatedInvoiceId", "businessId") REFERENCES "Invoice"("id", "businessId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCommunication" ADD CONSTRAINT "CustomerCommunication_relatedPaymentId_businessId_fkey" FOREIGN KEY ("relatedPaymentId", "businessId") REFERENCES "Payment"("id", "businessId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCommunication" ADD CONSTRAINT "CustomerCommunication_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
