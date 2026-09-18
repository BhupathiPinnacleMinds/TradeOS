import { Injectable } from '@nestjs/common';
import type {
  AppointmentConflict,
  AppointmentStatus,
  AppointmentRecommendationRequest,
  AppointmentRecommendationResponse,
} from '@tradieos/shared';
import {
  addDaysToDateOnly,
  createShiftInterval,
  FIELD_ASSIGNABLE_APPOINTMENT_ROLES,
  formatDateOnlyForDisplay,
  formatMemberShiftTimeRange,
  getBusinessDateParts,
  getBusinessDayRangeUtc,
  normaliseBusinessTimezone,
} from '@tradieos/shared';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_BUSINESS_START_TIME = '07:00';
const DEFAULT_BUSINESS_END_TIME = '18:00';
const CLOSED_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
];
const MINUTES_PER_DAY = 24 * 60;

type AvailabilityReasonCode =
  | 'APPOINTMENT_CONFLICT'
  | 'NO_TECHNICIAN'
  | 'ON_LEAVE'
  | 'OUTSIDE_BUSINESS_HOURS'
  | 'OUTSIDE_SHIFT';

type AvailabilityReason = {
  canOverride: boolean;
  code: AvailabilityReasonCode;
  message: string;
};

export type TechnicianAvailabilityResult = {
  available: boolean;
  canOverride: boolean;
  conflicts: AppointmentConflict[];
  hasConflict: boolean;
  reason: string;
  reasons: AvailabilityReason[];
};

@Injectable()
export class SchedulingService {
  constructor(private readonly prisma: PrismaService) {}

  async checkTechnicianAvailability(
    businessId: string,
    input: {
      assignedUserId: string | null;
      scheduledStart: Date;
      scheduledEnd: Date;
      excludeAppointmentId?: string;
    },
  ): Promise<TechnicianAvailabilityResult> {
    const business = await this.prisma.business.findUnique({
      select: {
        businessEndTime: true,
        businessStartTime: true,
        timezone: true,
      },
      where: { id: businessId },
    });
    const timezone = normaliseBusinessTimezone(business?.timezone);
    const reasons: AvailabilityReason[] = [];

    if (
      !this.isInsideBusinessHours({
        businessEndTime: business?.businessEndTime ?? DEFAULT_BUSINESS_END_TIME,
        businessStartTime:
          business?.businessStartTime ?? DEFAULT_BUSINESS_START_TIME,
        end: input.scheduledEnd,
        start: input.scheduledStart,
        timezone,
      })
    ) {
      reasons.push({
        canOverride: true,
        code: 'OUTSIDE_BUSINESS_HOURS',
        message: 'Appointment is outside business working hours.',
      });
    }

    if (!input.assignedUserId) {
      return this.availabilityResult(
        reasons.length
          ? reasons
          : [
              {
                canOverride: true,
                code: 'NO_TECHNICIAN',
                message: 'No technician assigned yet.',
              },
            ],
        [],
        reasons.length === 0,
      );
    }

    const member = await this.prisma.businessMember.findFirst({
      include: {
        user: {
          select: { firstName: true, lastName: true },
        },
      },
      where: {
        businessId,
        role: { in: [...FIELD_ASSIGNABLE_APPOINTMENT_ROLES] },
        status: 'ACTIVE',
        user: { id: input.assignedUserId, isActive: true },
        userId: input.assignedUserId,
      },
    });
    const technicianName = member?.user
      ? `${member.user.firstName} ${member.user.lastName}`
      : 'Technician';

    if (member) {
      const appointmentDates = this.businessDatesTouched(
        input.scheduledStart,
        input.scheduledEnd,
        timezone,
      );
      const firstDate = appointmentDates[0];
      const lastDate = appointmentDates[appointmentDates.length - 1];

      const [leave, shifts] = await Promise.all([
        this.prisma.memberLeave.findMany({
          where: {
            businessId,
            endDate: { gte: firstDate },
            memberId: member.id,
            startDate: { lte: lastDate },
            status: 'ACTIVE',
          },
        }),
        this.prisma.memberShift.findMany({
          orderBy: [{ shiftDate: 'asc' }, { startTime: 'asc' }],
          where: {
            businessId,
            memberId: member.id,
            shiftDate: {
              gte: addDaysToDateOnly(firstDate, -1),
              lte: lastDate,
            },
            status: 'ACTIVE',
          },
        }),
      ]);

      const leaveDate = appointmentDates.find((date) =>
        leave.some(
          (record) => record.startDate <= date && record.endDate >= date,
        ),
      );
      if (leaveDate) {
        reasons.push({
          canOverride: false,
          code: 'ON_LEAVE',
          message: `${technicianName} is on leave on ${formatDateOnlyForDisplay(
            leaveDate,
          )}.`,
        });
      }

      const relevantShifts = this.relevantShiftsForAppointment(
        input.scheduledStart,
        input.scheduledEnd,
        timezone,
        shifts,
      );
      if (
        relevantShifts.length > 0 &&
        !this.appointmentFitsInsideShift(
          input.scheduledStart,
          input.scheduledEnd,
          timezone,
          relevantShifts,
        )
      ) {
        reasons.push({
          canOverride: true,
          code: 'OUTSIDE_SHIFT',
          message: `${technicianName} is outside their scheduled shift (${relevantShifts
            .map((shift) => formatMemberShiftTimeRange(shift))
            .join(', ')}).`,
        });
      }
    }

    const conflictWhere: Prisma.AppointmentWhereInput = {
      OR: [
        { assignedUserId: input.assignedUserId },
        { crewAssignments: { some: { userId: input.assignedUserId } } },
      ],
      businessId,
      scheduledEnd: { gt: input.scheduledStart },
      scheduledStart: { lt: input.scheduledEnd },
      status: { notIn: CLOSED_APPOINTMENT_STATUSES },
    };
    if (input.excludeAppointmentId) {
      conflictWhere.id = { not: input.excludeAppointmentId };
    }

    const conflicts = await this.prisma.appointment.findMany({
      include: {
        assignedUser: {
          select: { firstName: true, lastName: true },
        },
        job: { select: { title: true } },
      },
      where: conflictWhere,
    });
    const mappedConflicts = conflicts.map((conflict) => ({
      appointmentNumber: conflict.appointmentNumber,
      id: conflict.id,
      jobTitle: conflict.job.title,
      scheduledEnd: conflict.scheduledEnd.toISOString(),
      scheduledStart: conflict.scheduledStart.toISOString(),
      technicianName,
    }));

    if (mappedConflicts.length > 0) {
      reasons.push({
        canOverride: true,
        code: 'APPOINTMENT_CONFLICT',
        message: 'Technician already has an overlapping appointment.',
      });
    }

    return this.availabilityResult(reasons, mappedConflicts);
  }

  async recommendTechnician(
    businessId: string,
    input: AppointmentRecommendationRequest,
  ): Promise<AppointmentRecommendationResponse> {
    const scheduledStart = new Date(input.scheduledStart);
    const scheduledEnd = new Date(input.scheduledEnd);

    const members = await this.prisma.businessMember.findMany({
      include: {
        user: {
          select: { firstName: true, id: true, lastName: true },
        },
      },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      where: {
        businessId,
        role: { in: [...FIELD_ASSIGNABLE_APPOINTMENT_ROLES] },
        status: 'ACTIVE',
        user: { isActive: true },
        userId: { not: null },
      },
    });

    const candidates = members
      .map((member) => member.user)
      .filter((user): user is NonNullable<typeof user> => Boolean(user));

    if (candidates.length === 0) {
      return {
        reason: 'No active technicians are available in this workspace yet.',
        recommendedTechnicianId: null,
        technicianName: null,
      };
    }

    const availabilityEntries = await Promise.all(
      candidates.map(
        async (user) =>
          [
            user.id,
            await this.checkTechnicianAvailability(businessId, {
              assignedUserId: user.id,
              scheduledEnd,
              scheduledStart,
            }),
          ] as const,
      ),
    );
    const availabilityByUser = new Map(availabilityEntries);
    const availableCandidates = candidates.filter(
      (user) => availabilityByUser.get(user.id)?.available,
    );

    if (!availableCandidates.length) {
      const firstUnavailable = candidates
        .map((user) => availabilityByUser.get(user.id))
        .find((availability) => availability?.reason);
      return {
        reason:
          firstUnavailable?.reason ??
          'No eligible technicians are available at that time.',
        recommendedTechnicianId: null,
        technicianName: null,
      };
    }

    const business = await this.prisma.business.findUnique({
      select: { timezone: true },
      where: { id: businessId },
    });
    const dayRange = getBusinessDayRangeUtc(scheduledStart, business?.timezone);
    const dayAppointments = await this.prisma.appointment.findMany({
      select: {
        assignedUserId: true,
        crewAssignments: { select: { userId: true } },
        scheduledEnd: true,
        scheduledStart: true,
      },
      where: {
        OR: [
          {
            assignedUserId: { in: availableCandidates.map((user) => user.id) },
          },
          {
            crewAssignments: {
              some: {
                userId: { in: availableCandidates.map((user) => user.id) },
              },
            },
          },
        ],
        businessId,
        scheduledStart: { gte: dayRange.start, lt: dayRange.end },
        status: { notIn: CLOSED_APPOINTMENT_STATUSES },
      },
    });

    const workloadMinutes = new Map<string, number>();
    for (const appointment of dayAppointments) {
      for (const userId of new Set(
        appointment.crewAssignments?.length
          ? appointment.crewAssignments.map((assignment) => assignment.userId)
          : appointment.assignedUserId
            ? [appointment.assignedUserId]
            : [],
      )) {
        workloadMinutes.set(
          userId,
          (workloadMinutes.get(userId) ?? 0) +
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
      reason: `${recommended.firstName} ${recommended.lastName} is available with no overlapping appointment and has ${recommendedWorkload} scheduled minutes that day.`,
      recommendedTechnicianId: recommended.id,
      technicianName: `${recommended.firstName} ${recommended.lastName}`,
    };
  }

  private availabilityResult(
    reasons: AvailabilityReason[],
    conflicts: AppointmentConflict[],
    forceAvailable?: boolean,
  ): TechnicianAvailabilityResult {
    const blockingReasons =
      forceAvailable === true
        ? []
        : reasons.filter((reason) => reason.code !== 'NO_TECHNICIAN');
    const available = forceAvailable ?? blockingReasons.length === 0;
    const canOverride =
      !available &&
      blockingReasons.length > 0 &&
      blockingReasons.every((reason) => reason.canOverride);

    return {
      available,
      canOverride,
      conflicts,
      hasConflict: !available,
      reason:
        reasons[0]?.message ?? 'Technician is available for this appointment.',
      reasons,
    };
  }

  private isInsideBusinessHours({
    businessEndTime,
    businessStartTime,
    end,
    start,
    timezone,
  }: {
    businessEndTime: string;
    businessStartTime: string;
    end: Date;
    start: Date;
    timezone: string;
  }) {
    if (end <= start) return false;
    const interval = this.localAppointmentInterval(start, end, timezone);
    const appointmentDate = this.dateOnly(start, timezone);
    const possibleWindowDates = [
      addDaysToDateOnly(appointmentDate, -1),
      appointmentDate,
    ];

    return possibleWindowDates.some((date) =>
      this.windowContainsInterval(
        {
          date,
          endTime: businessEndTime,
          startTime: businessStartTime,
        },
        interval,
      ),
    );
  }

  private appointmentFitsInsideShift(
    start: Date,
    end: Date,
    timezone: string,
    shifts: Array<{
      endTime: string;
      shiftDate: string;
      startTime: string;
    }>,
  ) {
    const interval = this.localAppointmentInterval(start, end, timezone);
    return shifts.some((shift) =>
      this.windowContainsInterval(
        {
          date: shift.shiftDate,
          endTime: shift.endTime,
          startTime: shift.startTime,
        },
        interval,
      ),
    );
  }

  private relevantShiftsForAppointment(
    start: Date,
    end: Date,
    timezone: string,
    shifts: Array<{
      endTime: string;
      shiftDate: string;
      startTime: string;
    }>,
  ) {
    const appointmentDates = this.businessDatesTouched(start, end, timezone);
    const appointmentDateSet = new Set(appointmentDates);
    const appointmentInterval = this.localAppointmentInterval(
      start,
      end,
      timezone,
    );

    return shifts.filter((shift) => {
      if (appointmentDateSet.has(shift.shiftDate)) return true;

      const shiftInterval = createShiftInterval({
        endTime: shift.endTime,
        shiftDate: shift.shiftDate,
        startTime: shift.startTime,
      });
      const isOvernight = shift.endTime <= shift.startTime;
      return (
        isOvernight &&
        shiftInterval.start < appointmentInterval.end &&
        shiftInterval.end > appointmentInterval.start
      );
    });
  }

  private windowContainsInterval(
    window: { date: string; endTime: string; startTime: string },
    interval: { end: number; start: number },
  ) {
    const windowInterval = createShiftInterval({
      endTime: window.endTime,
      shiftDate: window.date,
      startTime: window.startTime,
    });
    return (
      interval.start >= windowInterval.start &&
      interval.end <= windowInterval.end
    );
  }

  private localAppointmentInterval(start: Date, end: Date, timezone: string) {
    const startParts = getBusinessDateParts(start, timezone);
    const endParts = getBusinessDateParts(end, timezone);
    return {
      end:
        this.dateOnlyOrdinal(this.dateOnlyFromParts(endParts)) *
          MINUTES_PER_DAY +
        endParts.hour * 60 +
        endParts.minute,
      start:
        this.dateOnlyOrdinal(this.dateOnlyFromParts(startParts)) *
          MINUTES_PER_DAY +
        startParts.hour * 60 +
        startParts.minute,
    };
  }

  private businessDatesTouched(start: Date, end: Date, timezone: string) {
    const startDate = this.dateOnly(start, timezone);
    const inclusiveEnd = new Date(Math.max(start.getTime(), end.getTime() - 1));
    const endDate = this.dateOnly(inclusiveEnd, timezone);
    const dates = [startDate];
    let cursor = startDate;
    while (cursor < endDate) {
      cursor = addDaysToDateOnly(cursor, 1);
      dates.push(cursor);
    }
    return dates;
  }

  private dateOnly(date: Date, timezone: string) {
    return this.dateOnlyFromParts(getBusinessDateParts(date, timezone));
  }

  private dateOnlyFromParts(parts: {
    day: number;
    month: number;
    year: number;
  }) {
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(
      parts.day,
    ).padStart(2, '0')}`;
  }

  private dateOnlyOrdinal(value: string): number {
    const [year, month, day] = value.split('-').map(Number);
    return Math.floor(
      Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) /
        (MINUTES_PER_DAY * 60 * 1000),
    );
  }
}
