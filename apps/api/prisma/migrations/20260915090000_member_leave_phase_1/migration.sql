CREATE TYPE "MemberLeaveType" AS ENUM (
  'ANNUAL_LEAVE',
  'SICK_LEAVE',
  'PERSONAL_LEAVE',
  'UNAVAILABLE',
  'OTHER'
);

CREATE TYPE "MemberLeaveStatus" AS ENUM ('ACTIVE', 'CANCELLED');

CREATE TABLE "MemberLeave" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "type" "MemberLeaveType" NOT NULL,
  "startDate" TEXT NOT NULL,
  "endDate" TEXT NOT NULL,
  "note" TEXT,
  "status" "MemberLeaveStatus" NOT NULL DEFAULT 'ACTIVE',
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MemberLeave_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MemberLeave_businessId_memberId_status_startDate_idx" ON "MemberLeave"("businessId", "memberId", "status", "startDate");
CREATE INDEX "MemberLeave_businessId_status_startDate_idx" ON "MemberLeave"("businessId", "status", "startDate");

ALTER TABLE "MemberLeave"
ADD CONSTRAINT "MemberLeave_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MemberLeave"
ADD CONSTRAINT "MemberLeave_memberId_fkey"
FOREIGN KEY ("memberId") REFERENCES "BusinessMember"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
