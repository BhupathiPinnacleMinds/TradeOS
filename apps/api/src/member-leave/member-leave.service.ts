import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type {
  AuthenticatedUser,
  MemberLeave,
  MemberLeaveListResponse,
  MemberLeavePayload,
  MemberLeaveResponse,
} from '@tradieos/shared';
import {
  APPOINTMENT_WRITE_ROLES,
  formatBusinessTime,
  formatMemberLeaveDateRange,
  formatMemberLeaveType,
  getBusinessDateParts,
  memberLeaveRangesOverlap,
  normaliseBusinessTimezone,
  validateMemberLeaveRange,
} from '@tradieos/shared';
import { AppointmentAttentionService } from '../appointments/appointment-attention.service';
import type { Prisma } from '../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const OWNER_ROLES = ['OWNER'] as const;

type LeaveRecord = Prisma.MemberLeaveGetPayload<{
  include: {
    member: {
      include: { user: true };
    };
  };
}>;

type MemberRecord = Prisma.BusinessMemberGetPayload<{
  include: { user: true };
}>;

@Injectable()
export class MemberLeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly attention: AppointmentAttentionService,
  ) {}

  async findOwnLeave(
    currentUser: AuthenticatedUser,
  ): Promise<MemberLeaveListResponse> {
    const member = await this.activeMembership(currentUser);
    const records = await this.prisma.memberLeave.findMany({
      include: leaveInclude,
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
      where: {
        businessId: currentUser.businessId,
        memberId: member.id,
      },
    });

    return { records: records.map((record) => this.toMemberLeave(record)) };
  }

  async createOwnLeave(
    currentUser: AuthenticatedUser,
    dto: MemberLeavePayload,
  ): Promise<MemberLeaveResponse> {
    const member = await this.activeMembership(currentUser);
    const payload = this.normalisePayload(dto);
    await this.assertNoOverlap(currentUser.businessId, member.id, payload);

    const leave = await this.prisma.memberLeave.create({
      data: {
        businessId: currentUser.businessId,
        endDate: payload.endDate,
        memberId: member.id,
        note: this.cleanNote(payload.note),
        startDate: payload.startDate,
        type: payload.type,
      },
      include: leaveInclude,
    });

    await this.notifyOwners(currentUser, leave, 'created');
    await this.notifyNewAppointmentConflicts(currentUser, leave, new Set());
    return { leave: this.toMemberLeave(leave) };
  }

  async updateOwnLeave(
    currentUser: AuthenticatedUser,
    leaveId: string,
    dto: MemberLeavePayload,
  ): Promise<MemberLeaveResponse> {
    const member = await this.activeMembership(currentUser);
    const existing = await this.findOwnActiveLeave(
      currentUser.businessId,
      member.id,
      leaveId,
    );
    const payload = this.normalisePayload(dto);
    const previousConflicts = await this.attention.affectedAppointmentsForLeave(
      {
        businessId: currentUser.businessId,
        userId: currentUser.id,
        startDate: existing.startDate,
        endDate: existing.endDate,
      },
    );
    await this.assertNoOverlap(
      currentUser.businessId,
      member.id,
      payload,
      existing.id,
    );

    const leave = await this.prisma.memberLeave.update({
      data: {
        endDate: payload.endDate,
        note: this.cleanNote(payload.note),
        startDate: payload.startDate,
        type: payload.type,
      },
      include: leaveInclude,
      where: { id: existing.id },
    });

    await this.notifyOwners(currentUser, leave, 'updated');
    await this.notifyNewAppointmentConflicts(
      currentUser,
      leave,
      existing.type === leave.type
        ? new Set(previousConflicts.map((appointment) => appointment.id))
        : new Set(),
    );
    return { leave: this.toMemberLeave(leave) };
  }

  async cancelOwnLeave(
    currentUser: AuthenticatedUser,
    leaveId: string,
  ): Promise<MemberLeaveResponse> {
    const member = await this.activeMembership(currentUser);
    const existing = await this.findOwnActiveLeave(
      currentUser.businessId,
      member.id,
      leaveId,
    );

    const leave = await this.prisma.memberLeave.update({
      data: {
        cancelledAt: new Date(),
        status: 'CANCELLED',
      },
      include: leaveInclude,
      where: { id: existing.id },
    });

    await this.notifyOwners(currentUser, leave, 'cancelled');
    return { leave: this.toMemberLeave(leave) };
  }

  async findTeamLeave(
    currentUser: AuthenticatedUser,
  ): Promise<MemberLeaveListResponse> {
    if (currentUser.role !== 'OWNER') {
      throw this.domainError(
        HttpStatus.FORBIDDEN,
        'INSUFFICIENT_PERMISSION',
        'Only owners can view team leave.',
      );
    }

    const today = await this.businessToday(currentUser.businessId);
    const records = await this.prisma.memberLeave.findMany({
      include: leaveInclude,
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
      where: {
        businessId: currentUser.businessId,
        endDate: { gte: today },
        member: { status: 'ACTIVE' },
        status: 'ACTIVE',
      },
    });

    return { records: records.map((record) => this.toMemberLeave(record)) };
  }

  private async activeMembership(
    currentUser: AuthenticatedUser,
  ): Promise<MemberRecord> {
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

  private async findOwnActiveLeave(
    businessId: string,
    memberId: string,
    leaveId: string,
  ) {
    const leave = await this.prisma.memberLeave.findFirst({
      where: {
        businessId,
        id: leaveId,
        memberId,
        status: 'ACTIVE',
      },
    });

    if (!leave) {
      throw this.domainError(
        HttpStatus.NOT_FOUND,
        'LEAVE_NOT_FOUND',
        'Leave entry not found.',
      );
    }

    return leave;
  }

  private normalisePayload(dto: MemberLeavePayload): MemberLeavePayload {
    const startDate = dto.startDate.trim();
    const endDate = dto.endDate.trim();
    const validationError = validateMemberLeaveRange(startDate, endDate);

    if (validationError) {
      throw this.domainError(
        HttpStatus.BAD_REQUEST,
        'INVALID_LEAVE_DATES',
        validationError,
      );
    }

    return {
      endDate,
      note: dto.note,
      startDate,
      type: dto.type,
    };
  }

  private async assertNoOverlap(
    businessId: string,
    memberId: string,
    payload: Pick<MemberLeavePayload, 'endDate' | 'startDate'>,
    excludeLeaveId?: string,
  ) {
    const existing = await this.prisma.memberLeave.findMany({
      where: {
        businessId,
        id: excludeLeaveId ? { not: excludeLeaveId } : undefined,
        memberId,
        startDate: { lte: payload.endDate },
        status: 'ACTIVE',
      },
    });
    const overlaps = existing.some((leave) =>
      memberLeaveRangesOverlap(payload, leave),
    );

    if (overlaps) {
      throw this.domainError(
        HttpStatus.CONFLICT,
        'LEAVE_OVERLAP',
        'This leave entry overlaps existing active leave.',
      );
    }
  }

  private async businessToday(businessId: string) {
    const business = await this.prisma.business.findUnique({
      select: { timezone: true },
      where: { id: businessId },
    });
    const timezone = normaliseBusinessTimezone(business?.timezone);
    const parts = getBusinessDateParts(new Date(), timezone);
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(
      parts.day,
    ).padStart(2, '0')}`;
  }

  private async notifyOwners(
    actor: AuthenticatedUser,
    leave: LeaveRecord,
    action: 'cancelled' | 'created' | 'updated',
  ) {
    const memberName = this.memberName(leave.member);
    const typeLabel = formatMemberLeaveType(leave.type);
    const range = formatMemberLeaveDateRange(leave.startDate, leave.endDate);
    const title =
      action === 'created'
        ? 'Team leave added'
        : action === 'updated'
          ? 'Team leave updated'
          : 'Team leave cancelled';
    const verb =
      action === 'created'
        ? 'added'
        : action === 'updated'
          ? 'updated'
          : 'cancelled';
    const body =
      action === 'updated'
        ? `${memberName} updated ${typeLabel} to ${range}.`
        : `${memberName} ${verb} ${typeLabel} for ${range}.`;

    await this.notifications.createForRoles({
      actorUserId: actor.id,
      body,
      businessId: actor.businessId,
      entityId: leave.id,
      entityType: 'team',
      metadata: {
        leaveId: leave.id,
        memberId: leave.memberId,
        type: leave.type,
      },
      roles: [...OWNER_ROLES],
      title,
      type: 'TEAM_LEAVE',
    });
  }

  private async notifyNewAppointmentConflicts(
    actor: AuthenticatedUser,
    leave: LeaveRecord,
    previouslyAffected: Set<string>,
  ) {
    const affected = await this.attention.affectedAppointmentsForLeave({
      businessId: actor.businessId,
      userId: actor.id,
      startDate: leave.startDate,
      endDate: leave.endDate,
    });
    const newlyAffected = affected.filter(
      (appointment) => !previouslyAffected.has(appointment.id),
    );
    if (!newlyAffected.length) return;
    const business = await this.prisma.business.findUnique({
      select: { timezone: true },
      where: { id: actor.businessId },
    });
    const timezone = normaliseBusinessTimezone(business?.timezone);
    for (const appointment of newlyAffected) {
      await this.notifications.createForRoles({
        body: `${this.memberName(leave.member)} added ${formatMemberLeaveType(leave.type)} for ${formatMemberLeaveDateRange(leave.startDate, leave.endDate)}. ${appointment.job.title} at ${formatBusinessTime(appointment.scheduledStart, timezone)} is already assigned and needs reassignment.`,
        businessId: actor.businessId,
        entityId: appointment.id,
        entityType: 'appointment',
        metadata: {
          appointmentId: appointment.id,
          leaveId: leave.id,
          memberId: leave.memberId,
          technicianId: actor.id,
        },
        roles: [...APPOINTMENT_WRITE_ROLES],
        title: 'Appointment requires attention',
        type: 'APPOINTMENT_ATTENTION',
      });
    }
  }

  private toMemberLeave(record: LeaveRecord): MemberLeave {
    return {
      businessId: record.businessId,
      cancelledAt: record.cancelledAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      endDate: record.endDate,
      id: record.id,
      memberEmail: record.member.user?.email ?? record.member.invitedEmail,
      memberId: record.memberId,
      memberName: this.memberName(record.member),
      note: record.note,
      startDate: record.startDate,
      status: record.status,
      type: record.type,
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

const leaveInclude = {
  member: {
    include: { user: true },
  },
} as const;
