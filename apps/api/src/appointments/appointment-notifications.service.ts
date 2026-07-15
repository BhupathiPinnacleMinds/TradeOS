import { Injectable, Logger } from '@nestjs/common';
import type { Appointment } from '@tradieos/shared';

@Injectable()
export class AppointmentNotificationsService {
  private readonly logger = new Logger(AppointmentNotificationsService.name);

  notifyOldTechnician(input: {
    appointment: Appointment;
    oldTechnicianId: string | null;
    newTechnicianName: string;
  }) {
    if (!input.oldTechnicianId) return;
    this.logger.log(
      `Appointment ${input.appointment.appointmentNumber} reassigned away from ${input.oldTechnicianId} to ${input.newTechnicianName}.`,
    );
  }

  notifyNewTechnician(input: {
    appointment: Appointment;
    newTechnicianId: string | null;
    previousTechnicianName: string;
  }) {
    if (!input.newTechnicianId) return;
    this.logger.log(
      `Appointment ${input.appointment.appointmentNumber} assigned to ${input.newTechnicianId}; previous technician was ${input.previousTechnicianName}.`,
    );
  }
}
