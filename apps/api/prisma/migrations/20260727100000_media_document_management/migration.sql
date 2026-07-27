CREATE TYPE "MediaCategory" AS ENUM (
  'BEFORE_PHOTO',
  'PROGRESS_PHOTO',
  'AFTER_PHOTO',
  'DAMAGE_EVIDENCE',
  'CUSTOMER_SUPPLIED',
  'COMPLIANCE_CERTIFICATE',
  'WARRANTY',
  'PLAN_DRAWING',
  'PERMIT',
  'RECEIPT',
  'MATERIAL_INVOICE',
  'GENERAL_DOCUMENT',
  'OTHER'
);

CREATE TYPE "MediaType" AS ENUM (
  'IMAGE',
  'PDF',
  'DOCUMENT',
  'VIDEO',
  'AUDIO',
  'OTHER'
);

CREATE TYPE "UploadStatus" AS ENUM (
  'PENDING',
  'UPLOADING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

CREATE TYPE "ProcessingStatus" AS ENUM (
  'NOT_REQUIRED',
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED'
);

CREATE TABLE "MediaAsset" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "customerId" TEXT,
  "jobId" TEXT,
  "appointmentId" TEXT,
  "uploadedByUserId" TEXT NOT NULL,
  "category" "MediaCategory" NOT NULL,
  "mediaType" "MediaType" NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "storageProvider" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "durationSeconds" INTEGER,
  "checksum" TEXT,
  "caption" TEXT,
  "notes" TEXT,
  "isCustomerVisible" BOOLEAN NOT NULL DEFAULT false,
  "uploadStatus" "UploadStatus" NOT NULL DEFAULT 'PENDING',
  "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  "thumbnailObjectKey" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaAsset_businessId_objectKey_key" ON "MediaAsset"("businessId", "objectKey");
CREATE INDEX "MediaAsset_businessId_customerId_createdAt_idx" ON "MediaAsset"("businessId", "customerId", "createdAt");
CREATE INDEX "MediaAsset_businessId_jobId_createdAt_idx" ON "MediaAsset"("businessId", "jobId", "createdAt");
CREATE INDEX "MediaAsset_businessId_appointmentId_createdAt_idx" ON "MediaAsset"("businessId", "appointmentId", "createdAt");
CREATE INDEX "MediaAsset_businessId_category_createdAt_idx" ON "MediaAsset"("businessId", "category", "createdAt");
CREATE INDEX "MediaAsset_businessId_mediaType_createdAt_idx" ON "MediaAsset"("businessId", "mediaType", "createdAt");
CREATE INDEX "MediaAsset_businessId_uploadedByUserId_createdAt_idx" ON "MediaAsset"("businessId", "uploadedByUserId", "createdAt");
CREATE INDEX "MediaAsset_businessId_uploadStatus_createdAt_idx" ON "MediaAsset"("businessId", "uploadStatus", "createdAt");
CREATE INDEX "MediaAsset_businessId_archivedAt_idx" ON "MediaAsset"("businessId", "archivedAt");

ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_customerId_businessId_fkey"
  FOREIGN KEY ("customerId", "businessId") REFERENCES "Customer"("id", "businessId") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_jobId_businessId_fkey"
  FOREIGN KEY ("jobId", "businessId") REFERENCES "Job"("id", "businessId") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_appointmentId_businessId_fkey"
  FOREIGN KEY ("appointmentId", "businessId") REFERENCES "Appointment"("id", "businessId") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_uploadedByUserId_businessId_fkey"
  FOREIGN KEY ("uploadedByUserId", "businessId") REFERENCES "User"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;
