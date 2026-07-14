import { Injectable, NotFoundException } from '@nestjs/common';
import type { DashboardSummaryResponse } from '@tradieos/shared';
import { PrismaService } from '../prisma/prisma.service';

const OPEN_JOB_STATUSES = [
  'LEAD',
  'QUOTED',
  'SCHEDULED',
  'IN_PROGRESS',
] as const;
const OPEN_QUOTE_STATUSES = ['DRAFT', 'SENT', 'VIEWED'] as const;
const UNPAID_INVOICE_STATUSES = [
  'SENT',
  'VIEWED',
  'PARTIALLY_PAID',
  'OVERDUE',
] as const;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(businessId: string): Promise<DashboardSummaryResponse> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    const [
      business,
      customers,
      jobsToday,
      openJobs,
      openQuotes,
      unpaidInvoices,
      unpaidInvoiceRows,
      unreadNotifications,
      aiMessages,
      todayJobs,
      notifications,
    ] = await this.prisma.$transaction([
      this.prisma.business.findUnique({
        where: { id: businessId },
        select: { id: true, name: true, timezone: true },
      }),
      this.prisma.customer.count({ where: { businessId, isArchived: false } }),
      this.prisma.job.count({
        where: {
          businessId,
          startsAt: { gte: startOfToday, lt: startOfTomorrow },
        },
      }),
      this.prisma.job.count({
        where: { businessId, status: { in: [...OPEN_JOB_STATUSES] } },
      }),
      this.prisma.quote.count({
        where: { businessId, status: { in: [...OPEN_QUOTE_STATUSES] } },
      }),
      this.prisma.invoice.count({
        where: { businessId, status: { in: [...UNPAID_INVOICE_STATUSES] } },
      }),
      this.prisma.invoice.findMany({
        where: { businessId, status: { in: [...UNPAID_INVOICE_STATUSES] } },
        select: { total: true, amountPaid: true },
      }),
      this.prisma.notification.count({
        where: { businessId, status: 'UNREAD' },
      }),
      this.prisma.aiMessage.count({ where: { businessId } }),
      this.prisma.job.findMany({
        where: {
          businessId,
          startsAt: { gte: startOfToday, lt: startOfTomorrow },
        },
        orderBy: { startsAt: 'asc' },
        take: 5,
        select: {
          id: true,
          title: true,
          status: true,
          startsAt: true,
          address: true,
          customer: {
            select: { firstName: true, lastName: true, companyName: true },
          },
        },
      }),
      this.prisma.notification.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          title: true,
          body: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);

    if (!business) {
      throw new NotFoundException('Business not found');
    }

    const outstandingInvoicesCents = unpaidInvoiceRows.reduce(
      (sum, invoice) => {
        const outstanding =
          Number(invoice.total.toString()) -
          Number(invoice.amountPaid.toString());
        return sum + Math.round(outstanding * 100);
      },
      0,
    );

    return {
      business,
      counts: {
        customers,
        jobsToday,
        openJobs,
        openQuotes,
        unpaidInvoices,
        unreadNotifications,
        aiMessages,
      },
      money: {
        outstandingInvoicesCents,
      },
      todayJobs: todayJobs.map((job) => ({
        id: job.id,
        title: job.title,
        status: job.status,
        startsAt: job.startsAt?.toISOString() ?? null,
        customerName:
          job.customer.companyName ??
          [job.customer.firstName, job.customer.lastName]
            .filter(Boolean)
            .join(' '),
        address: job.address,
      })),
      notifications: notifications.map((notification) => ({
        ...notification,
        createdAt: notification.createdAt.toISOString(),
      })),
      toriPriority: this.buildToriPriority({
        jobsToday,
        unpaidInvoices,
        unreadNotifications,
      }),
    };
  }

  private buildToriPriority(input: {
    jobsToday: number;
    unpaidInvoices: number;
    unreadNotifications: number;
  }) {
    if (input.jobsToday > 0) {
      return {
        title: `${input.jobsToday} job${input.jobsToday === 1 ? '' : 's'} to stay ahead of today`,
        body: 'Review job timing, customer notes, and any invoice follow-ups before heading out.',
      };
    }

    if (input.unpaidInvoices > 0) {
      return {
        title: `${input.unpaidInvoices} unpaid invoice${input.unpaidInvoices === 1 ? '' : 's'} to follow up`,
        body: 'Tori can draft polite payment reminders, but will wait for your confirmation before sending.',
      };
    }

    if (input.unreadNotifications > 0) {
      return {
        title: 'Catch up on customer updates',
        body: 'Review unread notifications and decide which replies or reminders Tori should draft.',
      };
    }

    return {
      title: 'Your day is looking clear',
      body: 'Tori will surface jobs, follow-ups and admin drafts here as they appear.',
    };
  }
}
