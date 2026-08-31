import type { AuthenticatedUser } from '@tradieos/shared';
import { InvoicesService } from './invoices.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

const owner: AuthenticatedUser = {
  businessId: 'business-1',
  email: 'owner@demo-tradieos.com',
  id: 'owner-1',
  role: 'OWNER',
};

describe('InvoicesService accounts receivable', () => {
  let prisma: MockPrisma;
  let service: InvoicesService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-11T02:00:00.000Z'));
    prisma = {
      $transaction: jest.fn<unknown[], [unknown[]]>(
        (operations: unknown[]) => operations,
      ),
      business: {
        findUnique: jest
          .fn<Promise<{ timezone: string }>, [unknown]>()
          .mockResolvedValue({
            timezone: 'Australia/Melbourne',
          }),
      },
      invoice: {
        count: jest
          .fn<number, [unknown]>()
          .mockReturnValueOnce(3)
          .mockReturnValueOnce(1)
          .mockReturnValueOnce(2)
          .mockReturnValueOnce(4),
        findMany: jest
          .fn<unknown[], [unknown]>()
          .mockReturnValueOnce([
            { balanceDueCents: 12000 },
            { balanceDueCents: 8000 },
          ])
          .mockReturnValueOnce([{ balanceDueCents: 5000 }])
          .mockReturnValueOnce([{ balanceDueCents: 7000 }])
          .mockReturnValueOnce([])
          .mockReturnValueOnce([])
          .mockReturnValueOnce([])
          .mockReturnValueOnce([]),
      },
      invoicePayment: {
        aggregate: jest
          .fn<{ _sum: { amountCents: number } }, [unknown]>()
          .mockReturnValue({
            _sum: { amountCents: 14000 },
          }),
      },
    };
    service = new InvoicesService(
      prisma as never,
      {} as never,
      {} as never,
      {
        invoiceClosed: jest.fn(),
        invoiceSent: jest.fn(),
        paymentRecorded: jest.fn(),
      } as never,
      { createForRoles: jest.fn() } as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('summarises outstanding, overdue, due-soon and monthly paid invoice money in cents', async () => {
    const result = await service.accountsReceivable(owner, {});

    expect(result.summary).toEqual({
      dueSoonCents: 7000,
      dueSoonInvoiceCount: 2,
      outstandingInvoiceCount: 3,
      overdueInvoiceCount: 1,
      paidInvoiceCount: 4,
      paidThisMonthCents: 14000,
      totalOutstandingCents: 20000,
      totalOverdueCents: 5000,
    });
    const aggregateCall: unknown =
      prisma.invoicePayment.aggregate.mock.calls[0]?.[0];
    expect(aggregateCall).toMatchObject({
      where: {
        businessId: 'business-1',
        reversedAt: null,
      },
    });
  });

  it('scopes every invoice query to the logged-in business and customer filter', async () => {
    await service.accountsReceivable(owner, { customerId: 'customer-1' });

    const invoiceFindCall: unknown = prisma.invoice.findMany.mock.calls[0]?.[0];
    const invoiceCountCall: unknown = prisma.invoice.count.mock.calls[0]?.[0];
    expect(invoiceFindCall).toMatchObject({
      where: {
        businessId: 'business-1',
        customerId: 'customer-1',
      },
    });
    expect(invoiceCountCall).toMatchObject({
      where: {
        businessId: 'business-1',
        customerId: 'customer-1',
      },
    });
  });

  it('blocks roles that cannot view accounts receivable', async () => {
    let error: unknown;
    try {
      await service.accountsReceivable({ ...owner, role: 'TECHNICIAN' }, {});
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      response: { code: 'INVOICE_ACCESS_DENIED' },
    });
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });
});

type MockPrisma = {
  $transaction: jest.Mock<unknown[], [unknown[]]>;
  business: {
    findUnique: jest.Mock<Promise<{ timezone: string }>, [unknown]>;
  };
  invoice: {
    count: jest.Mock<number, [unknown]>;
    findMany: jest.Mock<unknown[], [unknown]>;
  };
  invoicePayment: {
    aggregate: jest.Mock<{ _sum: { amountCents: number } }, [unknown]>;
  };
};
