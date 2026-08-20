-- Store safe outbound provider metadata for real customer EMAIL/SMS delivery.
ALTER TABLE "CustomerCommunication"
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "providerMessageId" TEXT;

CREATE INDEX "CustomerCommunication_businessId_provider_providerMessageId_idx"
  ON "CustomerCommunication"("businessId", "provider", "providerMessageId");
