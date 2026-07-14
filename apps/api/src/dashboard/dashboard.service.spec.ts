import { DashboardService } from './dashboard.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

type JobCountCall = {
  where?: {
    businessId?: string;
  };
};

describe('DashboardService', () => {
  it('returns job dashboard counts from tenant-scoped queries', async () => {
    const prisma = {
      aiMessage: { count: jest.fn() },
      business: { findUnique: jest.fn() },
      customer: { count: jest.fn() },
      invoice: { count: jest.fn(), findMany: jest.fn() },
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
    prisma.quote.count.mockResolvedValue(2);
    prisma.invoice.count.mockResolvedValue(2);
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(4);
    prisma.aiMessage.count.mockResolvedValue(3);
    prisma.job.findMany.mockResolvedValue([]);
    prisma.notification.findMany.mockResolvedValue([]);

    const service = new DashboardService(prisma as never);
    const result = await service.summary('business-1');

    expect(result.counts).toMatchObject({
      jobsToday: 2,
      upcomingJobs: 4,
      completedToday: 1,
      overdueJobs: 3,
      openJobs: 6,
    });
    const jobCountCalls = prisma.job.count.mock.calls as unknown as Array<
      [JobCountCall]
    >;
    const firstJobCountCall = jobCountCalls[0]?.[0];
    expect(firstJobCountCall?.where?.businessId).toBe('business-1');
  });
});
