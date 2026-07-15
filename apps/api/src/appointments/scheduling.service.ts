import { Injectable } from '@nestjs/common';
import type {
  AppointmentRecommendationRequest,
  AppointmentRecommendationResponse,
} from '@tradieos/shared';
import { PrismaService } from '../prisma/prisma.service';

const TECHNICIAN_ROLES = ['TECHNICIAN', 'OWNER', 'ADMIN'] as const;
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

    if (!this.isInsideWorkingHours(scheduledStart, scheduledEnd)) {
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
        role: { in: [...TECHNICIAN_ROLES] },
        status: 'ACTIVE',
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

    const recommended =
      candidates.find((user) => !conflictedUserIds.has(user.id)) ?? null;

    if (!recommended) {
      return {
        recommendedTechnicianId: null,
        technicianName: null,
        reason:
          'All available technicians already have an appointment at that time.',
      };
    }

    return {
      recommendedTechnicianId: recommended.id,
      technicianName: `${recommended.firstName} ${recommended.lastName}`,
      reason:
        'Closest available technician with no scheduling conflict. Travel time will be refined when route planning is added.',
    };
  }

  private isInsideWorkingHours(start: Date, end: Date) {
    return (
      start < end &&
      start.getHours() >= WORK_START_HOUR &&
      end.getHours() <= WORK_END_HOUR
    );
  }
}
