-- Quotes Phase 2: customer-facing PDF, public access token and immutable send metadata.

ALTER TABLE "Quote"
  ADD COLUMN "firstViewedAt" TIMESTAMP(3),
  ADD COLUMN "latestViewedAt" TIMESTAMP(3),
  ADD COLUMN "viewCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "declineReason" TEXT,
  ADD COLUMN "declineComment" TEXT,
  ADD COLUMN "acceptedQuoteVersion" INTEGER;

ALTER TABLE "QuoteRevision"
  ADD COLUMN "snapshotHash" TEXT;

ALTER TABLE "QuoteRevision"
  ADD CONSTRAINT "QuoteRevision_id_businessId_key" UNIQUE ("id", "businessId");

CREATE TABLE "QuotePdfDocument" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "quoteRevisionId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
  "storageProvider" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL,
  "checksum" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "QuotePdfDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuotePublicAccessToken" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "quoteRevisionId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastViewedAt" TIMESTAMP(3),
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "acceptedAt" TIMESTAMP(3),
  "declinedAt" TIMESTAMP(3),

  CONSTRAINT "QuotePublicAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuotePdfDocument_businessId_quoteId_version_key"
  ON "QuotePdfDocument"("businessId", "quoteId", "version");

CREATE UNIQUE INDEX "QuotePdfDocument_businessId_objectKey_key"
  ON "QuotePdfDocument"("businessId", "objectKey");

CREATE INDEX "QuotePdfDocument_businessId_quoteRevisionId_idx"
  ON "QuotePdfDocument"("businessId", "quoteRevisionId");

CREATE UNIQUE INDEX "QuotePublicAccessToken_tokenHash_key"
  ON "QuotePublicAccessToken"("tokenHash");

CREATE INDEX "QuotePublicAccessToken_businessId_quoteId_version_idx"
  ON "QuotePublicAccessToken"("businessId", "quoteId", "version");

CREATE INDEX "QuotePublicAccessToken_businessId_quoteRevisionId_idx"
  ON "QuotePublicAccessToken"("businessId", "quoteRevisionId");

CREATE INDEX "QuotePublicAccessToken_expiresAt_idx"
  ON "QuotePublicAccessToken"("expiresAt");

ALTER TABLE "QuotePdfDocument"
  ADD CONSTRAINT "QuotePdfDocument_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuotePdfDocument"
  ADD CONSTRAINT "QuotePdfDocument_quoteId_businessId_fkey"
  FOREIGN KEY ("quoteId", "businessId") REFERENCES "Quote"("id", "businessId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuotePdfDocument"
  ADD CONSTRAINT "QuotePdfDocument_quoteRevisionId_businessId_fkey"
  FOREIGN KEY ("quoteRevisionId", "businessId") REFERENCES "QuoteRevision"("id", "businessId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuotePublicAccessToken"
  ADD CONSTRAINT "QuotePublicAccessToken_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuotePublicAccessToken"
  ADD CONSTRAINT "QuotePublicAccessToken_quoteId_businessId_fkey"
  FOREIGN KEY ("quoteId", "businessId") REFERENCES "Quote"("id", "businessId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuotePublicAccessToken"
  ADD CONSTRAINT "QuotePublicAccessToken_quoteRevisionId_businessId_fkey"
  FOREIGN KEY ("quoteRevisionId", "businessId") REFERENCES "QuoteRevision"("id", "businessId") ON DELETE CASCADE ON UPDATE CASCADE;
