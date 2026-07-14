import { HttpException } from '@nestjs/common';
import type { AuthenticatedUser } from '@tradieos/shared';
import { CustomersService } from './customers.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

const owner: AuthenticatedUser = {
  businessId: 'business-1',
  email: 'owner@example.com',
  id: 'owner-1',
  role: 'OWNER',
};

const scheduler: AuthenticatedUser = {
  businessId: 'business-1',
  email: 'scheduler@example.com',
  id: 'scheduler-1',
  role: 'SCHEDULER',
};

const technician: AuthenticatedUser = {
  businessId: 'business-1',
  email: 'tech@example.com',
  id: 'tech-1',
  role: 'TECHNICIAN',
};

type MockPrisma = {
  auditLog: { create: jest.Mock; findMany: jest.Mock };
  customer: {
    count: jest.Mock;
    create: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
  customerSite: {
    create: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

function customer(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    addressLine1: '12 King Street',
    addressLine2: null,
    alternatePhone: null,
    archivedAt: null,
    businessId: 'business-1',
    companyName: null,
    contactPreference: 'SMS',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    createdBy: 'owner-1',
    customerType: 'RESIDENTIAL',
    displayName: 'Priya Sharma',
    email: 'priya@example.test',
    firstName: 'Priya',
    id: 'customer-1',
    isArchived: false,
    lastName: 'Sharma',
    notes: null,
    phone: '0400 111 222',
    postcode: '2150',
    sites: [],
    state: 'NSW',
    suburb: 'Parramatta',
    tags: ['sms'],
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedBy: null,
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
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    customerSite: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      updateMany: jest.fn(),
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
    service: new CustomersService(prisma as never),
  };
}

describe('CustomersService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  function expectDomainError(error: unknown, code: string) {
    expect(error).toBeInstanceOf(HttpException);
    const response = (error as HttpException).getResponse() as { code: string };
    expect(response.code).toBe(code);
  }

  it('lists customers scoped to business and excludes archived by default', async () => {
    const { prisma, service } = createService();
    prisma.customer.findMany.mockResolvedValue([customer()]);
    prisma.customer.count.mockResolvedValue(1);

    const result = await service.findAll(owner, { page: 1, pageSize: 20 });

    expect(result.total).toBe(1);
    const [[findManyArg]] = prisma.customer.findMany.mock.calls as [
      [{ where: { businessId: string; isArchived: boolean } }],
    ];
    expect(findManyArg.where).toMatchObject({
      businessId: 'business-1',
      isArchived: false,
    });
  });

  it('blocks broad customer access for technicians', async () => {
    const { service } = createService();

    await service.findAll(technician, {}).catch((error: unknown) => {
      expectDomainError(error, 'INSUFFICIENT_PERMISSION');
    });
  });

  it('returns duplicate warning before creating unless overridden', async () => {
    const { prisma, service } = createService();
    prisma.customer.findMany.mockResolvedValue([customer()]);

    await service
      .create(owner, {
        contactPreference: 'SMS',
        customerType: 'RESIDENTIAL',
        email: 'PRIYA@example.test',
        firstName: 'Priya',
        phone: '0400 111 222',
      })
      .catch((error: unknown) => {
        expectDomainError(error, 'POSSIBLE_DUPLICATE_CUSTOMER');
      });

    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it('creates a customer with normalised duplicate fields when override is allowed', async () => {
    const { prisma, service } = createService();
    prisma.customer.findMany.mockResolvedValue([customer()]);
    prisma.customer.create.mockResolvedValue(customer());
    prisma.customer.findFirst.mockResolvedValue(customer());

    await service.create(owner, {
      allowDuplicate: true,
      contactPreference: 'SMS',
      customerType: 'RESIDENTIAL',
      email: 'PRIYA@example.test',
      firstName: 'Priya',
      phone: '0400 111 222',
    });

    const [[createArg]] = prisma.customer.create.mock.calls as [
      [{ data: Record<string, unknown> }],
    ];
    expect(createArg.data).toMatchObject({
      businessId: 'business-1',
      emailNormalised: 'priya@example.test',
      phoneNormalised: '0400111222',
    });
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it('allows scheduler create/update but not archive', async () => {
    const { prisma, service } = createService();
    prisma.customer.findMany.mockResolvedValue([]);
    prisma.customer.create.mockResolvedValue(customer());
    prisma.customer.findFirst.mockResolvedValue(customer());

    await service.create(scheduler, {
      contactPreference: 'SMS',
      customerType: 'RESIDENTIAL',
      firstName: 'Priya',
      phone: '0400 111 222',
    });

    await service.archive(scheduler, 'customer-1').catch((error: unknown) => {
      expectDomainError(error, 'INSUFFICIENT_PERMISSION');
    });
  });

  it('archives and restores customers without hard delete', async () => {
    const { prisma, service } = createService();
    prisma.customer.findFirst
      .mockResolvedValueOnce(customer())
      .mockResolvedValueOnce(customer({ isArchived: true }))
      .mockResolvedValueOnce(customer({ isArchived: true }))
      .mockResolvedValueOnce(customer());
    prisma.customer.update.mockResolvedValue(customer({ isArchived: true }));

    await service.archive(owner, 'customer-1');
    await service.restore(owner, 'customer-1');

    expect(prisma.customer.update).toHaveBeenCalledTimes(2);
    const updateCalls = prisma.customer.update.mock.calls as Array<
      [{ data: { isArchived: boolean } }]
    >;
    expect(updateCalls[0]?.[0].data.isArchived).toBe(true);
    expect(updateCalls[1]?.[0].data.isArchived).toBe(false);
  });

  it('keeps customer sites tenant scoped and enforces one primary site', async () => {
    const { prisma, service } = createService();
    prisma.customer.findFirst.mockResolvedValue(customer());
    prisma.customerSite.create.mockResolvedValue({
      accessInstructions: null,
      addressLine1: '1 Site Road',
      addressLine2: null,
      businessId: 'business-1',
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      customerId: 'customer-1',
      id: 'site-1',
      isArchived: false,
      isPrimary: true,
      label: 'Home',
      postcode: '2150',
      siteContactName: null,
      siteContactPhone: null,
      state: 'NSW',
      suburb: 'Parramatta',
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    });

    const result = await service.createSite(owner, 'customer-1', {
      addressLine1: '1 Site Road',
      isPrimary: true,
      label: 'Home',
      postcode: '2150',
      state: 'NSW',
      suburb: 'Parramatta',
    });

    expect(result.businessId).toBe('business-1');
    expect(prisma.customerSite.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { isPrimary: false },
        where: { businessId: 'business-1', customerId: 'customer-1' },
      }),
    );
  });
});
