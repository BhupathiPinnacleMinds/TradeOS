import { HttpException } from '@nestjs/common';
import type {
  AuthenticatedUser,
  BusinessRole,
  MemberLeaveType,
} from '@tradieos/shared';
import {
  isDateOnly,
  isMemberOnLeave,
  memberLeaveRangesOverlap,
  validateMemberLeaveRange,
} from '@tradieos/shared';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { MemberLeaveService } from './member-leave.service';

const activeRoles: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
  'TECHNICIAN',
  'ACCOUNTANT',
  'SALES',
  'READ_ONLY',
];

describe('MemberLeaveService', () => {
  it.each(activeRoles)('%s can create their own leave', async (role) => {
    const { notifications, prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(member({ role }));
    prisma.memberLeave.findMany.mockResolvedValue([]);
    prisma.memberLeave.create.mockResolvedValue(
      leaveRecord({ type: 'SICK_LEAVE' }),
    );

    const response = await service.createOwnLeave(user({ role }), {
      endDate: '2026-09-15',
      note: 'Unwell',
      startDate: '2026-09-15',
      type: 'SICK_LEAVE',
    });

    expect(response.leave).toEqual(
      expect.objectContaining({
        memberId: 'member-1',
        startDate: '2026-09-15',
        status: 'ACTIVE',
        type: 'SICK_LEAVE',
      }),
    );
    const createInput = firstMockArg<{
      data: { businessId: string; memberId: string };
    }>(prisma.memberLeave.create);
    expect(createInput.data.businessId).toBe('business-1');
    expect(createInput.data.memberId).toBe('member-1');
    expect(notifications.createForRoles).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        roles: ['OWNER'],
        title: 'Team leave added',
        type: 'TEAM_LEAVE',
      }),
    );
  });

  it('rejects attempts to update another member leave by only finding own active leave', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(member());
    prisma.memberLeave.findFirst.mockResolvedValue(null);

    await expect(
      service.updateOwnLeave(user(), 'leave-for-someone-else', {
        endDate: '2026-09-16',
        startDate: '2026-09-15',
        type: 'ANNUAL_LEAVE',
      }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(prisma.memberLeave.findFirst).toHaveBeenCalledWith({
      where: {
        businessId: 'business-1',
        id: 'leave-for-someone-else',
        memberId: 'member-1',
        status: 'ACTIVE',
      },
    });
  });

  it('keeps cross-business access scoped by businessId', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(member());
    prisma.memberLeave.findFirst.mockResolvedValue(null);

    await expect(
      service.cancelOwnLeave(user(), 'cross-business-leave'),
    ).rejects.toBeInstanceOf(HttpException);
    const findInput = firstMockArg<{
      where: { businessId: string; id: string; memberId: string };
    }>(prisma.memberLeave.findFirst);
    expect(findInput.where.businessId).toBe('business-1');
    expect(findInput.where.id).toBe('cross-business-leave');
    expect(findInput.where.memberId).toBe('member-1');
  });

  it('allows one-day and multi-day leave but rejects end date before start date', () => {
    expect(validateMemberLeaveRange('2026-09-15', '2026-09-15')).toBeNull();
    expect(validateMemberLeaveRange('2026-09-15', '2026-09-20')).toBeNull();
    expect(validateMemberLeaveRange('2026-09-20', '2026-09-15')).toBe(
      'End date cannot be before start date.',
    );
  });

  it('rejects invalid date-only values and avoids timezone date shifting', () => {
    expect(isDateOnly('2026-09-15')).toBe(true);
    expect(isDateOnly('2026-02-30')).toBe(false);
    expect(isDateOnly('15/09/2026')).toBe(false);
    expect(isDateOnly(new Date('2026-09-15T00:00:00Z').toISOString())).toBe(
      false,
    );
  });

  it('rejects overlapping active leave for the same member', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(member());
    prisma.memberLeave.findMany.mockResolvedValue([
      leaveRecord({ endDate: '2026-09-17', startDate: '2026-09-15' }),
    ]);

    await expect(
      service.createOwnLeave(user(), {
        endDate: '2026-09-18',
        startDate: '2026-09-16',
        type: 'PERSONAL_LEAVE',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('cancelled leave does not block creating replacement leave', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(member());
    prisma.memberLeave.findMany.mockResolvedValue([]);
    prisma.memberLeave.create.mockResolvedValue(
      leaveRecord({ endDate: '2026-09-17', startDate: '2026-09-15' }),
    );

    await service.createOwnLeave(user(), {
      endDate: '2026-09-17',
      startDate: '2026-09-15',
      type: 'ANNUAL_LEAVE',
    });

    const findManyInput = firstMockArg<{ where: { status: string } }>(
      prisma.memberLeave.findMany,
    );
    expect(findManyInput.where.status).toBe('ACTIVE');
  });

  it('cancelling leave marks it cancelled without deleting it', async () => {
    const { notifications, prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(member());
    prisma.memberLeave.findFirst.mockResolvedValue(
      leaveRecord({ id: 'leave-1' }),
    );
    prisma.memberLeave.update.mockResolvedValue(
      leaveRecord({
        cancelledAt: new Date('2026-09-14T00:00:00Z'),
        status: 'CANCELLED',
      }),
    );

    const response = await service.cancelOwnLeave(user(), 'leave-1');

    expect(response.leave.status).toBe('CANCELLED');
    const updateInput = firstMockArg<{
      data: { status: string };
      where: { id: string };
    }>(prisma.memberLeave.update);
    expect(updateInput.data.status).toBe('CANCELLED');
    expect(updateInput.where.id).toBe('leave-1');
    expect(prisma.memberLeave.delete).not.toHaveBeenCalled();
    expect(notifications.createForRoles).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Team leave cancelled' }),
    );
  });

  it('allows owners to view current and upcoming team leave', async () => {
    const { prisma, service } = createService();
    prisma.business.findUnique.mockResolvedValue({
      timezone: 'Australia/Melbourne',
    });
    prisma.memberLeave.findMany.mockResolvedValue([
      leaveRecord({ id: 'leave-1', startDate: '2026-09-15' }),
    ]);

    const response = await service.findTeamLeave(user({ role: 'OWNER' }));

    expect(response.records).toHaveLength(1);
    const findManyInput = firstMockArg<{
      where: {
        businessId: string;
        member: { status: string };
        status: string;
      };
    }>(prisma.memberLeave.findMany);
    expect(findManyInput.where.businessId).toBe('business-1');
    expect(findManyInput.where.member.status).toBe('ACTIVE');
    expect(findManyInput.where.status).toBe('ACTIVE');
  });

  it('rejects non-owner business-wide team leave queries', async () => {
    const { service } = createService();

    await expect(
      service.findTeamLeave(user({ role: 'ADMIN' })),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('creates owner notifications on update and skips actor duplicate notifications', async () => {
    const { notifications, prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(
      member({ role: 'TECHNICIAN' }),
    );
    prisma.memberLeave.findFirst.mockResolvedValue(
      leaveRecord({ id: 'leave-1' }),
    );
    prisma.memberLeave.findMany.mockResolvedValue([]);
    prisma.memberLeave.update.mockResolvedValue(
      leaveRecord({
        endDate: '2026-09-30',
        id: 'leave-1',
        startDate: '2026-09-21',
        type: 'ANNUAL_LEAVE',
      }),
    );

    await service.updateOwnLeave(user({ role: 'TECHNICIAN' }), 'leave-1', {
      endDate: '2026-09-30',
      startDate: '2026-09-21',
      type: 'ANNUAL_LEAVE',
    });

    expect(notifications.createForRoles).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        body: 'Demo User updated Annual leave to 21 Sept 2026 – 30 Sept 2026.',
        title: 'Team leave updated',
      }),
    );
  });

  it('provides a future shift-validation helper for active leave dates', () => {
    expect(
      isMemberOnLeave(
        leaveRecord({
          endDate: '2026-09-20',
          startDate: '2026-09-15',
        }),
        '2026-09-18',
      ),
    ).toBe(true);
    expect(
      memberLeaveRangesOverlap(
        { endDate: '2026-09-20', startDate: '2026-09-15' },
        { endDate: '2026-09-25', startDate: '2026-09-21' },
      ),
    ).toBe(false);
  });
});

function createService() {
  const prisma = {
    business: {
      findUnique: jest.fn(),
    },
    businessMember: {
      findFirst: jest.fn(),
    },
    memberLeave: {
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
  const notifications = {
    createForRoles: jest.fn().mockResolvedValue({ count: 1 }),
  };

  return {
    notifications,
    prisma,
    service: new MemberLeaveService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    ),
  };
}

function firstMockArg<T>(mock: { mock: { calls: Array<[T]> } }): T {
  const call = mock.mock.calls[0];
  if (!call) throw new Error('Expected mock to have been called.');
  return call[0];
}

function user(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    businessId: 'business-1',
    email: 'demo@example.test',
    firstName: 'Demo',
    id: 'user-1',
    lastName: 'User',
    role: 'TECHNICIAN',
    ...overrides,
  };
}

function member(overrides: { role?: BusinessRole } = {}) {
  return {
    businessId: 'business-1',
    id: 'member-1',
    invitedEmail: 'demo@example.test',
    invitedFirstName: 'Demo',
    invitedLastName: 'User',
    role: overrides.role ?? 'TECHNICIAN',
    status: 'ACTIVE',
    user: {
      email: 'demo@example.test',
      firstName: 'Demo',
      lastName: 'User',
    },
    userId: 'user-1',
  };
}

type LeaveFixture = {
  businessId: string;
  cancelledAt: Date | null;
  createdAt: Date;
  endDate: string;
  id: string;
  member: ReturnType<typeof member>;
  memberId: string;
  note: string | null;
  startDate: string;
  status: 'ACTIVE' | 'CANCELLED';
  type: MemberLeaveType;
  updatedAt: Date;
};

function leaveRecord(overrides: Partial<LeaveFixture> = {}): LeaveFixture {
  return {
    businessId: 'business-1',
    cancelledAt: null,
    createdAt: new Date('2026-09-14T00:00:00Z'),
    endDate: '2026-09-15',
    id: 'leave-1',
    member: member(),
    memberId: 'member-1',
    note: null,
    startDate: '2026-09-15',
    status: 'ACTIVE',
    type: 'UNAVAILABLE',
    updatedAt: new Date('2026-09-14T00:00:00Z'),
    ...overrides,
  };
}
