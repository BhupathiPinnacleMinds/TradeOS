import { HttpException } from '@nestjs/common';
import type { AuthenticatedUser } from '@tradieos/shared';
import { AppointmentNotificationsService } from './appointment-notifications.service';
import { AppointmentsService } from './appointments.service';
import { SchedulingService } from './scheduling.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

const owner: AuthenticatedUser = {
  businessId: 'business-1',
  email: 'owner@example.com',
  id: 'owner-1',
  role: 'OWNER',
};

const technician: AuthenticatedUser = {
  businessId: 'business-1',
  email: 'tech@example.com',
  id: 'tech-1',
  role: 'TECHNICIAN',
};

type MockPrisma = {
  appointment: {
    count: jest.Mock;
    create: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
  appointmentSequence: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  auditLog: { create: jest.Mock };
  businessMember: { findFirst: jest.Mock; findMany: jest.Mock };
  customerSite: { create: jest.Mock; findFirst: jest.Mock };
  job: { findFirst: jest.Mock };
  user: { findFirst: jest.Mock };
  $transaction: jest.Mock;
};

type AppointmentCreateCall = [
  {
    data: Record<string, unknown>;
  },
];

type AppointmentUpdateCall = [
  {
    data: Record<string, unknown>;
  },
];

function appointment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    actualEnd: null,
    actualStart: null,
    accessInstructions: 'Use side gate',
    addressLine1: '12 King Street',
    addressLine2: null,
    appointmentNumber: 'APT-2026-000001',
    appointmentType: 'INSPECTION',
    assignedUser: {
      email: 'tech@example.com',
      firstName: 'Mia',
      id: 'tech-1',
      lastName: 'Technician',
    },
    assignedUserId: 'tech-1',
    businessId: 'business-1',
    createdAt: new Date('2026-07-15T00:00:00.000Z'),
    createdBy: 'owner-1',
    customerSiteId: null,
    estimatedDurationMinutes: 120,
    id: 'appointment-1',
    job: {
      addressLine1: '12 King Street',
      addressLine2: null,
      customer: {
        companyName: null,
        displayName: 'Priya Shah',
        email: null,
        id: 'customer-1',
        phone: '0400000000',
      },
      id: 'job-1',
      jobNumber: 'JOB-2026-000001',
      postcode: '2150',
      priority: 'NORMAL',
      state: 'NSW',
      suburb: 'Parramatta',
      title: 'Inspection',
    },
    jobId: 'job-1',
    locationSource: 'CUSTOMER_DEFAULT',
    notes: null,
    postcode: '2150',
    scheduledEnd: new Date('2026-07-15T01:00:00.000Z'),
    scheduledStart: new Date('2026-07-15T00:00:00.000Z'),
    state: 'NSW',
    status: 'SCHEDULED',
    suburb: 'Parramatta',
    travelDistanceKm: null,
    travelDurationMinutes: null,
    updatedAt: new Date('2026-07-15T00:00:00.000Z'),
    updatedBy: null,
    ...overrides,
  };
}

function createService() {
  const prisma: MockPrisma = {
    appointment: {
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn().mockResolvedValue(appointment()),
      findFirst: jest.fn().mockResolvedValue(appointment()),
      findMany: jest.fn().mockResolvedValue([appointment()]),
      update: jest.fn().mockResolvedValue(appointment({ status: 'COMPLETED' })),
    },
    appointmentSequence: {
      create: jest.fn(),
      findUnique: jest
        .fn()
        .mockResolvedValue({ businessId: 'business-1', nextNumber: 4 }),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    businessMember: {
      findFirst: jest.fn().mockResolvedValue({ id: 'member-1' }),
      findMany: jest.fn().mockResolvedValue([
        {
          role: 'TECHNICIAN',
          user: { firstName: 'Mia', id: 'tech-1', lastName: 'Technician' },
        },
      ]),
    },
    customerSite: {
      create: jest.fn().mockResolvedValue({
        id: 'site-created',
      }),
      findFirst: jest.fn().mockResolvedValue({
        accessInstructions: 'Gate code 1234',
        addressLine1: '44 Queen Street',
        addressLine2: 'Unit 2',
        id: 'site-1',
        postcode: '3000',
        state: 'VIC',
        suburb: 'Melbourne',
      }),
    },
    job: {
      findFirst: jest.fn().mockResolvedValue({
        addressLine1: '12 King Street',
        addressLine2: null,
        customer: {
          addressLine1: '99 Default Road',
          addressLine2: null,
          postcode: '2150',
          state: 'NSW',
          suburb: 'Parramatta',
        },
        customerId: 'customer-1',
        id: 'job-1',
        postcode: '2150',
        state: 'NSW',
        suburb: 'Parramatta',
      }),
    },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'tech-1' }) },
    $transaction: jest.fn(
      (input: Array<Promise<unknown>> | ((tx: MockPrisma) => unknown)) => {
        if (typeof input === 'function') return Promise.resolve(input(prisma));
        return Promise.all(input);
      },
    ),
  };
  const scheduling = new SchedulingService(prisma as never);
  const notificationMocks = {
    notifyNewTechnician: jest.fn(),
    notifyOldTechnician: jest.fn(),
  };
  const notifications =
    notificationMocks as unknown as AppointmentNotificationsService;
  return {
    notificationMocks,
    notifications,
    prisma,
    service: new AppointmentsService(
      prisma as never,
      scheduling,
      notifications,
    ),
  };
}

describe('AppointmentsService', () => {
  afterEach(() => jest.clearAllMocks());

  function expectDomainError(error: unknown, code: string) {
    expect(error).toBeInstanceOf(HttpException);
    const response = (error as HttpException).getResponse() as { code: string };
    expect(response.code).toBe(code);
  }

  it('lists appointments scoped to the current business', async () => {
    const { prisma, service } = createService();

    const result = await service.findAll(owner, { page: 1, pageSize: 20 });

    expect(result.records).toHaveLength(1);
    const findManyCalls = prisma.appointment.findMany.mock
      .calls as unknown as Array<[{ where: { businessId: string } }]>;
    expect(findManyCalls[0][0].where.businessId).toBe('business-1');
  });

  it('creates appointments with per-business appointment numbers', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([]);

    await service.create(owner, {
      appointmentType: 'INSPECTION',
      assignedUserId: 'tech-1',
      jobId: 'job-1',
      scheduledEnd: '2026-07-15T10:00:00',
      scheduledStart: '2026-07-15T09:00:00',
    });

    expect(prisma.appointmentSequence.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: 'business-1' } }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it('creates appointments with a customer default address snapshot', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([]);

    await service.create(owner, {
      appointmentType: 'INSPECTION',
      assignedUserId: 'tech-1',
      jobId: 'job-1',
      locationSource: 'CUSTOMER_DEFAULT',
      scheduledEnd: '2026-07-15T10:00:00',
      scheduledStart: '2026-07-15T09:00:00',
    });

    const createCalls = prisma.appointment.create.mock
      .calls as unknown as AppointmentCreateCall[];
    expect(createCalls[0][0].data.addressLine1).toBe('99 Default Road');
    expect(createCalls[0][0].data.locationSource).toBe('CUSTOMER_DEFAULT');
    expect(createCalls[0][0].data.postcode).toBe('2150');
  });

  it('creates appointments with a selected service-site snapshot', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([]);

    await service.create(owner, {
      appointmentType: 'INSPECTION',
      assignedUserId: 'tech-1',
      customerSiteId: 'site-1',
      jobId: 'job-1',
      locationSource: 'CUSTOMER_SITE',
      scheduledEnd: '2026-07-15T10:00:00',
      scheduledStart: '2026-07-15T09:00:00',
    });

    const siteCalls = prisma.customerSite.findFirst.mock
      .calls as unknown as Array<[{ where: Record<string, unknown> }]>;
    expect(siteCalls[0][0].where.businessId).toBe('business-1');
    expect(siteCalls[0][0].where.customerId).toBe('customer-1');
    expect(siteCalls[0][0].where.id).toBe('site-1');
    const createCalls = prisma.appointment.create.mock
      .calls as unknown as AppointmentCreateCall[];
    expect(createCalls[0][0].data.addressLine1).toBe('44 Queen Street');
    expect(createCalls[0][0].data.customerSiteId).toBe('site-1');
    expect(createCalls[0][0].data.locationSource).toBe('CUSTOMER_SITE');
  });

  it('rejects invalid manual appointment postcodes', async () => {
    const { service } = createService();

    await service
      .create(owner, {
        addressLine1: '1 Manual Street',
        appointmentType: 'INSPECTION',
        assignedUserId: 'tech-1',
        jobId: 'job-1',
        locationSource: 'MANUAL',
        postcode: '300',
        scheduledEnd: '2026-07-15T10:00:00',
        scheduledStart: '2026-07-15T09:00:00',
        state: 'VIC',
        suburb: 'Melbourne',
      })
      .catch((error) => {
        expectDomainError(error, 'INVALID_APPOINTMENT_DATA');
      });
  });

  it('does not create a customer site for one-off manual addresses', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([]);

    await service.create(owner, {
      addressLine1: '1 Manual Street',
      appointmentType: 'INSPECTION',
      assignedUserId: 'tech-1',
      jobId: 'job-1',
      locationSource: 'MANUAL',
      postcode: '3000',
      scheduledEnd: '2026-07-15T10:00:00',
      scheduledStart: '2026-07-15T09:00:00',
      state: 'VIC',
      suburb: 'Melbourne',
    });

    expect(prisma.customerSite.create).not.toHaveBeenCalled();
    const createCalls = prisma.appointment.create.mock
      .calls as unknown as AppointmentCreateCall[];
    expect(createCalls[0][0].data.addressLine1).toBe('1 Manual Street');
    expect(createCalls[0][0].data.customerSiteId).toBeNull();
    expect(createCalls[0][0].data.locationSource).toBe('MANUAL');
  });

  it('optionally saves a manual appointment address as a customer site and links it', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([]);

    await service.create(owner, {
      addressLine1: '1 Manual Street',
      appointmentType: 'INSPECTION',
      assignedUserId: 'tech-1',
      jobId: 'job-1',
      locationSource: 'MANUAL',
      postcode: '3000',
      saveAddressAsCustomerSite: true,
      scheduledEnd: '2026-07-15T10:00:00',
      scheduledStart: '2026-07-15T09:00:00',
      state: 'VIC',
      suburb: 'Melbourne',
    });

    expect(prisma.customerSite.create).toHaveBeenCalled();
    const createCalls = prisma.appointment.create.mock
      .calls as unknown as AppointmentCreateCall[];
    expect(createCalls[0][0].data.customerSiteId).toBe('site-created');
  });

  it('prevents technicians viewing unassigned appointments', async () => {
    const { service } = createService();
    const { prisma } = createService();
    prisma.appointment.findFirst.mockResolvedValue(
      appointment({ assignedUserId: 'someone-else' }),
    );
    const blockedService = new AppointmentsService(
      prisma as never,
      new SchedulingService(prisma as never),
      {
        notifyNewTechnician: jest.fn(),
        notifyOldTechnician: jest.fn(),
      } as unknown as AppointmentNotificationsService,
    );

    await blockedService.findOne(technician, 'appointment-1').catch((error) => {
      expectDomainError(error, 'APPOINTMENT_NOT_FOUND');
    });
    expect(service).toBeDefined();
  });

  it('records completion transitions', async () => {
    const { prisma, service } = createService();

    await service.transition(owner, 'appointment-1', 'COMPLETED');

    const updateCalls = prisma.appointment.update.mock
      .calls as unknown as Array<
      [{ data: { actualEnd?: Date; status: string } }]
    >;
    expect(updateCalls[0][0].data.status).toBe('COMPLETED');
    expect(updateCalls[0][0].data.actualEnd).toBeInstanceOf(Date);
  });

  it('keeps same-record reschedules active instead of leaving RESCHEDULED', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    prisma.appointment.update.mockResolvedValue(
      appointment({
        scheduledEnd: new Date('2026-07-15T11:00:00.000Z'),
        scheduledStart: new Date('2026-07-15T09:00:00.000Z'),
        status: 'SCHEDULED',
      }),
    );

    await service.update(owner, 'appointment-1', {
      appointmentType: 'INSPECTION',
      assignedUserId: 'tech-1',
      jobId: 'job-1',
      scheduledEnd: '2026-07-15T11:00:00',
      scheduledStart: '2026-07-15T09:00:00',
      status: 'RESCHEDULED',
    });

    const updateCalls = prisma.appointment.update.mock
      .calls as unknown as AppointmentUpdateCall[];
    expect(updateCalls[0][0].data.status).toBe('SCHEDULED');
    const auditCalls = prisma.auditLog.create.mock.calls as unknown as Array<
      [{ data: { action: string } }]
    >;
    expect(
      auditCalls.some(
        (call) => call[0].data.action === 'APPOINTMENT_RESCHEDULED',
      ),
    ).toBe(true);
  });

  it('recommends a technician without scheduling conflicts', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([]);

    const recommendation = await service.recommend(owner, {
      jobId: 'job-1',
      scheduledEnd: '2026-07-15T10:00:00',
      scheduledStart: '2026-07-15T09:00:00',
    });

    expect(recommendation.recommendedTechnicianId).toBe('tech-1');
  });

  it('blocks overlapping appointments unless an owner overrides', async () => {
    const { service } = createService();

    await service
      .create(owner, {
        appointmentType: 'INSPECTION',
        assignedUserId: 'tech-1',
        jobId: 'job-1',
        scheduledEnd: '2026-07-15T10:00:00',
        scheduledStart: '2026-07-15T09:00:00',
      })
      .catch((error) => {
        expectDomainError(error, 'APPOINTMENT_CONFLICT');
      });
  });

  it('allows owners to override scheduling conflicts intentionally', async () => {
    const { prisma, service } = createService();

    await service.create(owner, {
      allowConflictOverride: true,
      appointmentType: 'INSPECTION',
      assignedUserId: 'tech-1',
      jobId: 'job-1',
      scheduledEnd: '2026-07-15T10:00:00',
      scheduledStart: '2026-07-15T09:00:00',
    });

    expect(prisma.appointment.create).toHaveBeenCalled();
  });

  it('returns availability conflicts for calendar scheduling checks', async () => {
    const { service } = createService();

    const availability = await service.availability(owner, {
      assignedUserId: 'tech-1',
      scheduledEnd: '2026-07-15T10:00:00',
      scheduledStart: '2026-07-15T09:00:00',
    });

    expect(availability.hasConflict).toBe(true);
    expect(availability.canOverride).toBe(true);
    expect(availability.conflicts[0].appointmentNumber).toBe('APT-2026-000001');
  });

  it('reassigns an appointment without changing job, time, notes or address', async () => {
    const { notificationMocks, prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    prisma.businessMember.findFirst
      .mockResolvedValueOnce({ id: 'member-2' })
      .mockResolvedValueOnce({
        user: { firstName: 'Sam', lastName: 'Scheduler' },
      });
    prisma.appointment.update.mockResolvedValue(
      appointment({
        assignedUser: {
          email: 'sam@example.com',
          firstName: 'Sam',
          id: 'tech-2',
          lastName: 'Scheduler',
        },
        assignedUserId: 'tech-2',
      }),
    );

    const result = await service.reassign(owner, 'appointment-1', {
      assignedUserId: 'tech-2',
      reason: 'Balancing workload',
    });

    expect(result.appointment.assignedUserId).toBe('tech-2');
    const updateCalls = prisma.appointment.update.mock
      .calls as unknown as AppointmentUpdateCall[];
    expect(updateCalls[0][0].data).toEqual({
      assignedUserId: 'tech-2',
      updatedBy: 'owner-1',
    });
    expect(notificationMocks.notifyOldTechnician).toHaveBeenCalled();
    expect(notificationMocks.notifyNewTechnician).toHaveBeenCalled();
  });

  it('denies technicians from reassigning appointments', async () => {
    const { service } = createService();

    await service
      .reassign(technician, 'appointment-1', { assignedUserId: 'tech-2' })
      .catch((error) => {
        expectDomainError(error, 'INSUFFICIENT_PERMISSION');
      });
  });

  it('blocks reassignment conflicts unless an owner or admin overrides', async () => {
    const { service } = createService();

    await service
      .reassign(owner, 'appointment-1', { assignedUserId: 'tech-1' })
      .catch((error) => {
        expectDomainError(error, 'APPOINTMENT_CONFLICT');
      });
  });

  it('allows owner reassignment conflict override', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValueOnce({ id: 'member-1' });

    await service.reassign(owner, 'appointment-1', {
      allowConflictOverride: true,
      assignedUserId: 'tech-1',
    });

    expect(prisma.appointment.update).toHaveBeenCalled();
  });

  it('writes an audit entry when an appointment is reassigned', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    prisma.businessMember.findFirst
      .mockResolvedValueOnce({ id: 'member-2' })
      .mockResolvedValueOnce({
        user: { firstName: 'Sam', lastName: 'Scheduler' },
      });

    await service.reassign(owner, 'appointment-1', {
      assignedUserId: 'tech-2',
    });

    const auditCalls = prisma.auditLog.create.mock.calls as unknown as Array<
      [{ data: { action: string; metadata: Record<string, unknown> } }]
    >;
    expect(
      auditCalls.some(
        (call) => call[0].data.action === 'APPOINTMENT_REASSIGNED',
      ),
    ).toBe(true);
  });

  it('returns reassignment recommendations and technician workload', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany
      .mockResolvedValueOnce([appointment()])
      .mockResolvedValueOnce([]);

    const result = await service.reassignmentOptions(owner, 'appointment-1');

    expect(result.appointment.id).toBe('appointment-1');
    expect(result.technicians[0].todayWorkload).toBe(1);
    expect(result.recommendation.technicianId).toBe('tech-1');
  });
});
