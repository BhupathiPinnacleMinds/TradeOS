import type { Appointment, AuthenticatedUser } from '@tradieos/shared';
import { AppointmentNotificationsService } from './appointment-notifications.service';

const actor: AuthenticatedUser = {
  businessId: 'business-1',
  email: 'owner@example.com',
  id: 'owner-1',
  role: 'OWNER',
};

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    accessInstructions: null,
    addressLine1: '12 King Street',
    addressLine2: null,
    appointmentNumber: 'APT-2026-000123',
    appointmentType: 'INSPECTION',
    arrivedAt: null,
    assignedUser: {
      email: 'mia@example.com',
      firstName: 'Mia',
      id: 'tech-1',
      lastLoginAt: null,
      lastName: 'Field',
      role: 'TECHNICIAN',
      status: 'ACTIVE',
    },
    assignedUserId: 'tech-1',
    businessId: 'business-1',
    cancelledAt: null,
    cancellationReason: null,
    completedAt: null,
    createdAt: '2026-08-31T00:00:00.000Z',
    customerSiteId: null,
    estimatedDurationMinutes: 60,
    id: 'appointment-1',
    job: {
      businessId: 'business-1',
      customer: {
        companyName: null,
        displayName: 'Raj Patel',
        email: 'raj@example.com',
        id: 'customer-1',
        phone: '0422462867',
      },
      id: 'job-1',
      jobNumber: 'JOB-2026-000001',
      status: 'NEW',
      title: 'Hot water inspection',
    },
    jobId: 'job-1',
    latitude: null,
    locationSource: 'CUSTOMER_DEFAULT',
    longitude: null,
    notes: null,
    onsiteStartedAt: null,
    pausedAt: null,
    pauseReason: null,
    postcode: '3000',
    scheduledEnd: '2026-08-31T00:30:00.000Z',
    scheduledStart: '2026-08-30T23:30:00.000Z',
    state: 'VIC',
    status: 'CONFIRMED',
    suburb: 'Melbourne',
    timezone: 'Australia/Melbourne',
    travellingStartedAt: null,
    updatedAt: '2026-08-31T00:00:00.000Z',
    ...overrides,
  } as unknown as Appointment;
}

describe('AppointmentNotificationsService', () => {
  function createService() {
    const notifications = {
      createForRoles: jest.fn().mockResolvedValue({ count: 2 }),
      create: jest.fn().mockResolvedValue({ id: 'notification-1' }),
    };
    const prisma = {
      business: {
        findUnique: jest.fn().mockResolvedValue({
          timezone: 'Australia/Melbourne',
        }),
      },
    };

    return {
      notifications,
      prisma,
      service: new AppointmentNotificationsService(
        notifications as never,
        prisma as never,
      ),
    };
  }

  it('creates an assigned notification for the assigned technician', async () => {
    const { notifications, service } = createService();

    await service.notifyAssigned({ actor, appointment: appointment() });

    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'business-1',
        entityId: 'appointment-1',
        entityType: 'appointment',
        title: 'New appointment assigned',
        type: 'APPOINTMENT_ASSIGNED',
        userId: 'tech-1',
      }),
    );
  });

  it('does not notify the actor when they assign an appointment to themselves', async () => {
    const { notifications, service } = createService();

    await service.notifyAssigned({
      actor,
      appointment: appointment({ assignedUserId: actor.id }),
    });

    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('creates reschedule, cancellation and reassignment notifications', async () => {
    const { notifications, service } = createService();
    const record = appointment();

    await service.notifyRescheduled({ actor, appointment: record });
    await service.notifyCancelled({ actor, appointment: record });
    await service.notifyNewTechnician({
      actor,
      appointment: record,
      newTechnicianId: 'tech-2',
      previousTechnicianName: 'Mia Field',
    });

    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'APPOINTMENT_RESCHEDULED' }),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'APPOINTMENT_CANCELLED' }),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Appointment reassigned',
        type: 'APPOINTMENT_REASSIGNED',
        userId: 'tech-2',
      }),
    );
  });

  it('notifies owner and dispatch roles when an appointment is completed with follow-up', async () => {
    const { notifications, service } = createService();

    await service.notifyCompleted({
      actor: { ...actor, id: 'tech-1', role: 'TECHNICIAN' },
      appointment: appointment({
        completedAt: '2026-08-31T02:00:00.000Z',
        status: 'COMPLETED',
        workLog: {
          followUpNotes: 'Needs return visit with new pump.',
          followUpRequired: true,
          id: 'work-log-1',
          technicianNotes: 'Temporary repair completed.',
          workCompleted: 'Replaced failed valve.',
        },
      } as Partial<Appointment>),
    });

    expect(notifications.createForRoles).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'tech-1',
        businessId: 'business-1',
        entityId: 'job-1',
        entityType: 'job',
        roles: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER'],
        title: 'Appointment completed - follow-up needed',
        type: 'APPOINTMENT_COMPLETED_FOLLOW_UP',
      }),
    );
  });
});
