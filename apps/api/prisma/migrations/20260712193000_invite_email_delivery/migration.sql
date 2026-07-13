ALTER TABLE "BusinessMember"
ADD COLUMN "inviteEmailDeliveryStatus" TEXT DEFAULT 'PENDING',
ADD COLUMN "inviteEmailDeliveryError" TEXT;
