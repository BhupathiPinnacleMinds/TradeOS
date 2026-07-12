-- Backfill existing single-workspace users into the richer membership model.
INSERT INTO "BusinessMember" (
    "id",
    "businessId",
    "userId",
    "role",
    "status",
    "invitedEmail",
    "inviteToken",
    "invitedBy",
    "invitedAt",
    "joinedAt",
    "lastLoginAt",
    "createdAt",
    "updatedAt"
)
SELECT
    'member_' || "id",
    "businessId",
    "id",
    "role",
    CASE WHEN "isActive" THEN 'ACTIVE'::"MemberStatus" ELSE 'SUSPENDED'::"MemberStatus" END,
    "email",
    NULL,
    NULL,
    "createdAt",
    "createdAt",
    NULL,
    "createdAt",
    "updatedAt"
FROM "User"
ON CONFLICT ("businessId", "userId") DO NOTHING;
