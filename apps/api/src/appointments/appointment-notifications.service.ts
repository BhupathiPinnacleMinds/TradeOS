import { Injectable, Logger } from '@nestjs/common';
import type { Appointment, AuthenticatedUser } from '@tradieos/shared';
import {
  DEFAULT_BUSINESS_TIMEZONE,
  formatBusinessTime,
} from '@tradieos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AppointmentNotificationsService {
  private readonly logger = new Logger(AppointmentNotificationsService.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  async notifyAssigned(input: {
    actor: AuthenticatedUser;
    appointment: Appointment;
  }) {
    await this.notifyTechnician({
      actorId: input.actor.id,
      appointment: input.appointment,
      body: await this.appointmentBody(
        input.appointment,
        'has been assigned to you.',
      ),
      title: 'New appointment assigned',
      type: 'APPOINTMENT_ASSIGNED',
      userId: input.appointment.assignedUserId,
    });
  }

  async notifyRescheduled(input: {
    actor: AuthenticatedUser;
    appointment: Appointment;
  }) {
    await this.notifyTechnician({
      actorId: input.actor.id,
      appointment: input.appointment,
      body: await this.appointmentBody(
        input.appointment,
        'has been rescheduled.',
      ),
      title: 'Appointment rescheduled',
      type: 'APPOINTMENT_RESCHEDULED',
      userId: input.appointment.assignedUserId,
    });
  }

  async notifyCancelled(input: {
    actor: AuthenticatedUser;
    appointment: Appointment;
  }) {
    await this.notifyTechnician({
      actorId: input.actor.id,
      appointment: input.appointment,
      body: await this.appointmentBody(
        input.appointment,
        'has been cancelled.',
      ),
      title: 'Appointment cancelled',
      type: 'APPOINTMENT_CANCELLED',
      userId: input.appointment.assignedUserId,
    });
  }

  notifyOldTechnician(input: {
    actor?: AuthenticatedUser;
    appointment: Appointment;
    oldTechnicianId: string | null;
    newTechnicianName: string;
  }) {
    if (!input.oldTechnicianId) return;
    this.logger.log(
      `Appointment ${input.appointment.appointmentNumber} reassigned away from ${input.oldTechnicianId} to ${input.newTechnicianName}.`,
    );
  }

  async notifyNewTechnician(input: {
    actor?: AuthenticatedUser;
    appointment: Appointment;
    newTechnicianId: string | null;
    previousTechnicianName: string;
  }) {
    if (!input.newTechnicianId) return;
    this.logger.log(
      `Appointment ${input.appointment.appointmentNumber} assigned to ${input.newTechnicianId}; previous technician was ${input.previousTechnicianName}.`,
    );
    await this.notifyTechnician({
      actorId: input.actor?.id,
      appointment: input.appointment,
      body: await this.appointmentBody(
        input.appointment,
        `has been reassigned to you from ${input.previousTechnicianName}.`,
      ),
      title: 'Appointment reassigned',
      type: 'APPOINTMENT_REASSIGNED',
      userId: input.newTechnicianId,
    });
  }

  private async notifyTechnician(input: {
    actorId?: string;
    appointment: Appointment;
    body: string;
    title: string;
    type: string;
    userId: string | null;
  }) {
    if (!input.userId || input.userId === input.actorId) return;

    try {
      await this.notifications.create({
        body: input.body,
        businessId: input.appointment.businessId,
        entityId: input.appointment.id,
        entityType: 'appointment',
        metadata: {
          appointmentNumber: input.appointment.appointmentNumber,
          jobId: input.appointment.jobId,
          scheduledStart: input.appointment.scheduledStart,
        },
        title: input.title,
        type: input.type,
        userId: input.userId,
      });
    } catch (error) {
      this.logger.warn(
        `Unable to queue appointment notification ${input.type}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async appointmentBody(appointment: Appointment, suffix: string) {
    const timezone = await this.businessTimezone(appointment.businessId);
    const time = formatBusinessTime(appointment.scheduledStart, timezone);
    const customerName =
      appointment.job.customer.displayName ??
      appointment.job.customer.companyName ??
      'the customer';
    return `${appointment.job.title} with ${customerName} at ${time} ${suffix}`;
  }

  private async businessTimezone(businessId: string) {
    try {
      const business = await this.prisma.business.findUnique({
        select: { timezone: true },
        where: { id: businessId },
      });
      return business?.timezone ?? DEFAULT_BUSINESS_TIMEZONE;
    } catch {
      return DEFAULT_BUSINESS_TIMEZONE;
    }
  }
}
