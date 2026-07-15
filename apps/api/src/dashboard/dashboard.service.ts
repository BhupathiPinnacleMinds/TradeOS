import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  AuthenticatedUser,
  DashboardSummaryResponse,
} from '@tradieos/shared';
import { PrismaService } from '../prisma/prisma.service';

const OPEN_JOB_STATUSES = [
  'NEW',
  'SCHEDULED',
  'ON_THE_WAY',
  'IN_PROGRESS',
  'ON_HOLD',
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

  async summary(
    currentUser: AuthenticatedUser,
  ): Promise<DashboardSummaryResponse> {
    const { businessId } = currentUser;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    const [
      business,
      customers,
      jobsToday,
      upcomingJobs,
      completedToday,
      overdueJobs,
      openJobs,
      todaysAppointments,
      upcomingAppointments,
      completedAppointmentsToday,
      myAppointments,
      lateAppointments,
      upcomingTodayAppointments,
      openQuotes,
      unpaidInvoices,
      unpaidInvoiceRows,
      unreadNotifications,
      aiMessages,
      todayJobs,
      todayAppointments,
      nextAppointment,
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
          scheduledStart: { gte: startOfToday, lt: startOfTomorrow },
          isArchived: false,
        },
      }),
      this.prisma.job.count({
        where: {
          businessId,
          scheduledStart: { gte: startOfTomorrow },
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          isArchived: false,
        },
      }),
      this.prisma.job.count({
        where: {
          businessId,
          completedAt: { gte: startOfToday, lt: startOfTomorrow },
          status: 'COMPLETED',
          isArchived: false,
        },
      }),
      this.prisma.job.count({
        where: {
          businessId,
          scheduledEnd: { lt: new Date() },
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          isArchived: false,
        },
      }),
      this.prisma.job.count({
        where: {
          businessId,
          status: { in: [...OPEN_JOB_STATUSES] },
          isArchived: false,
        },
      }),
      this.prisma.appointment.count({
        where: {
          businessId,
          scheduledStart: { gte: startOfToday, lt: startOfTomorrow },
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        },
      }),
      this.prisma.appointment.count({
        where: {
          businessId,
          scheduledStart: { gte: startOfTomorrow },
          status: { notIn: ['COMPLETED', 'CANCELLED', 'NO_SHOW'] },
        },
      }),
      this.prisma.appointment.count({
        where: {
          actualEnd: { gte: startOfToday, lt: startOfTomorrow },
          businessId,
          status: 'COMPLETED',
        },
      }),
      this.prisma.appointment.count({
        where: {
          assignedUserId: currentUser.id,
          businessId,
          scheduledStart: { gte: startOfToday },
          status: { notIn: ['COMPLETED', 'CANCELLED', 'NO_SHOW'] },
        },
      }),
      this.prisma.appointment.count({
        where: {
          businessId,
          scheduledEnd: { lt: new Date() },
          status: { notIn: ['COMPLETED', 'CANCELLED', 'NO_SHOW'] },
        },
      }),
      this.prisma.appointment.count({
        where: {
          businessId,
          scheduledStart: { gte: new Date(), lt: startOfTomorrow },
          status: { notIn: ['COMPLETED', 'CANCELLED', 'NO_SHOW'] },
        },
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
          scheduledStart: { gte: startOfToday, lt: startOfTomorrow },
          isArchived: false,
        },
        orderBy: { scheduledStart: 'asc' },
        take: 5,
        select: {
          id: true,
          title: true,
          status: true,
          scheduledStart: true,
          addressLine1: true,
          suburb: true,
          state: true,
          customer: {
            select: { displayName: true, companyName: true },
          },
        },
      }),
      this.prisma.appointment.findMany({
        where: {
          businessId,
          scheduledStart: { gte: startOfToday, lt: startOfTomorrow },
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        },
        orderBy: { scheduledStart: 'asc' },
        take: 5,
        select: {
          appointmentNumber: true,
          assignedUser: {
            select: { firstName: true, lastName: true },
          },
          id: true,
          job: {
            select: {
              addressLine1: true,
              customer: {
                select: { companyName: true, displayName: true },
              },
              id: true,
              state: true,
              suburb: true,
              title: true,
            },
          },
          scheduledStart: true,
          status: true,
        },
      }),
      this.prisma.appointment.findFirst({
        where: {
          businessId,
          scheduledStart: { gte: new Date() },
          status: { notIn: ['COMPLETED', 'CANCELLED', 'NO_SHOW'] },
        },
        orderBy: { scheduledStart: 'asc' },
        select: {
          assignedUser: {
            select: { firstName: true, lastName: true },
          },
          id: true,
          job: {
            select: {
              customer: {
                select: { companyName: true, displayName: true },
              },
              title: true,
            },
          },
          scheduledStart: true,
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
        upcomingJobs,
        completedToday,
        overdueJobs,
        openJobs,
        todaysAppointments,
        upcomingAppointments,
        completedAppointmentsToday,
        myAppointments,
        lateAppointments,
        upcomingTodayAppointments,
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
        startsAt: job.scheduledStart.toISOString(),
        customerName: job.customer.companyName ?? job.customer.displayName,
        address: [job.addressLine1, job.suburb, job.state]
          .filter(Boolean)
          .join(', '),
      })),
      todayAppointments: todayAppointments.map((appointment) => ({
        address: [
          appointment.job.addressLine1,
          appointment.job.suburb,
          appointment.job.state,
        ]
          .filter(Boolean)
          .join(', '),
        appointmentNumber: appointment.appointmentNumber,
        customerName:
          appointment.job.customer.companyName ??
          appointment.job.customer.displayName,
        id: appointment.id,
        jobId: appointment.job.id,
        jobTitle: appointment.job.title,
        startsAt: appointment.scheduledStart.toISOString(),
        status: appointment.status,
        technicianName: appointment.assignedUser
          ? `${appointment.assignedUser.firstName} ${appointment.assignedUser.lastName}`
          : null,
      })),
      nextAppointment: nextAppointment
        ? {
            customerName:
              nextAppointment.job.customer.companyName ??
              nextAppointment.job.customer.displayName,
            id: nextAppointment.id,
            jobTitle: nextAppointment.job.title,
            startsAt: nextAppointment.scheduledStart.toISOString(),
            technicianName: nextAppointment.assignedUser
              ? `${nextAppointment.assignedUser.firstName} ${nextAppointment.assignedUser.lastName}`
              : null,
          }
        : null,
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
    upcomingJobs?: number;
    completedToday?: number;
    overdueJobs?: number;
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
