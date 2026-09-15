-- CreateEnum
CREATE TYPE "MemberShiftStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateTable
CREATE TABLE "MemberShift" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "shiftDate" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "status" "MemberShiftStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "createdByMemberId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberShift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberShift_businessId_memberId_shiftDate_status_idx" ON "MemberShift"("businessId", "memberId", "shiftDate", "status");

-- CreateIndex
CREATE INDEX "MemberShift_businessId_shiftDate_status_idx" ON "MemberShift"("businessId", "shiftDate", "status");

-- AddForeignKey
ALTER TABLE "MemberShift" ADD CONSTRAINT "MemberShift_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberShift" ADD CONSTRAINT "MemberShift_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "BusinessMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberShift" ADD CONSTRAINT "MemberShift_createdByMemberId_fkey" FOREIGN KEY ("createdByMemberId") REFERENCES "BusinessMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
