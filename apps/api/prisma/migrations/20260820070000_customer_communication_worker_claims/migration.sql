ALTER TYPE "CustomerCommunicationStatus" ADD VALUE 'PROCESSING';

ALTER TABLE "CustomerCommunication"
  ADD COLUMN "processingStartedAt" TIMESTAMP(3),
  ADD COLUMN "processingExpiresAt" TIMESTAMP(3);

CREATE INDEX "CustomerCommunication_businessId_status_processingExpiresAt_idx"
  ON "CustomerCommunication"("businessId", "status", "processingExpiresAt");
