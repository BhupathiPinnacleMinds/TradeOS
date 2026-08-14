-- Split the previously overloaded Quote.jobId relationship into explicit
-- directional relationships while keeping jobId as a legacy compatibility
-- field for older code/data.

ALTER TABLE "Job" ADD COLUMN "sourceQuoteId" TEXT;

ALTER TABLE "Quote"
  ADD COLUMN "relatedJobId" TEXT,
  ADD COLUMN "convertedJobId" TEXT;

UPDATE "Quote"
SET "convertedJobId" = "jobId"
WHERE "jobId" IS NOT NULL
  AND ("status" = 'CONVERTED' OR "convertedAt" IS NOT NULL);

UPDATE "Quote"
SET "relatedJobId" = "jobId"
WHERE "jobId" IS NOT NULL
  AND "convertedJobId" IS NULL;

UPDATE "Job" AS job
SET "sourceQuoteId" = source_quote.id
FROM (
  SELECT DISTINCT ON ("businessId", "convertedJobId")
    "businessId",
    "convertedJobId",
    id
  FROM "Quote"
  WHERE "convertedJobId" IS NOT NULL
  ORDER BY "businessId", "convertedJobId", "convertedAt" DESC NULLS LAST, "createdAt" DESC
) AS source_quote
WHERE source_quote."businessId" = job."businessId"
  AND source_quote."convertedJobId" = job.id;

CREATE INDEX "Job_businessId_sourceQuoteId_idx" ON "Job"("businessId", "sourceQuoteId");
CREATE INDEX "Quote_businessId_relatedJobId_idx" ON "Quote"("businessId", "relatedJobId");
CREATE INDEX "Quote_businessId_convertedJobId_idx" ON "Quote"("businessId", "convertedJobId");

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_sourceQuoteId_businessId_fkey"
  FOREIGN KEY ("sourceQuoteId", "businessId")
  REFERENCES "Quote"("id", "businessId")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "Quote"
  ADD CONSTRAINT "Quote_relatedJobId_businessId_fkey"
  FOREIGN KEY ("relatedJobId", "businessId")
  REFERENCES "Job"("id", "businessId")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "Quote"
  ADD CONSTRAINT "Quote_convertedJobId_businessId_fkey"
  FOREIGN KEY ("convertedJobId", "businessId")
  REFERENCES "Job"("id", "businessId")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
