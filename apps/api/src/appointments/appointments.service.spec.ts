import { HttpException } from '@nestjs/common';
import type { AuthenticatedUser, BusinessRole } from '@tradieos/shared';
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

const BUSINESS_HOURS_START = '2026-07-15T01:30:00.000Z'; // 11:30 AM Australia/Sydney
const BUSINESS_HOURS_END = '2026-07-15T02:30:00.000Z'; // 12:30 PM Australia/Sydney
const BUSINESS_HOURS_RESCHEDULE_END = '2026-07-15T03:00:00.000Z'; // 1:00 PM Australia/Sydney
const OVERLAPPING_START = '2026-07-15T00:30:00.000Z'; // 10:30 AM Australia/Sydney
const OVERLAPPING_END = '2026-07-15T00:45:00.000Z'; // 10:45 AM Australia/Sydney

function userForRole(role: BusinessRole): AuthenticatedUser {
  return {
    businessId: 'business-1',
    email: `${role.toLowerCase()}@example.com`,
    id: role === 'TECHNICIAN' ? 'tech-1' : `${role.toLowerCase()}-1`,
    role,
  };
}

type MockPrisma = {
  appointment: {
    count: jest.Mock;
    create: jest.Mock;
    findFirst: jest.Mock;
    findFirstOrThrow: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
  appointmentSequence: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  appointmentSignature: { upsert: jest.Mock };
  auditLog: { create: jest.Mock };
  appointmentWorkLog: { upsert: jest.Mock };
  business: { findUnique: jest.Mock };
  businessMember: { findFirst: jest.Mock; findMany: jest.Mock };
  customerSite: { create: jest.Mock; findFirst: jest.Mock };
  job: { findFirst: jest.Mock; update: jest.Mock };
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

type BusinessMemberLookupCall = [
  {
    where: {
      businessId?: string;
      role?: { in?: string[] };
      status?: string;
      user?: { isActive?: boolean };
      userId?: string;
    };
  },
];

function appointment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    actualEnd: null,
    actualStart: null,
    accessInstructions: 'Use side gate',
    arrivedAt: null,
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
    completedAt: null,
    currentWorkStartedAt: null,
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
    pausedAt: null,
    postcode: '2150',
    scheduledEnd: new Date('2026-07-15T01:00:00.000Z'),
    scheduledStart: new Date('2026-07-15T00:00:00.000Z'),
    state: 'NSW',
    status: 'SCHEDULED',
    signatures: [],
    suburb: 'Parramatta',
    totalPausedMinutes: 0,
    totalTravelMinutes: 0,
    totalWorkMinutes: 0,
    travelDistanceKm: null,
    travelDurationMinutes: null,
    travelStartedAt: null,
    updatedAt: new Date('2026-07-15T00:00:00.000Z'),
    updatedBy: null,
    workLogs: [],
    workStartedAt: null,
    ...overrides,
  };
}

function createService() {
  const prisma: MockPrisma = {
    appointment: {
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn().mockResolvedValue(appointment()),
      findFirst: jest.fn().mockResolvedValue(appointment()),
      findFirstOrThrow: jest.fn().mockResolvedValue(appointment()),
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
    appointmentSignature: { upsert: jest.fn() },
    auditLog: { create: jest.fn() },
    appointmentWorkLog: { upsert: jest.fn() },
    business: {
      findUnique: jest.fn().mockResolvedValue({ timezone: 'Australia/Sydney' }),
    },
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
        status: 'SCHEDULED',
      }),
      update: jest.fn(),
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
    notifyAssigned: jest.fn(),
    notifyCancelled: jest.fn(),
    notifyCompleted: jest.fn(),
    notifyNewTechnician: jest.fn(),
    notifyOldTechnician: jest.fn(),
    notifyRescheduled: jest.fn(),
  };
  const notifications =
    notificationMocks as unknown as AppointmentNotificationsService;
  const communications = {
    appointmentCancelled: jest.fn(),
    appointmentCompleted: jest.fn(),
    appointmentCreated: jest.fn(),
    appointmentRescheduled: jest.fn(),
  };
  return {
    communications,
    notificationMocks,
    notifications,
    prisma,
    service: new AppointmentsService(
      prisma as never,
      scheduling,
      notifications,
      communications as never,
    ),
  };
}

describe('AppointmentsService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-14T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

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

  it('returns canonical job identifiers for a completed appointment detail', async () => {
    const { prisma, service } = createService();
    const completedAppointment = appointment();
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({
        completedAt: new Date('2026-09-03T02:00:00.000Z'),
        job: {
          ...completedAppointment.job,
          id: 'job-db-3',
          jobNumber: 'JOB-2026-000003',
        },
        jobId: 'job-db-3',
        status: 'COMPLETED',
      }),
    );

    const result = await service.findOne(technician, 'appointment-1');

    expect(result.appointment.jobId).toBe('job-db-3');
    expect(result.appointment.job.id).toBe('job-db-3');
    expect(result.appointment.job.jobNumber).toBe('JOB-2026-000003');
  });

  it('creates appointments with per-business appointment numbers', async () => {
    const { notificationMocks, prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([]);

    await service.create(owner, {
      appointmentType: 'INSPECTION',
      assignedUserId: 'tech-1',
      jobId: 'job-1',
      scheduledEnd: BUSINESS_HOURS_END,
      scheduledStart: BUSINESS_HOURS_START,
    });

    expect(prisma.appointmentSequence.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { nextNumber: 5 },
        where: { businessId: 'business-1' },
      }),
    );
    const createCalls = prisma.appointment.create.mock
      .calls as unknown as AppointmentCreateCall[];
    expect(createCalls[0][0].data.appointmentNumber).toBe('APT-2026-000004');
    expect(prisma.auditLog.create).toHaveBeenCalled();
    expect(notificationMocks.notifyAssigned).toHaveBeenCalledTimes(1);
    const [notificationInput] = notificationMocks.notifyAssigned.mock
      .calls[0] as [
      {
        actor: AuthenticatedUser;
        appointment: { assignedUserId: string | null };
      },
    ];
    expect(notificationInput.actor).toBe(owner);
    expect(notificationInput.appointment.assignedUserId).toBe('tech-1');
  });

  it('rejects new appointments scheduled in the past', async () => {
    const { service } = createService();

    await service
      .create(owner, {
        appointmentType: 'INSPECTION',
        jobId: 'job-1',
        locationSource: 'CUSTOMER_DEFAULT',
        scheduledEnd: '2026-07-13T23:30:00.000Z',
        scheduledStart: '2026-07-13T22:30:00.000Z',
        status: 'SCHEDULED',
      })
      .catch((error) => expectDomainError(error, 'APPOINTMENT_START_IN_PAST'));
  });

  it('repairs stale appointment sequences before creating appointments', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    prisma.appointmentSequence.findUnique.mockResolvedValueOnce({
      businessId: 'business-1',
      nextNumber: 1,
    });
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({ appointmentNumber: 'APT-2026-000010' }),
    );

    await service.create(owner, {
      appointmentType: 'INSPECTION',
      assignedUserId: 'tech-1',
      jobId: 'job-1',
      scheduledEnd: BUSINESS_HOURS_END,
      scheduledStart: BUSINESS_HOURS_START,
    });

    expect(prisma.appointmentSequence.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { nextNumber: 12 },
        where: { businessId: 'business-1' },
      }),
    );
    const createCalls = prisma.appointment.create.mock
      .calls as unknown as AppointmentCreateCall[];
    expect(createCalls[0][0].data.appointmentNumber).toBe('APT-2026-000011');
  });

  it('creates appointments with a customer default address snapshot', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([]);

    await service.create(owner, {
      appointmentType: 'INSPECTION',
      assignedUserId: 'tech-1',
      jobId: 'job-1',
      locationSource: 'CUSTOMER_DEFAULT',
      scheduledEnd: BUSINESS_HOURS_END,
      scheduledStart: BUSINESS_HOURS_START,
    });

    const createCalls = prisma.appointment.create.mock
      .calls as unknown as AppointmentCreateCall[];
    expect(createCalls[0][0].data.addressLine1).toBe('99 Default Road');
    expect(createCalls[0][0].data.locationSource).toBe('CUSTOMER_DEFAULT');
    expect(createCalls[0][0].data.postcode).toBe('2150');
  });

  it('creates a 120-minute Sydney afternoon appointment with correct UTC start and end', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([]);

    await service.create(owner, {
      appointmentType: 'INSPECTION',
      assignedUserId: 'tech-1',
      estimatedDurationMinutes: 120,
      jobId: 'job-1',
      locationSource: 'CUSTOMER_DEFAULT',
      scheduledEnd: '2026-08-13T05:25:00.000Z',
      scheduledStart: '2026-08-13T03:25:00.000Z',
      status: 'SCHEDULED',
    });

    const createCalls = prisma.appointment.create.mock
      .calls as unknown as AppointmentCreateCall[];
    expect(createCalls[0][0].data.estimatedDurationMinutes).toBe(120);
    expect(createCalls[0][0].data.scheduledStart).toEqual(
      new Date('2026-08-13T03:25:00.000Z'),
    );
    expect(createCalls[0][0].data.scheduledEnd).toEqual(
      new Date('2026-08-13T05:25:00.000Z'),
    );
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
      scheduledEnd: BUSINESS_HOURS_END,
      scheduledStart: BUSINESS_HOURS_START,
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

  it('returns a 404 domain error when the selected service site does not belong to the job customer', async () => {
    const { prisma, service } = createService();
    prisma.customerSite.findFirst.mockResolvedValueOnce(null);

    await service
      .create(owner, {
        appointmentType: 'INSPECTION',
        assignedUserId: 'tech-1',
        customerSiteId: 'site-from-another-customer',
        jobId: 'job-1',
        locationSource: 'CUSTOMER_SITE',
        scheduledEnd: BUSINESS_HOURS_END,
        scheduledStart: BUSINESS_HOURS_START,
      })
      .catch((error) => {
        expectDomainError(error, 'CUSTOMER_SITE_NOT_FOUND');
        expect((error as HttpException).getStatus()).toBe(404);
      });
  });

  it('returns a 404 domain error when the selected technician is inactive or outside the tenant', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValueOnce(null);

    await service
      .create(owner, {
        appointmentType: 'INSPECTION',
        assignedUserId: 'inactive-tech',
        jobId: 'job-1',
        scheduledEnd: BUSINESS_HOURS_END,
        scheduledStart: BUSINESS_HOURS_START,
      })
      .catch((error) => {
        expectDomainError(error, 'ASSIGNEE_NOT_FOUND');
        expect((error as HttpException).getStatus()).toBe(404);
      });
  });

  it('does not allow active admins to be assigned as field technicians', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValueOnce(null);

    await service
      .create(owner, {
        appointmentType: 'INSPECTION',
        assignedUserId: 'admin-1',
        jobId: 'job-1',
        scheduledEnd: BUSINESS_HOURS_END,
        scheduledStart: BUSINESS_HOURS_START,
      })
      .catch((error) => {
        expectDomainError(error, 'ASSIGNEE_NOT_FOUND');
        expect((error as HttpException).getStatus()).toBe(404);
      });

    const memberCalls = prisma.businessMember.findFirst.mock
      .calls as unknown as BusinessMemberLookupCall[];
    expect(memberCalls[0][0].where).toEqual(
      expect.objectContaining({
        businessId: 'business-1',
        role: { in: ['TECHNICIAN'] },
        status: 'ACTIVE',
        userId: 'admin-1',
      }),
    );
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
        scheduledEnd: BUSINESS_HOURS_END,
        scheduledStart: BUSINESS_HOURS_START,
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
      scheduledEnd: BUSINESS_HOURS_END,
      scheduledStart: BUSINESS_HOURS_START,
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
      scheduledEnd: BUSINESS_HOURS_END,
      scheduledStart: BUSINESS_HOURS_START,
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
        notifyAssigned: jest.fn(),
        notifyCancelled: jest.fn(),
        notifyNewTechnician: jest.fn(),
        notifyOldTechnician: jest.fn(),
        notifyRescheduled: jest.fn(),
      } as unknown as AppointmentNotificationsService,
      {
        appointmentCancelled: jest.fn(),
        appointmentCompleted: jest.fn(),
        appointmentCreated: jest.fn(),
        appointmentRescheduled: jest.fn(),
      } as never,
    );

    await blockedService.findOne(technician, 'appointment-1').catch((error) => {
      expectDomainError(error, 'APPOINTMENT_NOT_FOUND');
    });
    expect(service).toBeDefined();
  });

  it('records completion transitions', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({
        assignedUserId: owner.id,
        signatures: [
          {
            appointmentId: 'appointment-1',
            businessId: 'business-1',
            capturedAt: new Date('2026-07-15T00:45:00.000Z'),
            capturedByUserId: 'tech-1',
            consentText:
              'I confirm the work described above has been completed.',
            createdAt: new Date('2026-07-15T00:45:00.000Z'),
            customerName: 'Priya Shah',
            id: 'signature-1',
            jobId: 'job-1',
            signatureData: {
              height: 160,
              strokes: [[{ x: 1, y: 1 }]],
              width: 320,
            },
            signerTitle: null,
            skippedAt: null,
            skipReason: null,
            updatedAt: new Date('2026-07-15T00:45:00.000Z'),
          },
        ],
        status: 'IN_PROGRESS',
      }),
    );

    await service.transition(owner, 'appointment-1', 'COMPLETED', {
      followUpRequired: false,
      technicianNotes: 'Checked all outlets.',
      workCompleted: 'Replaced faulty switch and tested circuit.',
    });

    const updateCalls = prisma.appointment.update.mock
      .calls as unknown as Array<
      [{ data: { actualEnd?: Date; status: string } }]
    >;
    expect(updateCalls[0][0].data.status).toBe('COMPLETED');
    expect(updateCalls[0][0].data.actualEnd).toBeInstanceOf(Date);
    expect(prisma.appointmentWorkLog.upsert).toHaveBeenCalled();
  });

  it('keeps same-record reschedules active instead of leaving RESCHEDULED', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    prisma.appointment.update.mockResolvedValue(
      appointment({
        scheduledEnd: new Date(BUSINESS_HOURS_RESCHEDULE_END),
        scheduledStart: new Date(BUSINESS_HOURS_START),
        status: 'SCHEDULED',
      }),
    );

    await service.update(owner, 'appointment-1', {
      appointmentType: 'INSPECTION',
      assignedUserId: 'tech-1',
      jobId: 'job-1',
      scheduledEnd: BUSINESS_HOURS_RESCHEDULE_END,
      scheduledStart: BUSINESS_HOURS_START,
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
      scheduledEnd: BUSINESS_HOURS_END,
      scheduledStart: BUSINESS_HOURS_START,
    });

    expect(recommendation.recommendedTechnicianId).toBe('tech-1');
    const memberCalls = prisma.businessMember.findMany.mock
      .calls as unknown as BusinessMemberLookupCall[];
    expect(memberCalls[0][0].where).toEqual(
      expect.objectContaining({
        role: { in: ['TECHNICIAN'] },
        status: 'ACTIVE',
        user: { isActive: true },
      }),
    );
  });

  it('ranks technician recommendations by lowest same-day workload', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findMany.mockResolvedValueOnce([
      {
        role: 'TECHNICIAN',
        user: { firstName: 'Mia', id: 'tech-1', lastName: 'Technician' },
      },
      {
        role: 'TECHNICIAN',
        user: { firstName: 'Raj', id: 'tech-2', lastName: 'Field' },
      },
    ]);
    prisma.appointment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        appointment({
          assignedUserId: 'tech-1',
          scheduledEnd: new Date('2026-07-15T05:00:00.000Z'),
          scheduledStart: new Date('2026-07-15T03:00:00.000Z'),
        }),
      ]);

    const recommendation = await service.recommend(owner, {
      jobId: 'job-1',
      scheduledEnd: BUSINESS_HOURS_END,
      scheduledStart: BUSINESS_HOURS_START,
    });

    expect(recommendation.recommendedTechnicianId).toBe('tech-2');
    expect(recommendation.reason).toContain('0 scheduled minutes');
  });

  it('blocks overlapping appointments unless an owner overrides', async () => {
    const { service } = createService();

    await service
      .create(owner, {
        appointmentType: 'INSPECTION',
        assignedUserId: 'tech-1',
        jobId: 'job-1',
        scheduledEnd: OVERLAPPING_END,
        scheduledStart: OVERLAPPING_START,
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
      scheduledEnd: OVERLAPPING_END,
      scheduledStart: OVERLAPPING_START,
    });

    expect(prisma.appointment.create).toHaveBeenCalled();
  });

  it('returns availability conflicts for calendar scheduling checks', async () => {
    const { service } = createService();

    const availability = await service.availability(owner, {
      assignedUserId: 'tech-1',
      scheduledEnd: OVERLAPPING_END,
      scheduledStart: OVERLAPPING_START,
    });

    expect(availability.hasConflict).toBe(true);
    expect(availability.canOverride).toBe(true);
    expect(availability.conflicts[0].appointmentNumber).toBe('APT-2026-000001');
  });

  it('checks working hours in the business timezone rather than server timezone', async () => {
    const { service } = createService();

    await expect(
      service.availability(owner, {
        assignedUserId: null,
        scheduledEnd: '2026-07-15T00:00:00.000Z',
        scheduledStart: '2026-07-14T23:00:00.000Z',
      }),
    ).resolves.toMatchObject({
      hasConflict: false,
      reason: 'No technician assigned yet.',
    });

    await expect(
      service.availability(owner, {
        assignedUserId: null,
        scheduledEnd: '2026-07-15T11:00:00.000Z',
        scheduledStart: '2026-07-15T10:00:00.000Z',
      }),
    ).resolves.toMatchObject({
      hasConflict: true,
      reason: 'Appointment is outside business working hours.',
    });
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

  it.each(['COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'] as const)(
    'blocks reassignment for %s appointments',
    async (status) => {
      const { prisma, service } = createService();
      prisma.appointment.findFirst.mockResolvedValueOnce(
        appointment({ status }),
      );

      await service
        .reassign(owner, 'appointment-1', { assignedUserId: 'tech-2' })
        .catch((error) => {
          expectDomainError(error, 'INVALID_STATUS_TRANSITION');
        });
    },
  );

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
    const memberCalls = prisma.businessMember.findMany.mock
      .calls as unknown as BusinessMemberLookupCall[];
    expect(memberCalls[0][0].where).toEqual(
      expect.objectContaining({
        role: { in: ['TECHNICIAN'] },
      }),
    );
  });

  it('loads dispatcher board with technicians, unassigned work and recommendations', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findMany
      .mockResolvedValueOnce([
        {
          role: 'TECHNICIAN',
          user: {
            email: 'mia@example.com',
            firstName: 'Mia',
            id: 'tech-1',
            lastName: 'Technician',
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          role: 'TECHNICIAN',
          user: { firstName: 'Mia', id: 'tech-1', lastName: 'Technician' },
        },
      ]);
    prisma.appointment.findMany
      .mockResolvedValueOnce([
        appointment(),
        appointment({ assignedUser: null, assignedUserId: null }),
      ])
      .mockResolvedValueOnce([]);

    const result = await service.dispatcher(owner, {
      date: '2026-07-15T00:00:00.000Z',
    });

    expect(result.summary.totalAppointmentsToday).toBe(2);
    expect(result.summary.unassignedAppointments).toBe(1);
    expect(result.technicians[0].todaysWorkload).toBe(1);
    expect(result.unassigned[0].recommendation?.technicianId).toBe('tech-1');
    const auditCalls = prisma.auditLog.create.mock.calls as unknown as Array<
      [{ data: { action: string } }]
    >;
    expect(
      auditCalls.some((call) => call[0].data.action === 'DISPATCHER_VIEWED'),
    ).toBe(true);
  });

  it('blocks technicians from the dispatcher management board', async () => {
    const { service } = createService();

    await service
      .dispatcher(technician, {
        date: '2026-07-15T00:00:00.000Z',
      })
      .catch((error) => {
        expectDomainError(error, 'INSUFFICIENT_PERMISSION');
      });
  });

  it('filters dispatcher board by search and high priority', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findMany.mockResolvedValueOnce([
      {
        role: 'TECHNICIAN',
        user: {
          email: 'mia@example.com',
          firstName: 'Mia',
          id: 'tech-1',
          lastName: 'Technician',
        },
      },
    ]);
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        job: {
          ...appointment().job,
          priority: 'HIGH',
          title: 'Emergency switchboard',
        },
      }),
    ]);

    const result = await service.dispatcher(owner, {
      date: '2026-07-15T00:00:00.000Z',
      filter: 'high-priority',
      search: 'switchboard',
    });

    expect(result.technicians).toHaveLength(1);
    expect(result.technicians[0].appointments[0].appointment.job.priority).toBe(
      'HIGH',
    );
  });

  it('loads My Day with only the logged-in user assigned appointments', async () => {
    const { prisma, service } = createService();
    prisma.business.findUnique.mockResolvedValueOnce({
      name: 'Demo Tradie Co',
      timezone: 'Australia/Sydney',
    });
    const completed = appointment({
      assignedUserId: 'tech-1',
      id: 'appointment-2',
      job: {
        ...appointment().job,
        priority: 'URGENT',
        title: 'Emergency repair',
      },
      status: 'COMPLETED',
    });
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({ assignedUserId: 'tech-1' }),
      completed,
    ]);
    prisma.appointment.findMany.mockResolvedValueOnce([completed]);

    const result = await service.myDay(technician);

    expect(result.businessName).toBe('Demo Tradie Co');
    expect(result.technicianUserId).toBe('tech-1');
    expect(result.appointments).toHaveLength(2);
    expect(result.completedCount).toBe(1);
    expect(result.remainingCount).toBe(1);
    const findManyCalls = prisma.appointment.findMany.mock
      .calls as unknown as Array<
      [{ where: { assignedUserId: string; businessId: string } }]
    >;
    expect(findManyCalls[0][0].where.assignedUserId).toBe('tech-1');
    expect(findManyCalls[0][0].where.businessId).toBe('business-1');
  });

  it('does not duplicate the next appointment in Later Today', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T00:15:00.000Z'));
    const { prisma, service } = createService();
    prisma.business.findUnique.mockResolvedValueOnce({
      name: 'Demo Tradie Co',
      timezone: 'Australia/Sydney',
    });
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        id: 'next-appointment',
        scheduledEnd: new Date('2026-07-15T01:00:00.000Z'),
        scheduledStart: new Date('2026-07-15T00:30:00.000Z'),
        status: 'CONFIRMED',
      }),
      appointment({
        id: 'later-appointment',
        scheduledEnd: new Date('2026-07-15T03:00:00.000Z'),
        scheduledStart: new Date('2026-07-15T02:00:00.000Z'),
        status: 'SCHEDULED',
      }),
    ]);
    prisma.appointment.findMany.mockResolvedValueOnce([]);

    const result = await service.myDay(technician);

    expect(result.nextAppointment?.id).toBe('next-appointment');
    expect(result.laterToday.map((item) => item.id)).toEqual([
      'later-appointment',
    ]);
    expect(result.appointments).toHaveLength(2);
    jest.useRealTimers();
  });

  it('does not show expired unstarted appointments as the next My Day appointment', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T03:15:00.000Z'));
    const { prisma, service } = createService();
    prisma.business.findUnique.mockResolvedValueOnce({
      name: 'Demo Tradie Co',
      timezone: 'Australia/Sydney',
    });
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        id: 'expired-confirmed',
        scheduledEnd: new Date('2026-07-15T01:00:00.000Z'),
        scheduledStart: new Date('2026-07-15T00:30:00.000Z'),
        status: 'CONFIRMED',
      }),
    ]);
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    prisma.appointment.findFirst.mockResolvedValueOnce(null);

    const result = await service.myDay(technician);

    expect(result.appointments.map((item) => item.id)).toContain(
      'expired-confirmed',
    );
    expect(result.nextAppointment).toBeNull();
    expect(result.remainingCount).toBe(0);
    expect(result.laterToday).toEqual([]);
  });

  it('shows a today appointment as the next My Day appointment before checking future work', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T00:15:00.000Z'));
    const { prisma, service } = createService();
    prisma.business.findUnique.mockResolvedValueOnce({
      name: 'Demo Tradie Co',
      timezone: 'Australia/Sydney',
    });
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        id: 'today-confirmed',
        scheduledEnd: new Date('2026-09-01T01:00:00.000Z'),
        scheduledStart: new Date('2026-09-01T00:30:00.000Z'),
        status: 'CONFIRMED',
      }),
    ]);
    prisma.appointment.findMany.mockResolvedValueOnce([]);

    const result = await service.myDay(technician);

    expect(result.nextAppointment?.id).toBe('today-confirmed');
    expect(prisma.appointment.findFirst).not.toHaveBeenCalled();
  });

  it('shows the nearest future assigned appointment when today has no remaining work', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T00:15:00.000Z'));
    const { prisma, service } = createService();
    prisma.business.findUnique.mockResolvedValueOnce({
      name: 'Demo Tradie Co',
      timezone: 'Australia/Sydney',
    });
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({
        id: 'future-confirmed',
        scheduledEnd: new Date('2026-09-03T01:00:00.000Z'),
        scheduledStart: new Date('2026-09-02T23:00:00.000Z'),
        status: 'CONFIRMED',
      }),
    );

    const result = await service.myDay(technician);

    expect(result.nextAppointment?.id).toBe('future-confirmed');
    expect(result.remainingCount).toBe(0);
    expect(result.laterToday).toEqual([]);
  });

  it('orders future My Day fallback appointments by earliest scheduled time', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T00:15:00.000Z'));
    const { prisma, service } = createService();
    prisma.business.findUnique.mockResolvedValueOnce({
      name: 'Demo Tradie Co',
      timezone: 'Australia/Sydney',
    });
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({ id: 'earliest-future', status: 'SCHEDULED' }),
    );

    const result = await service.myDay(technician);

    expect(result.nextAppointment?.id).toBe('earliest-future');
    expect(prisma.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ scheduledStart: 'asc' }, { createdAt: 'asc' }],
      }),
    );
  });

  it('ignores cancelled future appointments in the My Day fallback', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T00:15:00.000Z'));
    const { prisma, service } = createService();
    prisma.business.findUnique.mockResolvedValueOnce({
      name: 'Demo Tradie Co',
      timezone: 'Australia/Sydney',
    });
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({ id: 'cancelled-future', status: 'CANCELLED' }),
    );

    const result = await service.myDay(technician);

    expect(result.nextAppointment).toBeNull();
  });

  it("ignores another technician's future appointment in the My Day fallback", async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T00:15:00.000Z'));
    const { prisma, service } = createService();
    prisma.business.findUnique.mockResolvedValueOnce({
      name: 'Demo Tradie Co',
      timezone: 'Australia/Sydney',
    });
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({
        assignedUserId: 'other-tech',
        id: 'other-tech-future',
        status: 'CONFIRMED',
      }),
    );

    const result = await service.myDay(technician);

    expect(result.nextAppointment).toBeNull();
  });

  it('keeps My Day empty when there are no future appointments', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T00:15:00.000Z'));
    const { prisma, service } = createService();
    prisma.business.findUnique.mockResolvedValueOnce({
      name: 'Demo Tradie Co',
      timezone: 'Australia/Sydney',
    });
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    prisma.appointment.findFirst.mockResolvedValueOnce(null);

    const result = await service.myDay(technician);

    expect(result.nextAppointment).toBeNull();
    expect(result.remainingCount).toBe(0);
    expect(result.completedCount).toBe(0);
    expect(result.urgentCount).toBe(0);
  });

  it('prioritises an in-progress appointment as the current appointment', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T00:15:00.000Z'));
    const { prisma, service } = createService();
    prisma.business.findUnique.mockResolvedValueOnce({
      name: 'Demo Tradie Co',
      timezone: 'Australia/Sydney',
    });
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        id: 'upcoming',
        scheduledEnd: new Date('2026-07-15T02:00:00.000Z'),
        scheduledStart: new Date('2026-07-15T01:00:00.000Z'),
        status: 'CONFIRMED',
      }),
      appointment({
        id: 'current-work',
        scheduledEnd: new Date('2026-07-15T01:30:00.000Z'),
        scheduledStart: new Date('2026-07-15T00:00:00.000Z'),
        status: 'IN_PROGRESS',
      }),
    ]);

    const result = await service.myDay(technician);

    expect(result.nextAppointment?.id).toBe('current-work');
    expect(result.laterToday.map((item) => item.id)).toEqual(['upcoming']);
    jest.useRealTimers();
  });

  it('calculates My Day counts from active assigned appointments only', async () => {
    const { prisma, service } = createService();
    prisma.business.findUnique.mockResolvedValueOnce({
      name: 'Demo Tradie Co',
      timezone: 'Australia/Sydney',
    });
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        id: 'scheduled-urgent',
        job: { ...appointment().job, priority: 'URGENT' },
        status: 'SCHEDULED',
      }),
      appointment({
        id: 'high-is-not-urgent',
        job: { ...appointment().job, priority: 'HIGH' },
        status: 'CONFIRMED',
      }),
      appointment({ id: 'completed', status: 'COMPLETED' }),
      appointment({ id: 'cancelled', status: 'CANCELLED' }),
      appointment({ id: 'no-show', status: 'NO_SHOW' }),
      appointment({ id: 'rescheduled', status: 'RESCHEDULED' }),
    ]);
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({ id: 'completed', status: 'COMPLETED' }),
    ]);

    const result = await service.myDay(technician);

    expect(result.completedCount).toBe(1);
    expect(result.remainingCount).toBe(2);
    expect(result.urgentCount).toBe(1);
    expect(result.completedToday.map((item) => item.id)).toEqual(['completed']);
    expect(result.laterToday.map((item) => item.id)).not.toEqual(
      expect.arrayContaining(['cancelled', 'no-show', 'rescheduled']),
    );
  });

  it('counts appointments completed today by completion time rather than scheduled date', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T02:00:00.000Z'));
    const { prisma, service } = createService();
    prisma.business.findUnique.mockResolvedValueOnce({
      name: 'Demo Tradie Co',
      timezone: 'Australia/Sydney',
    });
    const futureScheduledCompletedToday = appointment({
      completedAt: new Date('2026-09-01T01:30:00.000Z'),
      id: 'future-scheduled-completed-today',
      scheduledEnd: new Date('2026-09-03T01:00:00.000Z'),
      scheduledStart: new Date('2026-09-02T23:00:00.000Z'),
      status: 'COMPLETED',
    });
    prisma.appointment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([futureScheduledCompletedToday]);
    prisma.appointment.findFirst.mockResolvedValueOnce(null);

    const result = await service.myDay(technician);

    expect(result.completedCount).toBe(1);
    expect(result.completedToday.map((item) => item.id)).toEqual([
      'future-scheduled-completed-today',
    ]);
    expect(result.nextAppointment).toBeNull();
    expect(result.appointments.map((item) => item.id)).toEqual([
      'future-scheduled-completed-today',
    ]);
  });

  it('does not count appointments completed outside the business day', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T02:00:00.000Z'));
    const { prisma, service } = createService();
    prisma.business.findUnique.mockResolvedValueOnce({
      name: 'Demo Tradie Co',
      timezone: 'Australia/Sydney',
    });
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    prisma.appointment.findFirst.mockResolvedValueOnce(null);

    const result = await service.myDay(technician);

    expect(result.completedCount).toBe(0);
    const findManyCalls = prisma.appointment.findMany.mock.calls as Array<
      [{ where: { completedAt?: { gte: Date; lt: Date } } }]
    >;
    const completedQuery = findManyCalls[1][0] as {
      where: { completedAt: { gte: Date; lt: Date } };
    };
    expect(completedQuery.where.completedAt.gte).toBeInstanceOf(Date);
    expect(completedQuery.where.completedAt.lt).toBeInstanceOf(Date);
  });

  it('rejects invalid technician workflow transitions', async () => {
    const { service } = createService();

    await service
      .transition(technician, 'appointment-1', 'COMPLETED', {
        workCompleted: 'Done',
      })
      .catch((error) => {
        expectDomainError(error, 'INVALID_STATUS_TRANSITION');
      });
  });

  it.each<BusinessRole>(['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER'])(
    'allows %s to confirm a scheduled appointment',
    async (role) => {
      const { prisma, service } = createService();
      prisma.appointment.findFirst.mockResolvedValueOnce(
        appointment({ status: 'SCHEDULED' }),
      );
      prisma.appointment.update.mockImplementationOnce(
        ({ data }: { data: { status: string } }) =>
          Promise.resolve(appointment({ status: data.status })),
      );

      const result = await service.transition(
        userForRole(role),
        'appointment-1',
        'CONFIRMED',
      );

      expect(result.appointment.status).toBe('CONFIRMED');
      const updateCalls = prisma.appointment.update.mock
        .calls as unknown as Array<[{ data: Record<string, unknown> }]>;
      expect(updateCalls[0][0].data).toMatchObject({
        status: 'CONFIRMED',
        updatedBy: userForRole(role).id,
      });
    },
  );

  it('writes appointment audit and job timeline events when confirmed', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({ status: 'SCHEDULED' }),
    );
    prisma.appointment.update.mockImplementationOnce(
      ({ data }: { data: { status: string } }) =>
        Promise.resolve(appointment({ status: data.status })),
    );

    await service.transition(owner, 'appointment-1', 'CONFIRMED');

    const auditCalls = prisma.auditLog.create.mock.calls as unknown as Array<
      [{ data: { action: string; metadata: Record<string, unknown> } }]
    >;
    const auditActions = auditCalls.map((call) => call[0].data.action);
    expect(auditActions).toContain('APPOINTMENT_CONFIRMED');
    expect(auditActions).toContain('JOB_TIMELINE_APPOINTMENT_CONFIRMED');
    expect(
      auditCalls.find(
        (call) => call[0].data.action === 'APPOINTMENT_CONFIRMED',
      )?.[0].data.metadata,
    ).toMatchObject({ from: 'SCHEDULED', to: 'CONFIRMED' });
  });

  it('rejects confirming an appointment after its scheduled end time', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T02:00:00.000Z'));
    const { prisma, service } = createService();
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({ status: 'SCHEDULED' }),
    );

    await service
      .transition(owner, 'appointment-1', 'CONFIRMED')
      .catch((error) =>
        expectDomainError(error, 'APPOINTMENT_CONFIRMATION_WINDOW_EXPIRED'),
      );

    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it.each<BusinessRole>(['TECHNICIAN', 'READ_ONLY', 'ACCOUNTANT', 'SALES'])(
    'blocks %s from confirming appointments',
    async (role) => {
      const { prisma, service } = createService();
      prisma.appointment.findFirst.mockResolvedValueOnce(
        appointment({ status: 'SCHEDULED' }),
      );

      await service
        .transition(userForRole(role), 'appointment-1', 'CONFIRMED')
        .catch((error) => {
          expectDomainError(error, 'INSUFFICIENT_PERMISSION');
        });
    },
  );

  it('blocks cross-tenant confirmation by scoping lookup to businessId', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findFirst.mockResolvedValueOnce(null);

    await service
      .transition(
        {
          ...owner,
          businessId: 'business-2',
          id: 'other-owner',
        },
        'appointment-1',
        'CONFIRMED',
      )
      .catch((error) => {
        expectDomainError(error, 'APPOINTMENT_NOT_FOUND');
      });

    const findFirstCalls = prisma.appointment.findFirst.mock
      .calls as unknown as Array<
      [{ where: { businessId: string; id: string } }]
    >;
    expect(findFirstCalls[0][0].where).toMatchObject({
      businessId: 'business-2',
      id: 'appointment-1',
    });
  });

  it.each(['CANCELLED', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED'] as const)(
    'rejects confirmation from %s appointments',
    async (status) => {
      const { prisma, service } = createService();
      prisma.appointment.findFirst.mockResolvedValueOnce(
        appointment({ status }),
      );

      await service
        .transition(owner, 'appointment-1', 'CONFIRMED')
        .catch((error) => {
          expectDomainError(
            error,
            status === 'COMPLETED'
              ? 'APPOINTMENT_ALREADY_COMPLETED'
              : 'INVALID_STATUS_TRANSITION',
          );
        });
    },
  );

  it('does not create duplicate audit events when confirmation is requested again', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({ status: 'CONFIRMED' }),
    );

    const result = await service.transition(
      owner,
      'appointment-1',
      'CONFIRMED',
    );

    expect(result.appointment.status).toBe('CONFIRMED');
    expect(prisma.appointment.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('persists scheduled to cancelled transitions and returns the updated appointment', async () => {
    const { communications, notificationMocks, prisma, service } =
      createService();
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({ status: 'SCHEDULED' }),
    );
    prisma.appointment.update.mockImplementationOnce(
      ({ data }: { data: { status: string } }) =>
        Promise.resolve(appointment({ status: data.status })),
    );

    const result = await service.transition(
      owner,
      'appointment-1',
      'CANCELLED',
    );

    expect(result.appointment.status).toBe('CANCELLED');
    const updateCalls = prisma.appointment.update.mock
      .calls as unknown as Array<[{ data: Record<string, unknown> }]>;
    expect(updateCalls[0][0].data).toMatchObject({
      status: 'CANCELLED',
      updatedBy: owner.id,
    });
    expect(communications.appointmentCancelled).toHaveBeenCalledTimes(1);
    expect(notificationMocks.notifyCancelled).toHaveBeenCalledTimes(1);
    const [notificationInput] = notificationMocks.notifyCancelled.mock
      .calls[0] as [
      { actor: AuthenticatedUser; appointment: { status: string } },
    ];
    expect(notificationInput.actor).toBe(owner);
    expect(notificationInput.appointment.status).toBe('CANCELLED');
  });

  it('reschedules to an explicit date/time and persists the selected duration', async () => {
    const { communications, notificationMocks, prisma, service } =
      createService();
    const existing = appointment({
      scheduledEnd: new Date('2026-08-16T23:00:00.000Z'),
      scheduledStart: new Date('2026-08-16T21:00:00.000Z'),
      status: 'SCHEDULED',
    });
    prisma.appointment.findFirst.mockResolvedValueOnce(existing);
    prisma.appointment.count.mockResolvedValueOnce(0);
    prisma.appointment.findMany.mockResolvedValueOnce([]);
    prisma.appointment.update.mockImplementationOnce(
      ({
        data,
      }: {
        data: {
          estimatedDurationMinutes: number;
          scheduledEnd: Date;
          scheduledStart: Date;
        };
      }) =>
        Promise.resolve(
          appointment({
            estimatedDurationMinutes: data.estimatedDurationMinutes,
            scheduledEnd: data.scheduledEnd,
            scheduledStart: data.scheduledStart,
            status: 'SCHEDULED',
          }),
        ),
    );

    const result = await service.update(owner, 'appointment-1', {
      accessInstructions: 'Use side gate',
      addressLine1: '12 King Street',
      appointmentType: 'INSPECTION',
      assignedUserId: 'tech-1',
      estimatedDurationMinutes: 60,
      jobId: 'job-1',
      locationSource: 'CUSTOMER_DEFAULT',
      postcode: '2150',
      scheduledEnd: '2026-08-17T23:00:00.000Z',
      scheduledStart: '2026-08-17T22:00:00.000Z',
      state: 'NSW',
      status: 'SCHEDULED',
      suburb: 'Parramatta',
    });

    expect(result.appointment.scheduledStart).toBe('2026-08-17T22:00:00.000Z');
    expect(result.appointment.scheduledEnd).toBe('2026-08-17T23:00:00.000Z');
    expect(result.appointment.estimatedDurationMinutes).toBe(60);
    expect(communications.appointmentRescheduled).toHaveBeenCalledTimes(1);
    expect(notificationMocks.notifyRescheduled).toHaveBeenCalledTimes(1);
    const [notificationInput] = notificationMocks.notifyRescheduled.mock
      .calls[0] as [
      { actor: AuthenticatedUser; appointment: { scheduledStart: string } },
    ];
    expect(notificationInput.actor).toBe(owner);
    expect(notificationInput.appointment.scheduledStart).toBe(
      '2026-08-17T22:00:00.000Z',
    );
  });

  it('allows an assigned technician to start travel only after confirmation', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({ assignedUserId: 'tech-1', status: 'CONFIRMED' }),
    );
    prisma.appointment.update.mockImplementationOnce(
      ({ data }: { data: { status: string } }) =>
        Promise.resolve(appointment({ status: data.status })),
    );

    const result = await service.transition(
      technician,
      'appointment-1',
      'ON_THE_WAY',
    );

    expect(result.appointment.status).toBe('ON_THE_WAY');
  });

  it('rejects starting travel after the execution grace window expires', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T02:30:01.000Z'));
    const { prisma, service } = createService();
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({ assignedUserId: 'tech-1', status: 'CONFIRMED' }),
    );

    await service
      .transition(technician, 'appointment-1', 'ON_THE_WAY')
      .catch((error) =>
        expectDomainError(error, 'APPOINTMENT_EXECUTION_WINDOW_EXPIRED'),
      );

    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it('blocks non-assigned owners from technician execution transitions', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({ assignedUserId: 'tech-1', status: 'CONFIRMED' }),
    );

    await service
      .transition(owner, 'appointment-1', 'ON_THE_WAY')
      .catch((error) => {
        expectDomainError(error, 'INVALID_STATUS_TRANSITION');
      });
  });

  it('rejects starting travel directly from a scheduled appointment', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({ assignedUserId: 'tech-1', status: 'SCHEDULED' }),
    );

    await service
      .transition(technician, 'appointment-1', 'ON_THE_WAY')
      .catch((error) => {
        expectDomainError(error, 'INVALID_STATUS_TRANSITION');
      });
  });

  it('requires work completed before completing an in-progress appointment', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({ status: 'IN_PROGRESS' }),
    );

    await service
      .transition(technician, 'appointment-1', 'COMPLETED', {
        workCompleted: '  ',
      })
      .catch((error) => {
        expectDomainError(error, 'WORK_COMPLETED_REQUIRED');
      });
  });

  it('requires follow-up notes before completing when follow-up is required', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({ status: 'IN_PROGRESS' }),
    );

    await service
      .transition(technician, 'appointment-1', 'COMPLETED', {
        followUpNotes: '   ',
        followUpRequired: true,
        workCompleted: 'Replaced faulty switch and tested circuit.',
      })
      .catch((error) => {
        expectDomainError(error, 'FOLLOW_UP_NOTES_REQUIRED');
      });
  });

  it('requires a signature before completing an in-progress appointment', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({ status: 'IN_PROGRESS' }),
    );

    await service
      .transition(technician, 'appointment-1', 'COMPLETED', {
        workCompleted: 'Replaced faulty switch and tested circuit.',
      })
      .catch((error) => {
        expectDomainError(error, 'SIGNATURE_REQUIRED');
      });
  });

  it('records pause and resume transitions with duration totals', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T00:30:00.000Z'));
    const { prisma, service } = createService();
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({
        currentWorkStartedAt: new Date('2026-07-15T00:00:00.000Z'),
        status: 'IN_PROGRESS',
        totalWorkMinutes: 10,
        workStartedAt: new Date('2026-07-15T00:00:00.000Z'),
      }),
    );

    await service.transition(technician, 'appointment-1', 'PAUSED');

    const updateCalls = prisma.appointment.update.mock
      .calls as unknown as Array<[{ data: Record<string, unknown> }]>;
    expect(updateCalls[0][0].data.status).toBe('PAUSED');
    expect(updateCalls[0][0].data.totalWorkMinutes).toBe(40);
    expect(updateCalls[0][0].data.pausedAt).toBeInstanceOf(Date);

    jest.setSystemTime(new Date('2026-07-15T00:45:00.000Z'));
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({
        pausedAt: new Date('2026-07-15T00:30:00.000Z'),
        status: 'PAUSED',
        totalPausedMinutes: 5,
        totalWorkMinutes: 40,
        workStartedAt: new Date('2026-07-15T00:00:00.000Z'),
      }),
    );
    prisma.appointment.update.mockClear();

    await service.transition(technician, 'appointment-1', 'IN_PROGRESS');

    const resumeUpdateCalls = prisma.appointment.update.mock
      .calls as unknown as Array<[{ data: Record<string, unknown> }]>;
    const resumeUpdateCall = resumeUpdateCalls[0]?.[0];
    expect(resumeUpdateCall?.data.status).toBe('IN_PROGRESS');
    expect(resumeUpdateCall?.data.totalPausedMinutes).toBe(20);
    expect(resumeUpdateCall?.data.currentWorkStartedAt).toBeInstanceOf(Date);
  });

  it('captures a tenant-scoped customer signature', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({ status: 'IN_PROGRESS' }),
    );

    await service.captureSignature(technician, 'appointment-1', {
      customerName: 'Priya Shah',
      signatureData: {
        height: 160,
        strokes: [[{ x: 8, y: 12 }]],
        width: 320,
      },
    });

    const signatureCalls = prisma.appointmentSignature.upsert.mock
      .calls as unknown as Array<[{ create: Record<string, unknown> }]>;
    expect(signatureCalls[0][0].create).toMatchObject({
      appointmentId: 'appointment-1',
      businessId: 'business-1',
      customerName: 'Priya Shah',
      jobId: 'job-1',
    });
  });

  it('allows owners to skip signature only with a reason', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findFirst.mockResolvedValueOnce(
      appointment({ status: 'IN_PROGRESS' }),
    );

    await service.skipSignature(owner, 'appointment-1', {
      reason: 'Customer was unavailable for sign-off.',
    });

    const signatureCalls = prisma.appointmentSignature.upsert.mock
      .calls as unknown as Array<[{ create: Record<string, unknown> }]>;
    expect(signatureCalls[0][0].create).toMatchObject({
      skipReason: 'Customer was unavailable for sign-off.',
    });
  });

  it('saves work logs and writes follow-up audit events', async () => {
    const { prisma, service } = createService();

    await service.updateWorkLog(technician, 'appointment-1', {
      followUpNotes: 'Return with a replacement breaker.',
      followUpRequired: true,
      technicianNotes: 'Breaker is intermittent.',
      workCompleted: 'Made site safe.',
    });

    const upsertCalls = prisma.appointmentWorkLog.upsert.mock
      .calls as unknown as Array<
      [
        {
          create: {
            businessId: string;
            followUpRequired: boolean;
            technicianUserId: string;
          };
        },
      ]
    >;
    expect(upsertCalls[0][0].create.businessId).toBe('business-1');
    expect(upsertCalls[0][0].create.followUpRequired).toBe(true);
    expect(upsertCalls[0][0].create.technicianUserId).toBe('tech-1');
    const auditCalls = prisma.auditLog.create.mock.calls as unknown as Array<
      [{ data: { action: string } }]
    >;
    const auditActions = auditCalls.map((call) => call[0].data.action);
    expect(auditActions).toContain('APPOINTMENT_WORK_LOG_UPDATED');
    expect(auditActions).toContain('FOLLOW_UP_REQUIRED');
  });

  it('rejects missing follow-up notes when saving a required follow-up work log', async () => {
    const { prisma, service } = createService();

    await service
      .updateWorkLog(technician, 'appointment-1', {
        followUpNotes: '  ',
        followUpRequired: true,
        technicianNotes: 'Breaker is intermittent.',
        workCompleted: 'Made site safe.',
      })
      .catch((error) => {
        expectDomainError(error, 'FOLLOW_UP_NOTES_REQUIRED');
      });

    expect(prisma.appointmentWorkLog.upsert).not.toHaveBeenCalled();
  });

  it.each<BusinessRole>([
    'OWNER',
    'ADMIN',
    'OFFICE_MANAGER',
    'SCHEDULER',
    'TECHNICIAN',
    'ACCOUNTANT',
    'SALES',
    'READ_ONLY',
  ])(
    'allows %s to GET /appointments according to appointment view rules',
    async (role) => {
      const { service } = createService();

      const result = await service.findAll(userForRole(role), {
        page: 1,
        pageSize: 20,
      });

      expect(Array.isArray(result.records)).toBe(true);
    },
  );

  it.each<BusinessRole>(['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER'])(
    'allows %s to POST /appointments according to appointment write rules',
    async (role) => {
      const { prisma, service } = createService();
      prisma.appointment.findMany.mockResolvedValueOnce([]);

      await expect(
        service.create(userForRole(role), {
          appointmentType: 'INSPECTION',
          assignedUserId: 'tech-1',
          jobId: 'job-1',
          scheduledEnd: BUSINESS_HOURS_END,
          scheduledStart: BUSINESS_HOURS_START,
        }),
      ).resolves.toMatchObject({ appointment: { id: 'appointment-1' } });
    },
  );

  it.each<BusinessRole>(['TECHNICIAN', 'ACCOUNTANT', 'SALES', 'READ_ONLY'])(
    'blocks %s from POST /appointments with 403 domain error',
    async (role) => {
      const { service } = createService();

      await service
        .create(userForRole(role), {
          appointmentType: 'INSPECTION',
          assignedUserId: 'tech-1',
          jobId: 'job-1',
          scheduledEnd: BUSINESS_HOURS_END,
          scheduledStart: BUSINESS_HOURS_START,
        })
        .catch((error) => {
          expectDomainError(error, 'INSUFFICIENT_PERMISSION');
        });
    },
  );

  it.each<BusinessRole>(['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER'])(
    'allows %s to GET /appointments/dispatcher for scheduling management',
    async (role) => {
      const { service } = createService();

      const result = await service.dispatcher(userForRole(role), {
        date: '2026-07-15T00:00:00.000Z',
      });

      expect(result.summary.totalAppointmentsToday).toBeGreaterThanOrEqual(0);
    },
  );

  it.each<BusinessRole>(['TECHNICIAN', 'ACCOUNTANT', 'SALES', 'READ_ONLY'])(
    'blocks %s from GET /appointments/dispatcher with 403 domain error',
    async (role) => {
      const { service } = createService();

      await service
        .dispatcher(userForRole(role), {
          date: '2026-07-15T00:00:00.000Z',
        })
        .catch((error) => {
          expectDomainError(error, 'INSUFFICIENT_PERMISSION');
        });
    },
  );
});
