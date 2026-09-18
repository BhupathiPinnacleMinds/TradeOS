ALTER TABLE "Appointment" ADD COLUMN "multipleTechniciansRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AppointmentCrewMember" (
    "businessId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppointmentCrewMember_pkey" PRIMARY KEY ("businessId", "appointmentId", "userId")
);

CREATE INDEX "AppointmentCrewMember_businessId_userId_idx" ON "AppointmentCrewMember"("businessId", "userId");
ALTER TABLE "AppointmentCrewMember" ADD CONSTRAINT "AppointmentCrewMember_appointmentId_businessId_fkey" FOREIGN KEY ("appointmentId", "businessId") REFERENCES "Appointment"("id", "businessId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentCrewMember" ADD CONSTRAINT "AppointmentCrewMember_userId_businessId_fkey" FOREIGN KEY ("userId", "businessId") REFERENCES "User"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "AppointmentCrewMember" ("businessId", "appointmentId", "userId", "assignedAt")
SELECT a."businessId", a."id", a."assignedUserId", a."createdAt"
FROM "Appointment" a
JOIN "User" u ON u."id" = a."assignedUserId" AND u."businessId" = a."businessId"
WHERE a."assignedUserId" IS NOT NULL;

CREATE TABLE "AppointmentCompletionCrew" (
    "businessId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppointmentCompletionCrew_pkey" PRIMARY KEY ("businessId", "appointmentId", "userId")
);

CREATE INDEX "AppointmentCompletionCrew_businessId_appointmentId_idx" ON "AppointmentCompletionCrew"("businessId", "appointmentId");
ALTER TABLE "AppointmentCompletionCrew" ADD CONSTRAINT "AppointmentCompletionCrew_appointmentId_businessId_fkey" FOREIGN KEY ("appointmentId", "businessId") REFERENCES "Appointment"("id", "businessId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing completed appointments retain their current assignee as the best available
-- historical attribution; pre-migration name changes cannot be reconstructed.
INSERT INTO "AppointmentCompletionCrew" ("businessId", "appointmentId", "userId", "displayName", "completedAt")
SELECT a."businessId", a."id", u."id", trim(u."firstName" || ' ' || u."lastName"), COALESCE(a."completedAt", a."updatedAt")
FROM "Appointment" a
JOIN "User" u ON u."id" = a."assignedUserId" AND u."businessId" = a."businessId"
WHERE a."status" = 'COMPLETED' AND a."assignedUserId" IS NOT NULL;
