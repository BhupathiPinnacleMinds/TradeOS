-- Technician field workflow work logs.
CREATE TABLE "AppointmentWorkLog" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "technicianUserId" TEXT NOT NULL,
    "technicianNotes" TEXT,
    "workCompleted" TEXT,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "followUpNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppointmentWorkLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppointmentWorkLog_businessId_appointmentId_key" ON "AppointmentWorkLog"("businessId", "appointmentId");
CREATE INDEX "AppointmentWorkLog_businessId_jobId_createdAt_idx" ON "AppointmentWorkLog"("businessId", "jobId", "createdAt");
CREATE INDEX "AppointmentWorkLog_businessId_technicianUserId_createdAt_idx" ON "AppointmentWorkLog"("businessId", "technicianUserId", "createdAt");

ALTER TABLE "AppointmentWorkLog" ADD CONSTRAINT "AppointmentWorkLog_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentWorkLog" ADD CONSTRAINT "AppointmentWorkLog_appointmentId_businessId_fkey" FOREIGN KEY ("appointmentId", "businessId") REFERENCES "Appointment"("id", "businessId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentWorkLog" ADD CONSTRAINT "AppointmentWorkLog_jobId_businessId_fkey" FOREIGN KEY ("jobId", "businessId") REFERENCES "Job"("id", "businessId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentWorkLog" ADD CONSTRAINT "AppointmentWorkLog_technicianUserId_businessId_fkey" FOREIGN KEY ("technicianUserId", "businessId") REFERENCES "User"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;
