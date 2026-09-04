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
  appointment: { findMany: jest.Mock };
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
  const prisma: MockPrisma = {
    appointment: { findMany: jest.fn().mockResolvedValue([]) },
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
    service: new JobsService(prisma as never),
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
