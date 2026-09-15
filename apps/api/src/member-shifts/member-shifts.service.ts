import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type {
  AuthenticatedUser,
  MemberShift,
  MemberShiftListResponse,
  MemberShiftPayload,
  MemberShiftQuery,
  MemberShiftResponse,
} from '@tradieos/shared';
import {
  addDaysToDateOnly,
  formatDateOnlyForDisplay,
  formatMemberShiftTimeRange,
  getBusinessDateParts,
  getMemberShiftDates,
  isDateOnly,
  isShiftWithinBusinessHours,
  memberShiftIntervalsOverlap,
  normaliseBusinessTimezone,
  shiftOverlapsMemberLeave,
  validateMemberShiftPayload,
} from '@tradieos/shared';
import type { Prisma } from '../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

type ShiftRecord = Prisma.MemberShiftGetPayload<{
  include: {
    member: {
      include: { user: true };
    };
  };
}>;

type MemberRecord = Prisma.BusinessMemberGetPayload<{
  include: { user: true };
}>;

type BusinessHoursRecord = {
  businessEndTime: string;
  businessStartTime: string;
  timezone: string | null;
};

@Injectable()
export class MemberShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async findTeamShifts(
    currentUser: AuthenticatedUser,
    query: MemberShiftQuery = {},
  ): Promise<MemberShiftListResponse> {
    await this.ownerMembership(currentUser);
    const { fromDate, memberId, toDate } = await this.normaliseQuery(
      currentUser.businessId,
      query,
    );

    const records = await this.prisma.memberShift.findMany({
      include: shiftInclude,
      orderBy: [{ shiftDate: 'asc' }, { startTime: 'asc' }],
      where: {
        businessId: currentUser.businessId,
        member: { status: 'ACTIVE' },
        memberId: memberId ?? undefined,
        shiftDate: { gte: fromDate, lte: toDate },
        status: 'ACTIVE',
      },
    });

    return { records: records.map((record) => this.toMemberShift(record)) };
  }

  async createTeamShift(
    currentUser: AuthenticatedUser,
    dto: MemberShiftPayload,
  ): Promise<MemberShiftResponse> {
    const owner = await this.ownerMembership(currentUser);
    const member = await this.activeTargetMember(
      currentUser.businessId,
      dto.memberId,
    );
    const payload = await this.normaliseAndValidatePayload(
      currentUser.businessId,
      dto,
    );
    await this.assertNoLeaveOverlap(currentUser.businessId, member.id, payload);
    await this.assertNoShiftOverlap(currentUser.businessId, member.id, payload);

    const shift = await this.prisma.memberShift.create({
      data: {
        businessId: currentUser.businessId,
        createdByMemberId: owner.id,
        endTime: payload.endTime,
        memberId: member.id,
        note: this.cleanNote(payload.note),
        shiftDate: payload.shiftDate,
        startTime: payload.startTime,
      },
      include: shiftInclude,
    });

    await this.notifyMember(currentUser, shift, 'created');
    return { shift: this.toMemberShift(shift) };
  }

  async updateTeamShift(
    currentUser: AuthenticatedUser,
    shiftId: string,
    dto: MemberShiftPayload,
  ): Promise<MemberShiftResponse> {
    await this.ownerMembership(currentUser);
    const existing = await this.findActiveShift(
      currentUser.businessId,
      shiftId,
    );
    const member = await this.activeTargetMember(
      currentUser.businessId,
      dto.memberId,
    );
    const payload = await this.normaliseAndValidatePayload(
      currentUser.businessId,
      dto,
    );
    await this.assertNoLeaveOverlap(currentUser.businessId, member.id, payload);
    await this.assertNoShiftOverlap(
      currentUser.businessId,
      member.id,
      payload,
      existing.id,
    );

    const shift = await this.prisma.memberShift.update({
      data: {
        endTime: payload.endTime,
        memberId: member.id,
        note: this.cleanNote(payload.note),
        shiftDate: payload.shiftDate,
        startTime: payload.startTime,
      },
      include: shiftInclude,
      where: { id: existing.id },
    });

    await this.notifyMember(currentUser, shift, 'updated');
    return { shift: this.toMemberShift(shift) };
  }

  async cancelTeamShift(
    currentUser: AuthenticatedUser,
    shiftId: string,
  ): Promise<MemberShiftResponse> {
    await this.ownerMembership(currentUser);
    const existing = await this.findActiveShift(
      currentUser.businessId,
      shiftId,
    );

    const shift = await this.prisma.memberShift.update({
      data: {
        cancelledAt: new Date(),
        status: 'CANCELLED',
      },
      include: shiftInclude,
      where: { id: existing.id },
    });

    await this.notifyMember(currentUser, shift, 'cancelled');
    return { shift: this.toMemberShift(shift) };
  }

  private async ownerMembership(
    currentUser: AuthenticatedUser,
  ): Promise<MemberRecord> {
    if (currentUser.role !== 'OWNER') {
      throw this.domainError(
        HttpStatus.FORBIDDEN,
        'INSUFFICIENT_PERMISSION',
        'Only owners can manage team shifts.',
      );
    }

    const member = await this.prisma.businessMember.findFirst({
      include: { user: true },
      where: {
        businessId: currentUser.businessId,
        status: 'ACTIVE',
        userId: currentUser.id,
      },
    });

    if (!member) {
      throw this.domainError(
        HttpStatus.FORBIDDEN,
        'MEMBERSHIP_INACTIVE',
        'Your workspace membership is not active.',
      );
    }

    return member;
  }

  private async activeTargetMember(businessId: string, memberId: string) {
    const member = await this.prisma.businessMember.findFirst({
      include: { user: true },
      where: {
        businessId,
        id: memberId,
        status: 'ACTIVE',
      },
    });

    if (!member) {
      throw this.domainError(
        HttpStatus.NOT_FOUND,
        'MEMBER_NOT_FOUND',
        'Active team member not found.',
      );
    }

    return member;
  }

  private async findActiveShift(businessId: string, shiftId: string) {
    const shift = await this.prisma.memberShift.findFirst({
      where: {
        businessId,
        id: shiftId,
        status: 'ACTIVE',
      },
    });

    if (!shift) {
      throw this.domainError(
        HttpStatus.NOT_FOUND,
        'SHIFT_NOT_FOUND',
        'Shift not found.',
      );
    }

    return shift;
  }

  private async normaliseAndValidatePayload(
    businessId: string,
    dto: MemberShiftPayload,
  ): Promise<MemberShiftPayload> {
    const payload = {
      endTime: dto.endTime.trim(),
      memberId: dto.memberId.trim(),
      note: dto.note,
      shiftDate: dto.shiftDate.trim(),
      startTime: dto.startTime.trim(),
    };
    const validationError = validateMemberShiftPayload(payload);

    if (validationError) {
      throw this.domainError(
        HttpStatus.BAD_REQUEST,
        'INVALID_SHIFT',
        validationError,
      );
    }

    const business = await this.businessHours(businessId);
    if (
      !isShiftWithinBusinessHours({
        businessEndTime: business.businessEndTime,
        businessStartTime: business.businessStartTime,
        shift: payload,
      })
    ) {
      throw this.domainError(
        HttpStatus.BAD_REQUEST,
        'SHIFT_OUTSIDE_BUSINESS_HOURS',
        'Shift must fall within business operating hours.',
      );
    }

    return payload;
  }

  private async assertNoLeaveOverlap(
    businessId: string,
    memberId: string,
    payload: MemberShiftPayload,
  ) {
    const dates = getMemberShiftDates(payload);
    const leaves = await this.prisma.memberLeave.findMany({
      where: {
        businessId,
        endDate: { gte: dates[0] },
        memberId,
        startDate: { lte: dates[dates.length - 1] },
        status: 'ACTIVE',
      },
    });

    if (shiftOverlapsMemberLeave(payload, leaves)) {
      throw this.domainError(
        HttpStatus.CONFLICT,
        'SHIFT_OVERLAPS_LEAVE',
        'This team member is on leave for the selected shift date.',
      );
    }
  }

  private async assertNoShiftOverlap(
    businessId: string,
    memberId: string,
    payload: MemberShiftPayload,
    excludeShiftId?: string,
  ) {
    const dates = getMemberShiftDates(payload);
    const existing = await this.prisma.memberShift.findMany({
      where: {
        businessId,
        id: excludeShiftId ? { not: excludeShiftId } : undefined,
        memberId,
        shiftDate: {
          gte: addDaysToDateOnly(payload.shiftDate, -1),
          lte: addDaysToDateOnly(dates[dates.length - 1], 1),
        },
        status: 'ACTIVE',
      },
    });

    if (existing.some((shift) => memberShiftIntervalsOverlap(payload, shift))) {
      throw this.domainError(
        HttpStatus.CONFLICT,
        'SHIFT_OVERLAP',
        'This shift overlaps an existing active shift for the team member.',
      );
    }
  }

  private async businessHours(
    businessId: string,
  ): Promise<BusinessHoursRecord> {
    const business = await this.prisma.business.findUnique({
      select: {
        businessEndTime: true,
        businessStartTime: true,
        timezone: true,
      },
      where: { id: businessId },
    });

    if (!business) {
      throw this.domainError(
        HttpStatus.NOT_FOUND,
        'BUSINESS_NOT_FOUND',
        'Workspace not found.',
      );
    }

    return business;
  }

  private async normaliseQuery(businessId: string, query: MemberShiftQuery) {
    const business = await this.businessHours(businessId);
    const timezone = normaliseBusinessTimezone(business.timezone);
    const todayParts = getBusinessDateParts(new Date(), timezone);
    const today = `${todayParts.year}-${String(todayParts.month).padStart(
      2,
      '0',
    )}-${String(todayParts.day).padStart(2, '0')}`;
    const fromDate = (query.fromDate ?? query.date ?? today).trim();
    const toDate = (query.toDate ?? query.date ?? fromDate).trim();

    if (!isDateOnly(fromDate) || !isDateOnly(toDate) || toDate < fromDate) {
      throw this.domainError(
        HttpStatus.BAD_REQUEST,
        'INVALID_SHIFT_QUERY',
        'Shift query dates must use YYYY-MM-DD and end on or after start.',
      );
    }

    return {
      fromDate,
      memberId: query.memberId?.trim() || null,
      toDate,
    };
  }

  private async notifyMember(
    actor: AuthenticatedUser,
    shift: ShiftRecord,
    action: 'cancelled' | 'created' | 'updated',
  ) {
    if (!shift.member.userId || shift.member.userId === actor.id) return;

    const range = formatMemberShiftTimeRange(shift);
    const date = formatDateOnlyForDisplay(shift.shiftDate);
    const title =
      action === 'created'
        ? 'Shift scheduled'
        : action === 'updated'
          ? 'Shift updated'
          : 'Shift cancelled';
    const body =
      action === 'created'
        ? `You are scheduled for ${date}, ${range}.`
        : action === 'updated'
          ? `Your shift was updated to ${date}, ${range}.`
          : `Your shift for ${date}, ${range} was cancelled.`;

    await this.notifications.create({
      body,
      businessId: actor.businessId,
      entityId: shift.id,
      entityType: 'team_shift',
      metadata: {
        memberId: shift.memberId,
        shiftDate: shift.shiftDate,
        shiftId: shift.id,
      },
      title,
      type: 'TEAM_SHIFT',
      userId: shift.member.userId,
    });
  }

  private toMemberShift(record: ShiftRecord): MemberShift {
    return {
      businessId: record.businessId,
      cancelledAt: record.cancelledAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      createdByMemberId: record.createdByMemberId,
      endTime: record.endTime,
      id: record.id,
      memberEmail: record.member.user?.email ?? record.member.invitedEmail,
      memberId: record.memberId,
      memberName: this.memberName(record.member),
      note: record.note,
      shiftDate: record.shiftDate,
      startTime: record.startTime,
      status: record.status,
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private memberName(member: {
    invitedEmail: string;
    invitedFirstName: string | null;
    invitedLastName: string | null;
    user?: { firstName: string; lastName: string } | null;
  }) {
    const first = member.user?.firstName ?? member.invitedFirstName ?? '';
    const last = member.user?.lastName ?? member.invitedLastName ?? '';
    return `${first} ${last}`.trim() || member.invitedEmail;
  }

  private cleanNote(value: string | null | undefined) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private domainError(status: HttpStatus, code: string, message: string) {
    return new HttpException({ code, message }, status);
  }
}

const shiftInclude = {
  member: {
    include: { user: true },
  },
} as const;
