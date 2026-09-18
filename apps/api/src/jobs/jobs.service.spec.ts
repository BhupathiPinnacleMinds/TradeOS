import { HttpException } from '@nestjs/common';
import type { AuthenticatedUser, BusinessRole } from '@tradieos/shared';
import type { UpsertJobDto } from './dto/jobs.dto';
import { JobsService } from './jobs.service';

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

const accountant: AuthenticatedUser = {
  businessId: 'business-1',
  email: 'accounts@example.com',
  id: 'accounts-1',
  role: 'ACCOUNTANT',
};

function userForRole(role: BusinessRole): AuthenticatedUser {
  return {
    businessId: 'business-1',
    email: `${role.toLowerCase()}@example.com`,
    id: role === 'TECHNICIAN' ? 'tech-1' : `${role.toLowerCase()}-1`,
    role,
  };
}

type MockPrisma = {
  appointment: { findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  auditLog: { create: jest.Mock; findMany: jest.Mock };
  business: { findUnique: jest.Mock };
  customer: { create: jest.Mock; findFirst: jest.Mock };
  job: {
    count: jest.Mock;
    create: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
  jobSequence: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  invoice: { findMany: jest.Mock };
  quote: { findFirst: jest.Mock; findMany: jest.Mock };
  user: { findFirst: jest.Mock };
  $transaction: jest.Mock;
};

type JobUpdateCall = {
  data: {
    completedAt?: Date;
    status?: string;
  };
};

type AuditCreateCall = {
  data: {
    action?: string;
  };
};

type CustomerCreateCall = {
  data: {
    email?: string | null;
    emailNormalised?: string | null;
  };
};

function job(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'job-1',
    businessId: 'business-1',
    customerId: 'customer-1',
    assignedToUserId: 'tech-1',
    jobNumber: 'JOB-2026-000001',
    title: 'Replace power point',
    description: null,
    tradeType: 'Electrical',
    status: 'SCHEDULED',
    priority: 'NORMAL',
    scheduledStart: new Date('2026-07-14T09:00:00.000Z'),
    scheduledEnd: new Date('2026-07-14T11:00:00.000Z'),
    estimatedDurationMinutes: 120,
    actualStart: null,
    actualEnd: null,
    completedAt: null,
    addressLine1: '12 King Street',
    addressLine2: null,
    suburb: 'Parramatta',
    state: 'NSW',
    postcode: '2150',
    accessInstructions: null,
    customerNotes: null,
    internalNotes: null,
    requiresQuote: false,
    requiresInvoice: true,
    invoiceCreated: false,
    quoteCreated: false,
    sourceQuoteId: null,
    isArchived: false,
    archivedAt: null,
    createdBy: 'owner-1',
    updatedBy: null,
    createdAt: new Date('2026-07-14T00:00:00.000Z'),
    updatedAt: new Date('2026-07-14T00:00:00.000Z'),
    assignedTo: {
      id: 'tech-1',
      firstName: 'Tess',
      lastName: 'Tech',
      email: 'tech@example.com',
    },
    customer: {
      id: 'customer-1',
      displayName: 'Priya Sharma',
      companyName: null,
      email: 'priya@example.test',
      phone: '0400 111 222',
    },
    ...overrides,
  };
}

function appointment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    accessInstructions: null,
    actualEnd: new Date('2026-07-14T10:45:00.000Z'),
    actualStart: new Date('2026-07-14T09:10:00.000Z'),
    addressLine1: '12 King Street',
    addressLine2: null,
    appointmentNumber: 'APT-2026-000001',
    appointmentType: 'MAINTENANCE',
    arrivedAt: new Date('2026-07-14T09:00:00.000Z'),
    assignedUser: {
      email: 'tech@example.com',
      firstName: 'Tess',
      id: 'tech-1',
      lastName: 'Tech',
    },
    assignedUserId: 'tech-1',
    businessId: 'business-1',
    completedAt: new Date('2026-07-14T10:45:00.000Z'),
    createdAt: new Date('2026-07-14T00:00:00.000Z'),
    createdBy: 'owner-1',
    currentWorkStartedAt: null,
    customerSiteId: null,
    estimatedDurationMinutes: 120,
    id: 'appointment-1',
    job: {
      addressLine1: '12 King Street',
      addressLine2: null,
      customer: {
        companyName: null,
        displayName: 'Priya Sharma',
        email: 'priya@example.test',
        id: 'customer-1',
        phone: '0400 111 222',
      },
      id: 'job-1',
      jobNumber: 'JOB-2026-000001',
      postcode: '2150',
      priority: 'NORMAL',
      status: 'SCHEDULED',
      state: 'NSW',
      suburb: 'Parramatta',
      title: 'Replace power point',
    },
    jobId: 'job-1',
    locationSource: 'CUSTOMER_DEFAULT',
    notes: null,
    pausedAt: null,
    postcode: '2150',
    scheduledEnd: new Date('2026-07-14T11:00:00.000Z'),
    scheduledStart: new Date('2026-07-14T09:00:00.000Z'),
    signatures: [],
    state: 'NSW',
    status: 'COMPLETED',
    suburb: 'Parramatta',
    totalPausedMinutes: 0,
    totalTravelMinutes: 15,
    totalWorkMinutes: 95,
    travelDistanceKm: null,
    travelDurationMinutes: null,
    travelStartedAt: new Date('2026-07-14T08:45:00.000Z'),
    updatedAt: new Date('2026-07-14T10:45:00.000Z'),
    updatedBy: 'tech-1',
    workLogs: [],
    workStartedAt: new Date('2026-07-14T09:10:00.000Z'),
    ...overrides,
  };
}

function audit(
  action: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    action,
    actorUserId: 'tech-1',
    businessId: 'business-1',
    createdAt: new Date('2026-07-14T10:45:00.000Z'),
    entityId: 'appointment-1',
    entityType: 'Appointment',
    id: `${action.toLowerCase()}-1`,
    metadata: null,
    updatedAt: new Date('2026-07-14T10:45:00.000Z'),
    ...overrides,
  };
}

function payload(overrides: Partial<UpsertJobDto> = {}): UpsertJobDto {
  return {
    customerId: 'customer-1',
    assignedToUserId: 'tech-1',
    title: 'Replace power point',
    status: 'SCHEDULED' as const,
    priority: 'NORMAL' as const,
    scheduledStart: '2026-07-14T09:00:00.000Z',
    scheduledEnd: '2026-07-14T11:00:00.000Z',
    addressLine1: '12 King Street',
    suburb: 'Parramatta',
    state: 'NSW' as const,
    postcode: '2150',
    ...overrides,
  };
}

function createService() {
  const communications = { appointmentCancelled: jest.fn() };
  const notifications = { create: jest.fn() };
  const prisma: MockPrisma = {
    appointment: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(appointment()),
    },
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    business: {
      findUnique: jest.fn().mockResolvedValue({ timezone: 'Australia/Sydney' }),
    },
    customer: {
      create: jest.fn().mockResolvedValue({ id: 'quick-customer-1' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'customer-1' }),
    },
    job: {
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn().mockResolvedValue(job()),
      findFirst: jest.fn().mockResolvedValue(job()),
      findMany: jest.fn().mockResolvedValue([job()]),
      update: jest.fn().mockResolvedValue(job()),
    },
    jobSequence: {
      create: jest.fn(),
      findUnique: jest
        .fn()
        .mockResolvedValue({ businessId: 'business-1', nextNumber: 7 }),
      update: jest.fn(),
    },
    invoice: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    quote: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: 'tech-1' }),
    },
    $transaction: jest.fn(
      (input: Array<Promise<unknown>> | ((tx: MockPrisma) => unknown)) => {
        if (typeof input === 'function') return Promise.resolve(input(prisma));
        return Promise.all(input);
      },
    ),
  };

  return {
    prisma,
    communications,
    notifications,
    service: new JobsService(
      prisma as never,
      communications as never,
      notifications as never,
    ),
  };
}

describe('JobsService', () => {
  let consoleInfoSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    jest.clearAllMocks();
  });

  function expectDomainError(error: unknown, code: string) {
    expect(error).toBeInstanceOf(HttpException);
    const response = (error as HttpException).getResponse() as { code: string };
    expect(response.code).toBe(code);
  }

  it('lists jobs scoped to the current business', async () => {
    const { prisma, service } = createService();

    const result = await service.findAll(owner, { page: 1, pageSize: 20 });

    expect(result.records).toHaveLength(1);
    const [[findManyArg]] = prisma.job.findMany.mock.calls as [
      [{ where: { businessId: string; isArchived: boolean } }],
    ];
    expect(findManyArg.where).toMatchObject({
      businessId: 'business-1',
      isArchived: false,
    });
  });

  it('shows completed jobs with one completing technician', async () => {
    const { prisma, service } = createService();
    prisma.job.findMany.mockResolvedValueOnce([
      job({ assignedTo: null, assignedToUserId: null, status: 'COMPLETED' }),
    ]);
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        assignedUser: {
          email: 'ram@example.com',
          firstName: 'Ram',
          id: 'tech-1',
          lastName: 'G',
        },
        assignedUserId: 'tech-1',
      }),
    ]);

    const result = await service.findAll(owner, { filter: 'completed' });

    expect(result.records[0]?.technicianDisplayLabel).toBe(
      'Completed by Ram G',
    );
    expect(result.records[0]?.hasActionableAppointment).toBe(false);
  });

  it('collapses several completed appointments by the same technician', async () => {
    const { prisma, service } = createService();
    prisma.job.findMany.mockResolvedValueOnce([
      job({ assignedTo: null, assignedToUserId: null, status: 'COMPLETED' }),
    ]);
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        assignedUser: {
          email: 'ram@example.com',
          firstName: 'Ram',
          id: 'tech-1',
          lastName: 'G',
        },
        assignedUserId: 'tech-1',
        id: 'appointment-1',
      }),
      appointment({
        assignedUser: {
          email: 'ram@example.com',
          firstName: 'Ram',
          id: 'tech-1',
          lastName: 'G',
        },
        assignedUserId: 'tech-1',
        id: 'appointment-2',
      }),
    ]);

    const result = await service.findAll(owner, { filter: 'completed' });

    expect(result.records[0]?.technicianDisplayLabel).toBe(
      'Completed by Ram G',
    );
  });

  it('summarises completed jobs with multiple completing technicians', async () => {
    const { prisma, service } = createService();
    prisma.job.findMany.mockResolvedValueOnce([
      job({ assignedTo: null, assignedToUserId: null, status: 'COMPLETED' }),
    ]);
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        assignedUser: {
          email: 'ram@example.com',
          firstName: 'Ram',
          id: 'tech-1',
          lastName: 'G',
        },
        assignedUserId: 'tech-1',
      }),
      appointment({
        assignedUser: {
          email: 'maya@example.com',
          firstName: 'Maya',
          id: 'tech-2',
          lastName: 'K',
        },
        assignedUserId: 'tech-2',
        id: 'appointment-2',
      }),
    ]);

    const result = await service.findAll(owner, { filter: 'completed' });

    expect(result.records[0]?.technicianDisplayLabel).toBe(
      'Completed by Ram G, Maya K',
    );
  });

  it('aggregates unique historical completion-crew names across completed appointments', async () => {
    const { prisma, service } = createService();
    prisma.job.findMany.mockResolvedValueOnce([
      job({ assignedTo: null, assignedToUserId: null, status: 'COMPLETED' }),
    ]);
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        id: 'appointment-1',
        completionCrew: [
          { userId: 'tech-1', displayName: 'Ram G' },
          { userId: 'tech-2', displayName: 'Ganga G' },
        ],
      }),
      appointment({
        id: 'appointment-2',
        completionCrew: [
          { userId: 'tech-2', displayName: 'Ganga G' },
          { userId: 'tech-3', displayName: 'Bhupathi Reddy' },
        ],
      }),
    ]);

    const result = await service.findAll(owner, { filter: 'completed' });
    expect(result.records[0]?.technicianDisplayLabel).toBe(
      'Completed by Ram G, Ganga G, Bhupathi Reddy',
    );
  });

  it('does not show unassigned for completed jobs without technician history', async () => {
    const { prisma, service } = createService();
    prisma.job.findMany.mockResolvedValueOnce([
      job({ assignedTo: null, assignedToUserId: null, status: 'COMPLETED' }),
    ]);
    prisma.appointment.findMany.mockResolvedValueOnce([]);

    const result = await service.findAll(owner, { filter: 'completed' });

    expect(result.records[0]?.technicianDisplayLabel).toBe(
      'No technician recorded',
    );
  });

  it('shows the next active appointment technician for active jobs', async () => {
    const { prisma, service } = createService();
    prisma.job.findMany.mockResolvedValueOnce([
      job({ assignedTo: null, assignedToUserId: null }),
    ]);
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        assignedUser: {
          email: 'ram@example.com',
          firstName: 'Ram',
          id: 'tech-1',
          lastName: 'G',
        },
        assignedUserId: 'tech-1',
        completedAt: null,
        status: 'CONFIRMED',
      }),
    ]);

    const result = await service.findAll(owner, {});

    expect(result.records[0]?.technicianDisplayLabel).toBe('Ram G');
    expect(result.records[0]?.hasActionableAppointment).toBe(true);
  });

  it('uses the active appointment schedule on the Jobs list instead of the stale job schedule', async () => {
    const { prisma, service } = createService();
    prisma.job.findMany.mockResolvedValueOnce([
      job({
        assignedTo: null,
        assignedToUserId: null,
        scheduledEnd: new Date('2026-09-17T02:00:00.000Z'),
        scheduledStart: new Date('2026-09-17T01:00:00.000Z'),
      }),
    ]);
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        assignedUser: {
          email: 'ram@example.com',
          firstName: 'Ram',
          id: 'tech-1',
          lastName: 'G',
        },
        assignedUserId: 'tech-1',
        completedAt: null,
        scheduledEnd: new Date('2026-09-19T17:00:00.000Z'),
        scheduledStart: new Date('2026-09-19T16:00:00.000Z'),
        status: 'CONFIRMED',
      }),
    ]);

    const result = await service.findAll(owner, {});

    expect(result.records[0]?.scheduledStart).toBe('2026-09-19T16:00:00.000Z');
    expect(result.records[0]?.scheduledEnd).toBe('2026-09-19T17:00:00.000Z');
    expect(result.records[0]?.technicianDisplayLabel).toBe('Ram G');
  });

  it('reflects a rescheduled appointment date on the Jobs list', async () => {
    const { prisma, service } = createService();
    prisma.job.findMany.mockResolvedValueOnce([
      job({
        scheduledEnd: new Date('2026-09-17T02:00:00.000Z'),
        scheduledStart: new Date('2026-09-17T01:00:00.000Z'),
      }),
    ]);
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        completedAt: null,
        scheduledEnd: new Date('2026-09-19T05:00:00.000Z'),
        scheduledStart: new Date('2026-09-19T04:00:00.000Z'),
        status: 'SCHEDULED',
      }),
    ]);

    const result = await service.findAll(owner, {});

    expect(result.records[0]?.scheduledStart).toBe('2026-09-19T04:00:00.000Z');
    expect(result.records[0]?.scheduledStart).not.toBe(
      '2026-09-17T01:00:00.000Z',
    );
  });

  it('uses the nearest upcoming active appointment when a job has several appointments', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-16T00:00:00.000Z'));
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        completedAt: null,
        id: 'stale-active-appointment',
        scheduledEnd: new Date('2026-09-15T03:00:00.000Z'),
        scheduledStart: new Date('2026-09-15T02:00:00.000Z'),
        status: 'CONFIRMED',
      }),
      appointment({
        completedAt: null,
        id: 'nearest-upcoming-appointment',
        scheduledEnd: new Date('2026-09-19T05:00:00.000Z'),
        scheduledStart: new Date('2026-09-19T04:00:00.000Z'),
        status: 'CONFIRMED',
      }),
      appointment({
        completedAt: null,
        id: 'later-upcoming-appointment',
        scheduledEnd: new Date('2026-09-20T17:00:00.000Z'),
        scheduledStart: new Date('2026-09-20T16:00:00.000Z'),
        status: 'SCHEDULED',
      }),
    ]);

    const result = await service.findAll(owner, {});

    expect(result.records[0]?.scheduledStart).toBe('2026-09-19T04:00:00.000Z');
  });

  it('queries only active appointment statuses for Jobs list schedule display', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        completedAt: null,
        scheduledEnd: new Date('2026-09-19T05:00:00.000Z'),
        scheduledStart: new Date('2026-09-19T04:00:00.000Z'),
        status: 'SCHEDULED',
      }),
    ]);

    const result = await service.findAll(owner, {});

    const appointmentFindManyCalls = prisma.appointment.findMany.mock
      .calls as Array<[{ where: { status: { in: string[] } } }]>;
    const activeStatuses =
      appointmentFindManyCalls[0]?.[0].where.status.in ?? [];
    expect(activeStatuses).toContain('SCHEDULED');
    expect(activeStatuses).toContain('CONFIRMED');
    expect(activeStatuses).not.toContain('CANCELLED');
    expect(result.records[0]?.scheduledStart).toBe('2026-09-19T04:00:00.000Z');
  });

  it('uses future active appointments instead of historical completed appointments for active jobs', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        completedAt: null,
        scheduledEnd: new Date('2026-09-19T05:00:00.000Z'),
        scheduledStart: new Date('2026-09-19T04:00:00.000Z'),
        status: 'CONFIRMED',
      }),
    ]);

    const result = await service.findAll(owner, {});

    expect(result.records[0]?.scheduledStart).toBe('2026-09-19T04:00:00.000Z');
    expect(result.records[0]?.scheduledStart).not.toBe(
      '2026-07-14T09:00:00.000Z',
    );
  });

  it('marks a legacy scheduled job with no active appointment as unscheduled for cards', async () => {
    const { prisma, service } = createService();
    prisma.job.findMany.mockResolvedValueOnce([
      job({ status: 'SCHEDULED', assignedToUserId: 'tech-1' }),
    ]);

    const result = await service.findAll(owner, {});

    expect(result.records[0]?.hasActionableAppointment).toBe(false);
    expect(result.records[0]?.technicianDisplayLabel).toBe('Unassigned');
    expect(result.records[0]?.status).toBe('SCHEDULED');
    expect(result.records[0]?.scheduledStart).toBe('2026-07-14T09:00:00.000Z');
    expect(result.records[0]?.scheduledEnd).toBe('2026-07-14T11:00:00.000Z');
  });

  it('filters Jobs calendar dates through actionable appointments, not legacy job dates', async () => {
    const { prisma, service } = createService();

    await service.findAll(owner, { filter: 'today' });

    const findManyCalls = prisma.job.findMany.mock.calls as Array<
      [
        {
          where: {
            appointments?: {
              some: { businessId: string; status: { in: string[] } };
            };
            scheduledStart?: unknown;
          };
        },
      ]
    >;
    const findManyOptions = findManyCalls[0]?.[0];
    expect(findManyOptions?.where.scheduledStart).toBeUndefined();
    expect(findManyOptions?.where.appointments?.some.businessId).toBe(
      owner.businessId,
    );
    expect(findManyOptions?.where.appointments?.some.status.in).toContain(
      'CONFIRMED',
    );
    expect(findManyOptions?.where.appointments?.some.status.in).not.toContain(
      'CANCELLED',
    );
  });

  it('shows unassigned for active jobs with an unassigned upcoming appointment', async () => {
    const { prisma, service } = createService();
    prisma.job.findMany.mockResolvedValueOnce([
      job({ assignedTo: null, assignedToUserId: null }),
    ]);
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        assignedUser: null,
        assignedUserId: null,
        completedAt: null,
        status: 'SCHEDULED',
      }),
    ]);

    const result = await service.findAll(owner, {});

    expect(result.records[0]?.technicianDisplayLabel).toBe('Unassigned');
  });

  it('keeps job technician history queries scoped to the current tenant', async () => {
    const { prisma, service } = createService();
    prisma.job.findMany.mockResolvedValueOnce([
      job({ assignedTo: null, assignedToUserId: null, status: 'COMPLETED' }),
    ]);

    await service.findAll(owner, { filter: 'completed' });

    const [completedHistoryQuery] = prisma.appointment.findMany.mock
      .calls[0] as [{ where: { businessId: string; jobId: { in: string[] } } }];
    expect(completedHistoryQuery.where.businessId).toBe(owner.businessId);
    expect(completedHistoryQuery.where.jobId.in).toEqual(['job-1']);
  });

  it('limits technicians to assigned jobs', async () => {
    const { prisma, service } = createService();

    await service.findAll(technician, {});

    const [[findManyArg]] = prisma.job.findMany.mock.calls as [
      [{ where: { assignedToUserId: string } }],
    ];
    expect(findManyArg.where.assignedToUserId).toBe('tech-1');
  });

  it('generates per-business job numbers when creating jobs', async () => {
    const { prisma, service } = createService();

    await service.create(owner, payload());

    expect(prisma.jobSequence.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { nextNumber: 8 },
        where: { businessId: 'business-1' },
      }),
    );
    const [[createArg]] = prisma.job.create.mock.calls as [
      [{ data: { jobNumber: string } }],
    ];
    expect(createArg.data.jobNumber).toBe('JOB-2026-000007');
  });

  it('creates an unscheduled NEW job without a technician or appointment', async () => {
    const { prisma, service } = createService();

    await service.create(
      owner,
      payload({
        assignedToUserId: null,
        scheduledEnd: null,
        status: 'NEW',
      }),
    );

    const [[createArg]] = prisma.job.create.mock.calls as [
      [
        {
          data: {
            assignedToUserId: string | null;
            scheduledEnd: Date | null;
            status: string;
          };
        },
      ],
    ];
    expect(createArg.data.status).toBe('NEW');
    expect(createArg.data.assignedToUserId).toBeNull();
    expect(createArg.data.scheduledEnd).toBeNull();
    expect(prisma.appointment.findMany).toHaveBeenCalled();
  });

  it('updates job details without changing its customer when customerId is omitted', async () => {
    const { prisma, service } = createService();

    await service.update(
      owner,
      'job-1',
      payload({
        customerId: undefined,
        title: 'Updated title',
        priority: 'HIGH',
      }),
    );

    const [[updateArg]] = prisma.job.update.mock.calls as [
      [{ data: { customerId: string; title: string; priority: string } }],
    ];
    expect(updateArg.data.customerId).toBe('customer-1');
    expect(updateArg.data.title).toBe('Updated title');
    expect(updateArg.data.priority).toBe('HIGH');
  });

  it('accepts the existing customerId for backward-compatible job updates', async () => {
    const { prisma, service } = createService();

    await service.update(owner, 'job-1', payload({ customerId: 'customer-1' }));

    const [[updateArg]] = prisma.job.update.mock.calls as [
      [{ data: { customerId: string } }],
    ];
    expect(updateArg.data.customerId).toBe('customer-1');
  });

  it('rejects moving a job to another customer before writing job or appointment data', async () => {
    const { prisma, service } = createService();

    await expect(
      service.update(owner, 'job-1', payload({ customerId: 'customer-2' })),
    ).rejects.toThrow('Customer cannot be changed after the job is created.');

    expect(prisma.job.update).not.toHaveBeenCalled();
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('persists optional quick customer email when creating a job', async () => {
    const { prisma, service } = createService();

    await service.create(
      owner,
      payload({
        customerId: undefined,
        quickCustomer: {
          addressLine1: '18 Coffey Street',
          email: '  Sam.Donald@Example.COM ',
          name: 'Sam Donald',
          phone: '0414 303 343',
          postcode: '3029',
          state: 'VIC',
          suburb: 'Tarneit',
        },
      }),
    );

    const [[customerCreateArg]] = prisma.customer.create.mock.calls as [
      [CustomerCreateCall],
    ];
    expect(customerCreateArg.data.email).toBe('sam.donald@example.com');
    expect(customerCreateArg.data.emailNormalised).toBe(
      'sam.donald@example.com',
    );
  });

  it('repairs stale job sequences before creating jobs', async () => {
    const { prisma, service } = createService();
    prisma.jobSequence.findUnique.mockResolvedValueOnce({
      businessId: 'business-1',
      nextNumber: 1,
    });
    prisma.job.findFirst
      .mockResolvedValueOnce(job({ jobNumber: 'JOB-2026-000012' }))
      .mockResolvedValueOnce(job({ jobNumber: 'JOB-2026-000013' }));

    await service.create(owner, payload());

    expect(prisma.jobSequence.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { nextNumber: 14 },
        where: { businessId: 'business-1' },
      }),
    );
    const [[createArg]] = prisma.job.create.mock.calls as [
      [{ data: { jobNumber: string } }],
    ];
    expect(createArg.data.jobNumber).toBe('JOB-2026-000013');
  });

  it('rejects end time before start time', async () => {
    const { service } = createService();

    await service
      .create(
        owner,
        payload({ scheduledEnd: '2026-07-14T08:00:00.000Z' }) as never,
      )
      .catch((error: unknown) => {
        expectDomainError(error, 'INVALID_JOB_DATA');
      });
  });

  it('records status transitions and completion timestamps', async () => {
    const { prisma, service } = createService();

    await service.updateStatus(owner, 'job-1', { status: 'COMPLETED' });

    const jobUpdateCalls = prisma.job.update.mock.calls as unknown as Array<
      [JobUpdateCall]
    >;
    const updateArg = jobUpdateCalls[0]?.[0];
    expect(updateArg?.data.status).toBe('COMPLETED');
    expect(updateArg?.data.completedAt).toBeInstanceOf(Date);
    const auditCreateCalls = prisma.auditLog.create.mock
      .calls as unknown as Array<[AuditCreateCall]>;
    const auditCall = auditCreateCalls.find(
      ([arg]) => arg.data.action === 'JOB_COMPLETED',
    );
    expect(auditCall).toBeDefined();
  });

  it('keeps appointments unchanged when a scheduled job is put on hold', async () => {
    const { prisma, service, notifications } = createService();
    prisma.appointment.findMany.mockResolvedValue([
      appointment({ status: 'SCHEDULED' }),
    ]);

    await service.updateStatus(owner, 'job-1', { status: 'ON_HOLD' });

    const [[updateArg]] = prisma.job.update.mock.calls as [
      [{ data: { status: string } }],
    ];
    expect(updateArg.data.status).toBe('ON_HOLD');
    expect(prisma.appointment.update).not.toHaveBeenCalled();
    expect(notifications.create).toHaveBeenCalled();
  });

  it('resumes an unstarted held job to SCHEDULED when it has a future appointment', async () => {
    const { prisma, service } = createService();
    prisma.job.findFirst.mockResolvedValue(job({ status: 'ON_HOLD' }));
    prisma.appointment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'appointment-1' });

    await service.updateStatus(owner, 'job-1', { status: 'IN_PROGRESS' });

    const [[updateArg]] = prisma.job.update.mock.calls as [
      [{ data: { status: string } }],
    ];
    expect(updateArg.data.status).toBe('SCHEDULED');
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it('resumes a held job with prior appointment execution to IN_PROGRESS', async () => {
    const { prisma, service } = createService();
    prisma.job.findFirst.mockResolvedValue(job({ status: 'ON_HOLD' }));
    prisma.appointment.findFirst.mockResolvedValueOnce({ id: 'appointment-1' });

    await service.updateStatus(owner, 'job-1', { status: 'IN_PROGRESS' });

    const [[updateArg]] = prisma.job.update.mock.calls as [
      [{ data: { status: string } }],
    ];
    expect(updateArg.data.status).toBe('IN_PROGRESS');
  });

  it('requires explicit confirmation before completing a job with an open appointment', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValue([
      appointment({ status: 'SCHEDULED' }),
    ]);

    await expect(
      service.updateStatus(owner, 'job-1', { status: 'COMPLETED' }),
    ).rejects.toThrow('appointment(s) are still open');

    expect(prisma.job.update).not.toHaveBeenCalled();
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it('does not let a technician manually change the parent job status', async () => {
    const { prisma, service } = createService();
    await service
      .updateStatus(technician, 'job-1', { status: 'ON_HOLD' })
      .catch((error: unknown) => {
        expectDomainError(error, 'INSUFFICIENT_PERMISSION');
      });
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it.each(['COMPLETED', 'CANCELLED'] as const)(
    'atomically cancels open appointments when a job is force-%s',
    async (status) => {
      const { prisma, service, communications } = createService();
      prisma.appointment.findMany.mockResolvedValue([
        appointment({ status: 'SCHEDULED' }),
      ]);

      await service.updateStatus(owner, 'job-1', { status, force: true });

      expect(prisma.$transaction).toHaveBeenCalled();
      const [[jobUpdateArg]] = prisma.job.update.mock.calls as [
        [{ data: { status: string } }],
      ];
      const [[appointmentUpdateArg]] = prisma.appointment.update.mock.calls as [
        [{ data: { status: string } }],
      ];
      expect(jobUpdateArg.data.status).toBe(status);
      expect(appointmentUpdateArg.data.status).toBe('CANCELLED');
      expect(communications.appointmentCancelled).toHaveBeenCalled();
    },
  );

  it('does not announce a completed transition when linked cancellation fails', async () => {
    const { prisma, service, notifications } = createService();
    prisma.appointment.findMany.mockResolvedValue([
      appointment({ status: 'IN_PROGRESS' }),
    ]);
    prisma.appointment.update.mockRejectedValueOnce(new Error('write failed'));

    await expect(
      service.updateStatus(owner, 'job-1', {
        status: 'COMPLETED',
        force: true,
      }),
    ).rejects.toThrow('write failed');

    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('returns source quote and multiple related quotes from structured relationships', async () => {
    const { prisma, service } = createService();
    prisma.job.findFirst.mockResolvedValueOnce(
      job({ sourceQuoteId: 'quote-source' }),
    );
    prisma.quote.findFirst.mockResolvedValueOnce({
      id: 'quote-source',
      quoteNumber: 'Q-2026-000010',
      status: 'ACCEPTED',
      title: 'Original accepted quote',
      totalCents: 61600,
    });
    prisma.quote.findMany.mockResolvedValueOnce([
      {
        id: 'quote-related-1',
        quoteNumber: 'Q-2026-000011',
        status: 'SENT',
        title: 'Additional work',
        totalCents: 13200,
      },
      {
        id: 'quote-related-2',
        quoteNumber: 'Q-2026-000012',
        status: 'DRAFT',
        title: 'Variation draft',
        totalCents: 25000,
      },
    ]);

    const result = await service.findOne(owner, 'job-1');

    expect(result.sourceQuote?.id).toBe('quote-source');
    expect(result.relatedQuotes).toHaveLength(2);
    const findManyCalls = prisma.quote.findMany.mock.calls as unknown as Array<
      [{ where: { businessId: string; relatedJobId: string } }]
    >;
    expect(findManyCalls[0]?.[0].where).toMatchObject({
      businessId: owner.businessId,
      relatedJobId: 'job-1',
    });
  });

  it('returns accepted-then-converted source quotes for job financial summaries', async () => {
    const { prisma, service } = createService();
    prisma.job.findFirst.mockResolvedValueOnce(
      job({ sourceQuoteId: 'quote-source' }),
    );
    prisma.quote.findFirst.mockResolvedValueOnce({
      id: 'quote-source',
      quoteNumber: 'Q-2026-000005',
      status: 'CONVERTED',
      title: 'Converted accepted quote',
      totalCents: 13200,
    });
    prisma.quote.findMany.mockResolvedValueOnce([
      {
        id: 'quote-related-accepted',
        quoteNumber: 'Q-2026-000006',
        status: 'ACCEPTED',
        title: 'Accepted variation',
        totalCents: 25000,
      },
      {
        id: 'quote-related-cancelled',
        quoteNumber: 'Q-2026-000007',
        status: 'CANCELLED',
        title: 'Cancelled variation',
        totalCents: 99000,
      },
    ]);
    prisma.invoice.findMany.mockResolvedValueOnce([
      {
        amountPaidCents: 10000,
        balanceDueCents: 23200,
        dueDate: new Date('2026-09-30T00:00:00.000Z'),
        id: 'invoice-1',
        invoiceNumber: 'INV-2026-000001',
        status: 'SENT',
        title: 'Deposit invoice',
        totalCents: 33200,
      },
    ]);

    const result = await service.findOne(owner, 'job-1');

    expect(result.sourceQuote).toMatchObject({
      id: 'quote-source',
      status: 'CONVERTED',
      totalCents: 13200,
    });
    expect(result.relatedQuotes).toEqual([
      expect.objectContaining({
        id: 'quote-related-accepted',
        status: 'ACCEPTED',
        totalCents: 25000,
      }),
      expect.objectContaining({
        id: 'quote-related-cancelled',
        status: 'CANCELLED',
        totalCents: 99000,
      }),
    ]);
    expect(result.invoices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amountPaidCents: 10000,
          balanceDueCents: 23200,
          totalCents: 33200,
        }),
      ]),
    );
  });

  it('allows a technician to open a parent job through their assigned appointment', async () => {
    const { prisma, service } = createService();
    prisma.job.findFirst.mockResolvedValueOnce(
      job({
        assignedToUserId: null,
        jobNumber: 'JOB-2026-000003',
      }),
    );
    prisma.appointment.findMany.mockResolvedValueOnce([
      {
        assignedUserId: 'tech-1',
        appointmentNumber: 'APT-2026-000001',
        id: 'appointment-completed-1',
      },
    ]);

    const result = await service.findOne(technician, 'job-1');

    expect(result.job.id).toBe('job-1');
    expect(result.job.jobNumber).toBe('JOB-2026-000003');
    expect(prisma.appointment.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        businessId: 'business-1',
        jobId: 'job-1',
      },
      select: {
        assignedUserId: true,
        crewAssignments: { select: { userId: true } },
        appointmentNumber: true,
        id: true,
      },
      take: 50,
    });
  });

  it('allows an owner to open the same parent job without technician assignment checks', async () => {
    const { prisma, service } = createService();
    prisma.job.findFirst.mockResolvedValueOnce(
      job({
        assignedToUserId: null,
        jobNumber: 'JOB-2026-000003',
      }),
    );

    const result = await service.findOne(owner, 'job-1');

    expect(result.job.id).toBe('job-1');
    expect(result.job.jobNumber).toBe('JOB-2026-000003');
    expect(prisma.appointment.findMany).toHaveBeenCalledTimes(1);
  });

  it('keeps completed appointment follow-up work logs in Job Details', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        workLogs: [
          {
            appointmentId: 'appointment-1',
            businessId: 'business-1',
            createdAt: new Date('2026-07-14T10:40:00.000Z'),
            followUpNotes: 'Return with a replacement valve.',
            followUpRequired: true,
            id: 'work-log-1',
            jobId: 'job-1',
            technicianNotes: 'Found leaking pipe under kitchen sink.',
            technicianUserId: 'tech-1',
            updatedAt: new Date('2026-07-14T10:45:00.000Z'),
            workCompleted: 'Replaced damaged pipe section and tested for leak.',
          },
        ],
      }),
    ]);

    const result = await service.findOne(owner, 'job-1');

    expect(result.job.status).toBe('SCHEDULED');
    expect(result.appointments[0]?.status).toBe('COMPLETED');
    expect(result.appointments[0]?.workLog).toMatchObject({
      followUpNotes: 'Return with a replacement valve.',
      followUpRequired: true,
      technicianNotes: 'Found leaking pipe under kitchen sink.',
      workCompleted: 'Replaced damaged pipe section and tested for leak.',
    });
  });

  it('keeps older follow-up unresolved when a later appointment records no follow-up', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        appointmentNumber: 'APT-2026-000001',
        completedAt: new Date('2026-09-01T01:00:00.000Z'),
        id: 'appointment-follow-up',
        workLogs: [
          {
            appointmentId: 'appointment-follow-up',
            businessId: 'business-1',
            createdAt: new Date('2026-09-01T01:00:00.000Z'),
            followUpNotes: 'Return with replacement mixer.',
            followUpRequired: true,
            id: 'work-log-follow-up',
            jobId: 'job-1',
            technicianNotes: 'Temporary repair completed.',
            technicianUserId: 'tech-1',
            updatedAt: new Date('2026-09-01T01:05:00.000Z'),
            workCompleted: 'Stopped leak temporarily.',
          },
        ],
      }),
      appointment({
        appointmentNumber: 'APT-2026-000003',
        completedAt: new Date('2026-09-08T01:00:00.000Z'),
        id: 'appointment-latest',
        workLogs: [
          {
            appointmentId: 'appointment-latest',
            businessId: 'business-1',
            createdAt: new Date('2026-09-08T01:00:00.000Z'),
            followUpNotes: null,
            followUpRequired: false,
            id: 'work-log-latest',
            jobId: 'job-1',
            technicianNotes: 'Checked repair.',
            technicianUserId: 'tech-1',
            updatedAt: new Date('2026-09-08T01:05:00.000Z'),
            workCompleted: 'Latest visit complete.',
          },
        ],
      }),
    ]);

    const result = await service.findOne(owner, 'job-1');

    expect(result.followUp).toMatchObject({
      notes: 'Return with replacement mixer.',
      sourceAppointmentId: 'appointment-follow-up',
      sourceAppointmentNumber: 'APT-2026-000001',
      unresolved: true,
    });
    expect(result.appointments[1]?.workLog?.followUpRequired).toBe(false);
  });

  it('allows authorised job operators to resolve unresolved follow-up with an audit event', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        appointmentNumber: 'APT-2026-000001',
        id: 'appointment-follow-up',
        workLogs: [
          {
            appointmentId: 'appointment-follow-up',
            businessId: 'business-1',
            createdAt: new Date('2026-09-01T01:00:00.000Z'),
            followUpNotes: 'Return with replacement mixer.',
            followUpRequired: true,
            id: 'work-log-follow-up',
            jobId: 'job-1',
            technicianNotes: null,
            technicianUserId: 'tech-1',
            updatedAt: new Date('2026-09-01T01:05:00.000Z'),
            workCompleted: 'Temporary repair.',
          },
        ],
      }),
    ]);

    await service.resolveFollowUp(owner, 'job-1', {
      reason: 'RESOLVED_DURING_LATEST_VISIT',
    });

    const auditCreateCalls = prisma.auditLog.create.mock
      .calls as unknown as Array<[{ data: AuditCreateCall['data'] }]>;
    expect(auditCreateCalls[0]?.[0].data).toMatchObject({
      action: 'FOLLOW_UP_RESOLVED',
      actorUserId: 'owner-1',
      businessId: 'business-1',
      entityId: 'job-1',
      entityType: 'Job',
      metadata: {
        note: null,
        reason: 'RESOLVED_DURING_LATEST_VISIT',
        sourceAppointmentId: 'appointment-follow-up',
        sourceAppointmentNumber: 'APT-2026-000001',
      },
    });
  });

  it('requires an explanation when resolving follow-up as Other', async () => {
    const { service } = createService();

    await service
      .resolveFollowUp(owner, 'job-1', { note: ' ', reason: 'OTHER' })
      .catch((error: unknown) => {
        expectDomainError(error, 'FOLLOW_UP_RESOLUTION_NOTE_REQUIRED');
      });
  });

  it('blocks unauthorised users from resolving job-level follow-up', async () => {
    const { prisma, service } = createService();

    await service
      .resolveFollowUp(technician, 'job-1', {
        reason: 'NO_FURTHER_ACTION_REQUIRED',
      })
      .catch((error: unknown) => {
        expectDomainError(error, 'INSUFFICIENT_PERMISSION');
      });

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('treats repeated follow-up resolution as idempotent when no unresolved follow-up remains', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        workLogs: [
          {
            appointmentId: 'appointment-1',
            businessId: 'business-1',
            createdAt: new Date('2026-09-01T01:00:00.000Z'),
            followUpNotes: 'Original follow-up.',
            followUpRequired: true,
            id: 'work-log-follow-up',
            jobId: 'job-1',
            technicianNotes: null,
            technicianUserId: 'tech-1',
            updatedAt: new Date('2026-09-01T01:05:00.000Z'),
            workCompleted: 'Temporary repair.',
          },
        ],
      }),
    ]);
    prisma.auditLog.findMany.mockResolvedValueOnce([
      audit('FOLLOW_UP_RESOLVED', {
        actorUserId: 'owner-1',
        createdAt: new Date('2026-09-08T01:00:00.000Z'),
        entityId: 'job-1',
        entityType: 'Job',
        metadata: {
          reason: 'NO_FURTHER_ACTION_REQUIRED',
          sourceAppointmentId: 'appointment-1',
          sourceAppointmentNumber: 'APT-2026-000001',
        },
      }),
    ]);

    await service.resolveFollowUp(owner, 'job-1', {
      reason: 'NO_FURTHER_ACTION_REQUIRED',
    });

    expect(
      (
        prisma.auditLog.create.mock.calls as Array<
          [{ data: AuditCreateCall['data'] }]
        >
      ).filter(([call]) => call.data.action === 'FOLLOW_UP_RESOLVED'),
    ).toHaveLength(0);
  });

  it('prevents completing a job while aggregate follow-up is unresolved', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        workLogs: [
          {
            appointmentId: 'appointment-1',
            businessId: 'business-1',
            createdAt: new Date('2026-09-01T01:00:00.000Z'),
            followUpNotes: 'Return with replacement mixer.',
            followUpRequired: true,
            id: 'work-log-follow-up',
            jobId: 'job-1',
            technicianNotes: null,
            technicianUserId: 'tech-1',
            updatedAt: new Date('2026-09-01T01:05:00.000Z'),
            workCompleted: 'Temporary repair.',
          },
        ],
      }),
    ]);

    await service
      .updateStatus(owner, 'job-1', { status: 'COMPLETED' })
      .catch((error: unknown) => {
        expectDomainError(error, 'FOLLOW_UP_UNRESOLVED');
      });

    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it('allows completing a job after follow-up has been explicitly resolved', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        workLogs: [
          {
            appointmentId: 'appointment-1',
            businessId: 'business-1',
            createdAt: new Date('2026-09-01T01:00:00.000Z'),
            followUpNotes: 'Return with replacement mixer.',
            followUpRequired: true,
            id: 'work-log-follow-up',
            jobId: 'job-1',
            technicianNotes: null,
            technicianUserId: 'tech-1',
            updatedAt: new Date('2026-09-01T01:05:00.000Z'),
            workCompleted: 'Temporary repair.',
          },
        ],
      }),
    ]);
    prisma.auditLog.findMany.mockResolvedValueOnce([
      audit('FOLLOW_UP_RESOLVED', {
        actorUserId: 'owner-1',
        createdAt: new Date('2026-09-08T01:00:00.000Z'),
        entityId: 'job-1',
        entityType: 'Job',
        metadata: {
          reason: 'RESOLVED_DURING_LATEST_VISIT',
          sourceAppointmentId: 'appointment-1',
          sourceAppointmentNumber: 'APT-2026-000001',
        },
      }),
    ]);

    await service.updateStatus(owner, 'job-1', { status: 'COMPLETED' });

    const jobUpdateCalls = prisma.job.update.mock.calls as unknown as Array<
      [JobUpdateCall]
    >;
    expect(jobUpdateCalls[0]?.[0].data.status).toBe('COMPLETED');
  });

  it('maps latest appointment signature status into Job Details appointments', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([
      appointment({
        signatures: [
          {
            appointmentId: 'appointment-1',
            businessId: 'business-1',
            capturedAt: new Date('2026-07-14T10:44:00.000Z'),
            capturedByUserId: 'tech-1',
            consentText: 'I confirm this appointment is complete.',
            createdAt: new Date('2026-07-14T10:43:00.000Z'),
            customerName: 'Priya Sharma',
            id: 'signature-1',
            jobId: 'job-1',
            signatureData: { strokes: [[{ x: 1, y: 1 }]] },
            signerTitle: 'Owner',
            skippedAt: null,
            skipReason: null,
            updatedAt: new Date('2026-07-14T10:44:00.000Z'),
          },
        ],
      }),
    ]);

    const result = await service.findOne(owner, 'job-1');

    expect(result.appointments[0]?.signature).toMatchObject({
      capturedAt: '2026-07-14T10:44:00.000Z',
      customerName: 'Priya Sharma',
      id: 'signature-1',
    });
  });

  it('hides noisy transient timeline entries and collapses near-duplicates', async () => {
    const { prisma, service } = createService();
    prisma.appointment.findMany.mockResolvedValueOnce([appointment()]);
    prisma.auditLog.findMany
      .mockResolvedValueOnce([
        audit('JOB_CREATED', {
          createdAt: new Date('2026-07-14T08:00:00.000Z'),
          entityId: 'job-1',
          entityType: 'Job',
          id: 'job-created-1',
        }),
      ])
      .mockResolvedValueOnce([
        audit('MEDIA_UPLOAD_STARTED', {
          createdAt: new Date('2026-07-14T10:43:00.000Z'),
          id: 'media-started-1',
        }),
        audit('JOB_TIMELINE_APPOINTMENT_CREATED', {
          createdAt: new Date('2026-07-14T10:43:30.000Z'),
          id: 'appointment-created-wrapper',
        }),
        audit('JOB_TIMELINE_APPOINTMENT_CONFIRMED', {
          createdAt: new Date('2026-07-14T10:43:45.000Z'),
          id: 'appointment-confirmed-wrapper',
        }),
        audit('APPOINTMENT_WORK_LOG_UPDATED', {
          createdAt: new Date('2026-07-14T10:44:00.000Z'),
          id: 'work-log-updated-1',
        }),
        audit('FOLLOW_UP_REQUIRED', {
          createdAt: new Date('2026-07-14T10:55:00.000Z'),
          id: 'follow-up-1',
        }),
        audit('FOLLOW_UP_REQUIRED', {
          createdAt: new Date('2026-07-14T10:44:30.000Z'),
          id: 'follow-up-duplicate',
        }),
      ]);

    const result = await service.findOne(owner, 'job-1');

    expect(result.timeline.map((entry) => entry.action)).toEqual([
      'FOLLOW_UP_REQUIRED',
      'JOB_CREATED',
    ]);
  });

  it('keeps direct job assignment access for technicians without requiring appointment lookup', async () => {
    const { prisma, service } = createService();

    await service.findOne(technician, 'job-1');

    expect(prisma.appointment.findMany).toHaveBeenCalledTimes(1);
  });

  it('denies an unrelated technician opening a job they are not assigned through job or appointment', async () => {
    const { prisma, service } = createService();
    prisma.job.findFirst.mockResolvedValueOnce(
      job({ assignedToUserId: 'other-tech' }),
    );
    prisma.appointment.findMany.mockResolvedValueOnce([
      {
        assignedUserId: 'third-tech',
        appointmentNumber: 'APT-2026-000009',
        id: 'appointment-other-tech',
      },
    ]);

    await service.findOne(technician, 'job-1').catch((error) => {
      expectDomainError(error, 'JOB_NOT_FOUND');
      expect((error as HttpException).getStatus()).toBe(404);
    });
  });

  it('denies cross-business technician access before checking assigned appointments', async () => {
    const { prisma, service } = createService();
    prisma.job.findFirst.mockResolvedValueOnce(null);

    await service
      .findOne(technician, 'job-from-other-business')
      .catch((error) => {
        expectDomainError(error, 'JOB_NOT_FOUND');
        expect((error as HttpException).getStatus()).toBe(404);
      });
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
  });

  it('blocks accountant write/archive access', async () => {
    const { service } = createService();

    await service.archive(accountant, 'job-1').catch((error: unknown) => {
      expectDomainError(error, 'INSUFFICIENT_PERMISSION');
    });
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
  ])('allows %s to GET /jobs according to job view rules', async (role) => {
    const { service } = createService();

    const result = await service.findAll(userForRole(role), {});

    expect(Array.isArray(result.records)).toBe(true);
  });

  it.each<BusinessRole>(['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER'])(
    'allows %s to POST /jobs according to job write rules',
    async (role) => {
      const { service } = createService();

      await expect(
        service.create(userForRole(role), payload()),
      ).resolves.toMatchObject({ job: { id: 'job-1' } });
    },
  );

  it.each<BusinessRole>(['TECHNICIAN', 'ACCOUNTANT', 'SALES', 'READ_ONLY'])(
    'blocks %s from POST /jobs with 403 domain error',
    async (role) => {
      const { service } = createService();

      await service.create(userForRole(role), payload()).catch((error) => {
        expectDomainError(error, 'INSUFFICIENT_PERMISSION');
      });
    },
  );
});
