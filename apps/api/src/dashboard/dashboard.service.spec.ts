import { DashboardService } from './dashboard.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

type CountCall = {
  where?: {
    businessId?: string;
    dueDate?: unknown;
    receivedAt?: unknown;
    status?: string | { in?: string[]; notIn?: string[] };
    userId?: string;
  };
};

type DashboardFixture = {
  draftInvoices?: number;
  overdueInvoices?: number;
  paidTodayCents?: number | null;
  paidTodayPayments?: number;
  unpaidInvoiceRows?: Array<{ balanceDueCents: number }>;
};

function createPrisma(fixture: DashboardFixture = {}) {
  const prisma = {
    aiMessage: { count: jest.fn() },
    appointment: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    business: { findUnique: jest.fn() },
    businessMember: { findMany: jest.fn() },
    customer: { count: jest.fn() },
    invoice: { count: jest.fn(), findMany: jest.fn() },
    invoicePayment: { aggregate: jest.fn(), count: jest.fn() },
    job: { count: jest.fn(), findMany: jest.fn() },
    notification: { count: jest.fn(), findMany: jest.fn() },
    quote: { count: jest.fn() },
    $transaction: jest.fn((items: Array<Promise<unknown>>) =>
      Promise.all(items),
    ),
  };

  prisma.business.findUnique.mockResolvedValue({
    id: 'business-1',
    name: 'Demo Tradie Co',
    timezone: 'Australia/Sydney',
  });
  prisma.customer.count.mockResolvedValue(5);
  prisma.job.count
    .mockResolvedValueOnce(2)
    .mockResolvedValueOnce(4)
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(3)
    .mockResolvedValueOnce(6);
  prisma.appointment.count
    .mockResolvedValueOnce(2)
    .mockResolvedValueOnce(4)
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(3)
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(2)
    .mockResolvedValueOnce(1);
  prisma.businessMember.findMany.mockResolvedValue([
    { userId: 'owner-1' },
    { userId: 'tech-1' },
  ]);
  prisma.quote.count.mockResolvedValue(2);
  prisma.invoice.count.mockImplementation((input: CountCall = {}) => {
    const status = input.where?.status;
    if (status === 'DRAFT') {
      return Promise.resolve(fixture.draftInvoices ?? 0);
    }
    if (input.where?.dueDate) {
      return Promise.resolve(fixture.overdueInvoices ?? 0);
    }
    if (
      typeof status === 'object' &&
      status.in?.some((invoiceStatus) =>
        ['SENT', 'VIEWED', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoiceStatus),
      )
    ) {
      return Promise.resolve(fixture.unpaidInvoiceRows?.length ?? 0);
    }
    return Promise.resolve(0);
  });
  prisma.invoice.findMany.mockResolvedValue(fixture.unpaidInvoiceRows ?? []);
  prisma.invoicePayment.count.mockResolvedValue(fixture.paidTodayPayments ?? 0);
  prisma.invoicePayment.aggregate.mockResolvedValue({
    _sum: { amountCents: fixture.paidTodayCents ?? null },
  });
  prisma.notification.count.mockResolvedValue(4);
  prisma.aiMessage.count.mockResolvedValue(3);
  prisma.job.findMany.mockResolvedValue([]);
  prisma.appointment.findMany.mockResolvedValue([]);
  prisma.appointment.findFirst.mockResolvedValue(null);
  prisma.notification.findMany.mockResolvedValue([]);

  return prisma;
}

async function getSummary(prisma: ReturnType<typeof createPrisma>) {
  const service = new DashboardService(prisma as never);
  return service.summary({
    businessId: 'business-1',
    email: 'owner@example.com',
    id: 'owner-1',
    role: 'OWNER',
  });
}

describe('DashboardService', () => {
  it('returns job dashboard counts from tenant-scoped queries', async () => {
    const prisma = createPrisma();
    const result = await getSummary(prisma);

    expect(result.counts).toMatchObject({
      jobsToday: 2,
      upcomingJobs: 4,
      completedToday: 1,
      overdueJobs: 3,
      openJobs: 6,
      todaysAppointments: 2,
      upcomingAppointments: 4,
      completedAppointmentsToday: 1,
      myAppointments: 3,
      lateAppointments: 1,
      upcomingTodayAppointments: 2,
      unassignedAppointments: 1,
      techniciansWorking: 0,
      availableTechnicians: 2,
    });
    const jobCountCalls = prisma.job.count.mock.calls as unknown as Array<
      [CountCall]
    >;
    expect(jobCountCalls[0]?.[0].where?.businessId).toBe('business-1');
  });

  it('returns zero invoice metrics when there are no invoices or payments', async () => {
    const prisma = createPrisma();
    const result = await getSummary(prisma);

    expect(result.counts).toMatchObject({
      draftInvoices: 0,
      overdueInvoices: 0,
      paidInvoicesToday: 0,
      unpaidInvoices: 0,
    });
    expect(result.money).toEqual({
      outstandingInvoicesCents: 0,
      paidTodayCents: 0,
    });
  });

  it('counts drafts without treating them as outstanding receivables', async () => {
    const prisma = createPrisma({ draftInvoices: 3 });
    const result = await getSummary(prisma);

    expect(result.counts.draftInvoices).toBe(3);
    expect(result.money.outstandingInvoicesCents).toBe(0);
  });

  it('sums outstanding balance from sent and partially paid invoices only', async () => {
    const prisma = createPrisma({
      unpaidInvoiceRows: [
        { balanceDueCents: 100000 },
        { balanceDueCents: 24550 },
      ],
    });
    const result = await getSummary(prisma);

    expect(result.counts.unpaidInvoices).toBe(2);
    expect(result.money.outstandingInvoicesCents).toBe(124550);
  });

  it('derives overdue invoices from due date, positive balance and unpaid lifecycle statuses', async () => {
    const prisma = createPrisma({ overdueInvoices: 2 });
    const result = await getSummary(prisma);

    expect(result.counts.overdueInvoices).toBe(2);
    const invoiceCountCalls = prisma.invoice.count.mock
      .calls as unknown as Array<[CountCall]>;
    const overdueCall = invoiceCountCalls.find(
      (call) => call[0].where?.dueDate,
    );
    expect(overdueCall?.[0].where).toMatchObject({
      businessId: 'business-1',
      status: { in: ['SENT', 'VIEWED', 'PARTIALLY_PAID', 'OVERDUE'] },
    });
  });

  it('calculates paid today from payments received today rather than invoice totals', async () => {
    const prisma = createPrisma({
      paidTodayCents: 20000,
      paidTodayPayments: 1,
      unpaidInvoiceRows: [{ balanceDueCents: 80000 }],
    });
    const result = await getSummary(prisma);

    expect(result.counts.paidInvoicesToday).toBe(1);
    expect(result.money.paidTodayCents).toBe(20000);
    expect(result.money.outstandingInvoicesCents).toBe(80000);
  });

  it('scopes dashboard notification summaries to the current user', async () => {
    const prisma = createPrisma();
    await getSummary(prisma);

    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: {
        businessId: 'business-1',
        status: 'UNREAD',
        userId: 'owner-1',
      },
    });
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          businessId: 'business-1',
          status: { not: 'ARCHIVED' },
          userId: 'owner-1',
        },
      }),
    );
  });

  it('scopes invoice and payment dashboard queries to the current business', async () => {
    const prisma = createPrisma({
      overdueInvoices: 1,
      paidTodayCents: 35000,
      paidTodayPayments: 1,
      unpaidInvoiceRows: [{ balanceDueCents: 99500 }],
    });
    await getSummary(prisma);

    for (const [query] of prisma.invoice.count.mock.calls as unknown as Array<
      [CountCall]
    >) {
      expect(query.where?.businessId).toBe('business-1');
    }
    for (const [query] of prisma.invoice.findMany.mock
      .calls as unknown as Array<[CountCall]>) {
      expect(query.where?.businessId).toBe('business-1');
    }
    for (const [query] of prisma.invoicePayment.count.mock
      .calls as unknown as Array<[CountCall]>) {
      expect(query.where?.businessId).toBe('business-1');
    }
    for (const [query] of prisma.invoicePayment.aggregate.mock
      .calls as unknown as Array<[CountCall]>) {
      expect(query.where?.businessId).toBe('business-1');
    }
  });
});
