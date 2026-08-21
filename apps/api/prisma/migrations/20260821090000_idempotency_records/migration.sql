CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'SUCCESS', 'FAILED');

CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "userId" TEXT,
    "publicScopeHash" TEXT,
    "keyHash" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdempotencyRecord_businessId_userId_operation_keyHash_key"
    ON "IdempotencyRecord"("businessId", "userId", "operation", "keyHash");

CREATE UNIQUE INDEX "IdempotencyRecord_publicScopeHash_operation_keyHash_key"
    ON "IdempotencyRecord"("publicScopeHash", "operation", "keyHash");

CREATE INDEX "IdempotencyRecord_status_expiresAt_idx"
    ON "IdempotencyRecord"("status", "expiresAt");

CREATE INDEX "IdempotencyRecord_businessId_operation_createdAt_idx"
    ON "IdempotencyRecord"("businessId", "operation", "createdAt");

ALTER TABLE "IdempotencyRecord"
    ADD CONSTRAINT "IdempotencyRecord_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
