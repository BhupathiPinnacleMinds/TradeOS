import { Injectable } from '@nestjs/common';
import type {
  AppointmentRecommendationRequest,
  AppointmentRecommendationResponse,
} from '@tradieos/shared';
import {
  APPOINTMENT_ASSIGNABLE_TECHNICIAN_ROLES,
  getBusinessDayRangeUtc,
  getBusinessDateParts,
} from '@tradieos/shared';
import { PrismaService } from '../prisma/prisma.service';

const WORK_START_HOUR = 7;
const WORK_END_HOUR = 18;

@Injectable()
export class SchedulingService {
  constructor(private readonly prisma: PrismaService) {}

  async recommendTechnician(
    businessId: string,
    input: AppointmentRecommendationRequest,
  ): Promise<AppointmentRecommendationResponse> {
    const scheduledStart = new Date(input.scheduledStart);
    const scheduledEnd = new Date(input.scheduledEnd);

    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { timezone: true },
    });

    if (
      !this.isInsideWorkingHours(
        scheduledStart,
        scheduledEnd,
        business?.timezone,
      )
    ) {
      return {
        recommendedTechnicianId: null,
        technicianName: null,
        reason:
          'The requested appointment time is outside standard working hours.',
      };
    }

    const members = await this.prisma.businessMember.findMany({
      where: {
        businessId,
        role: { in: [...APPOINTMENT_ASSIGNABLE_TECHNICIAN_ROLES] },
        status: 'ACTIVE',
        user: { isActive: true },
        userId: { not: null },
      },
      include: {
        user: {
          select: { firstName: true, id: true, lastName: true },
        },
      },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });

    const candidates = members
      .map((member) => member.user)
      .filter((user): user is NonNullable<typeof user> => Boolean(user));

    if (candidates.length === 0) {
      return {
        recommendedTechnicianId: null,
        technicianName: null,
        reason: 'No active technicians are available in this workspace yet.',
      };
    }

    const conflicts = await this.prisma.appointment.findMany({
      where: {
        businessId,
        assignedUserId: { in: candidates.map((user) => user.id) },
        status: { notIn: ['COMPLETED', 'CANCELLED', 'NO_SHOW'] },
        scheduledStart: { lt: scheduledEnd },
        scheduledEnd: { gt: scheduledStart },
      },
      select: { assignedUserId: true },
    });
    const conflictedUserIds = new Set(
      conflicts
        .map((appointment) => appointment.assignedUserId)
        .filter((id): id is string => Boolean(id)),
    );

    const availableCandidates = candidates.filter(
      (user) => !conflictedUserIds.has(user.id),
    );

    if (!availableCandidates.length) {
      return {
        recommendedTechnicianId: null,
        technicianName: null,
        reason:
          'All eligible technicians already have an appointment at that time.',
      };
    }

    const dayRange = getBusinessDayRangeUtc(scheduledStart, business?.timezone);
    const dayAppointments = await this.prisma.appointment.findMany({
      where: {
        assignedUserId: { in: availableCandidates.map((user) => user.id) },
        businessId,
        scheduledStart: { gte: dayRange.start, lt: dayRange.end },
        status: { notIn: ['COMPLETED', 'CANCELLED', 'NO_SHOW'] },
      },
      select: {
        assignedUserId: true,
        scheduledEnd: true,
        scheduledStart: true,
      },
    });

    const workloadMinutes = new Map<string, number>();
    for (const appointment of dayAppointments) {
      if (!appointment.assignedUserId) continue;
      workloadMinutes.set(
        appointment.assignedUserId,
        (workloadMinutes.get(appointment.assignedUserId) ?? 0) +
          Math.max(
            0,
            Math.round(
              (appointment.scheduledEnd.getTime() -
                appointment.scheduledStart.getTime()) /
                60_000,
            ),
          ),
      );
    }

    const ranked = [...availableCandidates].sort(
      (left, right) =>
        (workloadMinutes.get(left.id) ?? 0) -
          (workloadMinutes.get(right.id) ?? 0) ||
        `${left.firstName} ${left.lastName}`.localeCompare(
          `${right.firstName} ${right.lastName}`,
        ) ||
        left.id.localeCompare(right.id),
    );
    const recommended = ranked[0];
    const recommendedWorkload = workloadMinutes.get(recommended.id) ?? 0;

    return {
      recommendedTechnicianId: recommended.id,
      technicianName: `${recommended.firstName} ${recommended.lastName}`,
      reason: `${recommended.firstName} ${recommended.lastName} is available with no overlapping appointment and has ${recommendedWorkload} scheduled minutes that day.`,
    };
  }

  private isInsideWorkingHours(start: Date, end: Date, timezone?: string) {
    const startParts = getBusinessDateParts(start, timezone);
    const endParts = getBusinessDateParts(end, timezone);
    const startMinutes = startParts.hour * 60 + startParts.minute;
    const endMinutes = endParts.hour * 60 + endParts.minute;

    return (
      start < end &&
      startMinutes >= WORK_START_HOUR * 60 &&
      endMinutes <= WORK_END_HOUR * 60 &&
      startParts.year === endParts.year &&
      startParts.month === endParts.month &&
      startParts.day === endParts.day
    );
  }
}
