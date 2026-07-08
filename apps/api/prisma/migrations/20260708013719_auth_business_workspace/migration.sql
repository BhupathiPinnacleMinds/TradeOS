-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "address" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "gstRegistered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "postcode" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "suburb" TEXT,
ADD COLUMN     "tradeType" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordHash" TEXT NOT NULL DEFAULT '';
