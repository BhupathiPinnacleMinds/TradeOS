-- DropForeignKey
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_assignedUserId_businessId_fkey";

-- DropForeignKey
ALTER TABLE "CustomerCommunication" DROP CONSTRAINT "CustomerCommunication_relatedAppointmentId_businessId_fkey";

-- DropForeignKey
ALTER TABLE "CustomerCommunication" DROP CONSTRAINT "CustomerCommunication_relatedInvoiceId_businessId_fkey";

-- DropForeignKey
ALTER TABLE "CustomerCommunication" DROP CONSTRAINT "CustomerCommunication_relatedJobId_businessId_fkey";

-- DropForeignKey
ALTER TABLE "CustomerCommunication" DROP CONSTRAINT "CustomerCommunication_relatedPaymentId_businessId_fkey";

-- DropForeignKey
ALTER TABLE "CustomerCommunication" DROP CONSTRAINT "CustomerCommunication_relatedQuoteId_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_jobId_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_customerSiteId_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_jobId_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_sourceQuoteId_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Job" DROP CONSTRAINT "Job_assignedToUserId_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Job" DROP CONSTRAINT "Job_sourceQuoteId_businessId_fkey";

-- DropForeignKey
ALTER TABLE "MediaAsset" DROP CONSTRAINT "MediaAsset_appointmentId_businessId_fkey";

-- DropForeignKey
ALTER TABLE "MediaAsset" DROP CONSTRAINT "MediaAsset_customerId_businessId_fkey";

-- DropForeignKey
ALTER TABLE "MediaAsset" DROP CONSTRAINT "MediaAsset_jobId_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_customerId_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_jobId_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Quote" DROP CONSTRAINT "Quote_convertedJobId_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Quote" DROP CONSTRAINT "Quote_customerSiteId_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Quote" DROP CONSTRAINT "Quote_jobId_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Quote" DROP CONSTRAINT "Quote_relatedJobId_businessId_fkey";

-- DropForeignKey
ALTER TABLE "Quote" DROP CONSTRAINT "Quote_sourceAppointmentId_businessId_fkey";

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_assignedToUserId_businessId_fkey" FOREIGN KEY ("assignedToUserId", "businessId") REFERENCES "User"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_sourceQuoteId_businessId_fkey" FOREIGN KEY ("sourceQuoteId", "businessId") REFERENCES "Quote"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_assignedUserId_businessId_fkey" FOREIGN KEY ("assignedUserId", "businessId") REFERENCES "User"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerSiteId_businessId_fkey" FOREIGN KEY ("customerSiteId", "businessId") REFERENCES "CustomerSite"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_jobId_businessId_fkey" FOREIGN KEY ("jobId", "businessId") REFERENCES "Job"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_relatedJobId_businessId_fkey" FOREIGN KEY ("relatedJobId", "businessId") REFERENCES "Job"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_convertedJobId_businessId_fkey" FOREIGN KEY ("convertedJobId", "businessId") REFERENCES "Job"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_sourceAppointmentId_businessId_fkey" FOREIGN KEY ("sourceAppointmentId", "businessId") REFERENCES "Appointment"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerSiteId_businessId_fkey" FOREIGN KEY ("customerSiteId", "businessId") REFERENCES "CustomerSite"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_jobId_businessId_fkey" FOREIGN KEY ("jobId", "businessId") REFERENCES "Job"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_sourceQuoteId_businessId_fkey" FOREIGN KEY ("sourceQuoteId", "businessId") REFERENCES "Quote"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCommunication" ADD CONSTRAINT "CustomerCommunication_relatedJobId_businessId_fkey" FOREIGN KEY ("relatedJobId", "businessId") REFERENCES "Job"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCommunication" ADD CONSTRAINT "CustomerCommunication_relatedAppointmentId_businessId_fkey" FOREIGN KEY ("relatedAppointmentId", "businessId") REFERENCES "Appointment"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCommunication" ADD CONSTRAINT "CustomerCommunication_relatedQuoteId_businessId_fkey" FOREIGN KEY ("relatedQuoteId", "businessId") REFERENCES "Quote"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCommunication" ADD CONSTRAINT "CustomerCommunication_relatedInvoiceId_businessId_fkey" FOREIGN KEY ("relatedInvoiceId", "businessId") REFERENCES "Invoice"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCommunication" ADD CONSTRAINT "CustomerCommunication_relatedPaymentId_businessId_fkey" FOREIGN KEY ("relatedPaymentId", "businessId") REFERENCES "Payment"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_customerId_businessId_fkey" FOREIGN KEY ("customerId", "businessId") REFERENCES "Customer"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_jobId_businessId_fkey" FOREIGN KEY ("jobId", "businessId") REFERENCES "Job"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_jobId_businessId_fkey" FOREIGN KEY ("jobId", "businessId") REFERENCES "Job"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_customerId_businessId_fkey" FOREIGN KEY ("customerId", "businessId") REFERENCES "Customer"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_jobId_businessId_fkey" FOREIGN KEY ("jobId", "businessId") REFERENCES "Job"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_appointmentId_businessId_fkey" FOREIGN KEY ("appointmentId", "businessId") REFERENCES "Appointment"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;
