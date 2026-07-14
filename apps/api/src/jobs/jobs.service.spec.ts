import { HttpException } from '@nestjs/common';
import type { AuthenticatedUser } from '@tradieos/shared';
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

type MockPrisma = {
  auditLog: { create: jest.Mock; findMany: jest.Mock };
  customer: { findFirst: jest.Mock };
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

function payload(overrides: Partial<Record<string, unknown>> = {}) {
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
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    customer: {
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
  afterEach(() => {
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
        data: { nextNumber: { increment: 1 } },
        where: { businessId: 'business-1' },
      }),
    );
    const [[createArg]] = prisma.job.create.mock.calls as [
      [{ data: { jobNumber: string } }],
    ];
    expect(createArg.data.jobNumber).toBe('JOB-2026-000007');
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

  it('blocks accountant write/archive access', async () => {
    const { service } = createService();

    await service.archive(accountant, 'job-1').catch((error: unknown) => {
      expectDomainError(error, 'INSUFFICIENT_PERMISSION');
    });
  });
});
