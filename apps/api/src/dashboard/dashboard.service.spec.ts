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
      appointment: {
        count: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      business: { findUnique: jest.fn() },
      businessMember: { findMany: jest.fn() },
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
    prisma.invoice.count.mockResolvedValue(2);
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(4);
    prisma.aiMessage.count.mockResolvedValue(3);
    prisma.job.findMany.mockResolvedValue([]);
    prisma.appointment.findMany.mockResolvedValue([]);
    prisma.appointment.findFirst.mockResolvedValue(null);
    prisma.notification.findMany.mockResolvedValue([]);

    const service = new DashboardService(prisma as never);
    const result = await service.summary({
      businessId: 'business-1',
      email: 'owner@example.com',
      id: 'owner-1',
      role: 'OWNER',
    });

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
      [JobCountCall]
    >;
    const firstJobCountCall = jobCountCalls[0]?.[0];
    expect(firstJobCountCall?.where?.businessId).toBe('business-1');
  });
});
