-- Store invitation tokens securely as hashes only and track invitation lifecycle.
ALTER TABLE "BusinessMember"
ADD COLUMN "inviteTokenHash" TEXT,
ADD COLUMN "inviteExpiresAt" TIMESTAMP(3),
ADD COLUMN "inviteAcceptedAt" TIMESTAMP(3),
ADD COLUMN "inviteCancelledAt" TIMESTAMP(3);

-- Raw invite tokens must not be retained.
DROP INDEX IF EXISTS "BusinessMember_inviteToken_key";
ALTER TABLE "BusinessMember" DROP COLUMN IF EXISTS "inviteToken";

CREATE UNIQUE INDEX "BusinessMember_inviteTokenHash_key" ON "BusinessMember"("inviteTokenHash");
