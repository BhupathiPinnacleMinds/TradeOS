ALTER TABLE "Notification"
ADD COLUMN "type" TEXT NOT NULL DEFAULT 'GENERAL',
ADD COLUMN "entityType" TEXT,
ADD COLUMN "entityId" TEXT,
ADD COLUMN "metadata" JSONB;

CREATE INDEX "Notification_businessId_userId_createdAt_idx" ON "Notification"("businessId", "userId", "createdAt");
CREATE INDEX "Notification_businessId_type_idx" ON "Notification"("businessId", "type");
CREATE INDEX "Notification_businessId_entityType_entityId_idx" ON "Notification"("businessId", "entityType", "entityId");
