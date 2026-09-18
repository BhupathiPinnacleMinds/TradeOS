import { Injectable } from '@nestjs/common';
import type {
  Appointment,
  AppointmentAvailabilityConflict,
} from '@tradieos/shared';
import {
  addDaysToDateOnly,
  getBusinessDateSpan,
  normaliseBusinessTimezone,
  zonedTimeToUtc,
} from '@tradieos/shared';
import { PrismaService } from '../prisma/prisma.service';

const TERMINAL_STATUSES = [
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
] as const;

function dateParts(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

@Injectable()
export class AppointmentAttentionService {
  constructor(private readonly prisma: PrismaService) {}

  async decorate(businessId: string, appointments: Appointment[]) {
    if (!appointments.length) return appointments;
    const business = await this.prisma.business.findUnique({
      select: { timezone: true },
      where: { id: businessId },
    });
    const timezone = normaliseBusinessTimezone(business?.timezone);
    const active = appointments.filter(
      (appointment) => !TERMINAL_STATUSES.includes(appointment.status as never),
    );
    const spans = active.map((appointment) => ({
      appointment,
      span: getBusinessDateSpan(
        appointment.scheduledStart,
        appointment.scheduledEnd,
        timezone,
      ),
    }));
    const userIds = [
      ...new Set(
        active.flatMap((appointment) =>
          appointment.technicians.length
            ? appointment.technicians.map((user) => user.id)
            : appointment.assignedUserId
              ? [appointment.assignedUserId]
              : [],
        ),
      ),
    ];
    if (!userIds.length) {
      return appointments.map((appointment) => ({
        ...appointment,
        availabilityConflict: null,
      }));
    }
    const leaves = await this.prisma.memberLeave.findMany({
      select: {
        endDate: true,
        member: { select: { userId: true } },
        startDate: true,
        type: true,
      },
      where: {
        businessId,
        endDate: { gte: spans.map(({ span }) => span.startDate).sort()[0] },
        member: { status: 'ACTIVE', userId: { in: userIds } },
        startDate: {
          lte: spans
            .map(({ span }) => span.endDate)
            .sort()
            .at(-1),
        },
        status: 'ACTIVE',
      },
    });
    const conflicts = new Map<string, AppointmentAvailabilityConflict>();
    for (const { appointment, span } of spans) {
      const crew = appointment.technicians.length
        ? appointment.technicians
        : appointment.assignedUser
          ? [appointment.assignedUser]
          : [];
      const unavailable = crew.flatMap((user) => {
        const leave = leaves.find(
          (entry) =>
            entry.member.userId === user.id &&
            entry.startDate <= span.endDate &&
            entry.endDate >= span.startDate,
        );
        return leave
          ? [
              {
                id: user.id,
                name: [user.firstName, user.lastName].filter(Boolean).join(' '),
                leaveType: leave.type,
                leaveStart: leave.startDate,
                leaveEnd: leave.endDate,
              },
            ]
          : [];
      });
      if (unavailable.length) {
        conflicts.set(appointment.id, {
          requiresAttention: true,
          technicians: unavailable,
        });
      }
    }
    return appointments.map((appointment) => ({
      ...appointment,
      availabilityConflict: conflicts.get(appointment.id) ?? null,
    }));
  }

  async affectedAppointmentsForLeave(input: {
    businessId: string;
    userId: string;
    startDate: string;
    endDate: string;
  }) {
    const business = await this.prisma.business.findUnique({
      select: { timezone: true },
      where: { id: input.businessId },
    });
    const timezone = normaliseBusinessTimezone(business?.timezone);
    const start = zonedTimeToUtc(dateParts(input.startDate), timezone);
    const end = zonedTimeToUtc(
      dateParts(addDaysToDateOnly(input.endDate, 1)),
      timezone,
    );
    const candidates = await this.prisma.appointment.findMany({
      select: {
        id: true,
        job: { select: { title: true } },
        scheduledStart: true,
        scheduledEnd: true,
      },
      where: {
        businessId: input.businessId,
        OR: [
          { assignedUserId: input.userId },
          { crewAssignments: { some: { userId: input.userId } } },
        ],
        scheduledEnd: { gt: start },
        scheduledStart: { lt: end },
        status: { notIn: [...TERMINAL_STATUSES] },
      },
    });
    return candidates.filter((appointment) => {
      const span = getBusinessDateSpan(
        appointment.scheduledStart,
        appointment.scheduledEnd,
        timezone,
      );
      return span.startDate <= input.endDate && span.endDate >= input.startDate;
    });
  }
}
