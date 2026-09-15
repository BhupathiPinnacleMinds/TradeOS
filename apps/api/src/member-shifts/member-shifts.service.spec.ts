import { HttpException } from '@nestjs/common';
import type {
  AuthenticatedUser,
  BusinessRole,
  MemberShiftPayload,
} from '@tradieos/shared';
import {
  isShiftWithinBusinessHours,
  memberShiftIntervalsOverlap,
  shiftOverlapsMemberLeave,
  validateMemberShiftPayload,
} from '@tradieos/shared';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { MemberShiftsService } from './member-shifts.service';

describe('MemberShiftsService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a normal owner-managed shift inside business hours', async () => {
    const { notifications, prisma, service } = createService();
    mockOwnerAndTarget(prisma);
    prisma.business.findUnique.mockResolvedValue(businessHours());
    prisma.memberLeave.findMany.mockResolvedValue([]);
    prisma.memberShift.findMany.mockResolvedValue([]);
    prisma.memberShift.create.mockResolvedValue(shiftRecord());

    const response = await service.createTeamShift(user({ role: 'OWNER' }), {
      endTime: '16:00',
      memberId: 'member-2',
      note: 'Normal day',
      shiftDate: '2026-09-16',
      startTime: '08:00',
    });

    expect(response.shift).toEqual(
      expect.objectContaining({
        endTime: '16:00',
        memberId: 'member-2',
        shiftDate: '2026-09-16',
        startTime: '08:00',
      }),
    );
    const createInput = firstMockArg<{
      data: { businessId: string; createdByMemberId: string; memberId: string };
    }>(prisma.memberShift.create);
    expect(createInput.data.businessId).toBe('business-1');
    expect(createInput.data.createdByMemberId).toBe('owner-member');
    expect(createInput.data.memberId).toBe('member-2');
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Shift scheduled',
        type: 'TEAM_SHIFT',
        userId: 'tech-user',
      }),
    );
  });

  it('rejects creating a shift before today in the business timezone', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-14T14:30:00.000Z'));
    const { prisma, service } = createService();
    mockOwnerAndTarget(prisma);
    prisma.business.findUnique.mockResolvedValue(
      businessHours({ timezone: 'Australia/Melbourne' }),
    );

    await expect(
      service.createTeamShift(
        user({ role: 'OWNER' }),
        shiftPayload({ shiftDate: '2026-09-14' }),
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'SHIFT_IN_PAST',
        message: 'Shifts cannot be created for past dates.',
      },
    });
    expect(prisma.memberShift.create).not.toHaveBeenCalled();
  });

  it('allows creating a shift for today in the business timezone', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-14T14:30:00.000Z'));
    const { prisma, service } = createService();
    mockOwnerAndTarget(prisma);
    prisma.business.findUnique.mockResolvedValue(
      businessHours({ timezone: 'Australia/Melbourne' }),
    );
    prisma.memberLeave.findMany.mockResolvedValue([]);
    prisma.memberShift.findMany.mockResolvedValue([]);
    prisma.memberShift.create.mockResolvedValue(
      shiftRecord({ shiftDate: '2026-09-15' }),
    );

    const response = await service.createTeamShift(
      user({ role: 'OWNER' }),
      shiftPayload({ shiftDate: '2026-09-15' }),
    );

    expect(response.shift.shiftDate).toBe('2026-09-15');
    const createInput = firstMockArg<{ data: { shiftDate: string } }>(
      prisma.memberShift.create,
    );
    expect(createInput.data.shiftDate).toBe('2026-09-15');
  });

  it('allows creating a shift for tomorrow in the business timezone', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-14T14:30:00.000Z'));
    const { prisma, service } = createService();
    mockOwnerAndTarget(prisma);
    prisma.business.findUnique.mockResolvedValue(
      businessHours({ timezone: 'Australia/Melbourne' }),
    );
    prisma.memberLeave.findMany.mockResolvedValue([]);
    prisma.memberShift.findMany.mockResolvedValue([]);
    prisma.memberShift.create.mockResolvedValue(
      shiftRecord({ shiftDate: '2026-09-16' }),
    );

    const response = await service.createTeamShift(
      user({ role: 'OWNER' }),
      shiftPayload({ shiftDate: '2026-09-16' }),
    );

    expect(response.shift.shiftDate).toBe('2026-09-16');
    expect(prisma.memberShift.create).toHaveBeenCalled();
  });

  it('does not shift business-today validation to the previous UTC date', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-14T14:05:00.000Z'));
    const { prisma, service } = createService();
    mockOwnerAndTarget(prisma);
    prisma.business.findUnique.mockResolvedValue(
      businessHours({ timezone: 'Australia/Melbourne' }),
    );

    await expect(
      service.createTeamShift(
        user({ role: 'OWNER' }),
        shiftPayload({ shiftDate: '2026-09-14' }),
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'SHIFT_IN_PAST',
      },
    });
    expect(prisma.memberShift.create).not.toHaveBeenCalled();
  });

  it('creates an overnight shift inside an overnight business window', async () => {
    const { prisma, service } = createService();
    mockOwnerAndTarget(prisma);
    prisma.business.findUnique.mockResolvedValue(
      businessHours({ businessEndTime: '06:00', businessStartTime: '18:00' }),
    );
    prisma.memberLeave.findMany.mockResolvedValue([]);
    prisma.memberShift.findMany.mockResolvedValue([]);
    prisma.memberShift.create.mockResolvedValue(
      shiftRecord({ endTime: '04:00', startTime: '22:00' }),
    );

    const response = await service.createTeamShift(user({ role: 'OWNER' }), {
      endTime: '04:00',
      memberId: 'member-2',
      shiftDate: '2026-09-16',
      startTime: '22:00',
    });

    expect(response.shift.endTime).toBe('04:00');
    expect(
      isShiftWithinBusinessHours({
        businessEndTime: '06:00',
        businessStartTime: '18:00',
        shift: response.shift,
      }),
    ).toBe(true);
  });

  it('rejects equal start and end times', async () => {
    const { prisma, service } = createService();
    mockOwnerAndTarget(prisma);

    await expect(
      service.createTeamShift(user({ role: 'OWNER' }), {
        endTime: '08:00',
        memberId: 'member-2',
        shiftDate: '2026-09-16',
        startTime: '08:00',
      }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(validateMemberShiftPayload(shiftPayload({ endTime: '08:00' }))).toBe(
      'Shift start and end times must be different.',
    );
  });

  it('rejects shifts outside same-day business hours', async () => {
    const { prisma, service } = createService();
    mockOwnerAndTarget(prisma);
    prisma.business.findUnique.mockResolvedValue(businessHours());

    await expect(
      service.createTeamShift(user({ role: 'OWNER' }), {
        endTime: '18:00',
        memberId: 'member-2',
        shiftDate: '2026-09-16',
        startTime: '09:00',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('rejects overlapping same-day shifts for the same member', async () => {
    const { prisma, service } = createService();
    mockOwnerAndTarget(prisma);
    prisma.business.findUnique.mockResolvedValue(businessHours());
    prisma.memberLeave.findMany.mockResolvedValue([]);
    prisma.memberShift.findMany.mockResolvedValue([
      shiftRecord({ endTime: '16:00', startTime: '08:00' }),
    ]);

    await expect(
      service.createTeamShift(user({ role: 'OWNER' }), {
        endTime: '17:00',
        memberId: 'member-2',
        shiftDate: '2026-09-16',
        startTime: '14:00',
      }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(
      memberShiftIntervalsOverlap(
        shiftPayload({ endTime: '16:00', startTime: '08:00' }),
        shiftPayload({ endTime: '17:00', startTime: '14:00' }),
      ),
    ).toBe(true);
  });

  it('rejects overlapping overnight shifts across midnight', async () => {
    const { prisma, service } = createService();
    mockOwnerAndTarget(prisma);
    prisma.business.findUnique.mockResolvedValue(
      businessHours({ businessEndTime: '06:00', businessStartTime: '18:00' }),
    );
    prisma.memberLeave.findMany.mockResolvedValue([]);
    prisma.memberShift.findMany.mockResolvedValue([
      shiftRecord({
        endTime: '04:00',
        shiftDate: '2026-09-16',
        startTime: '22:00',
      }),
    ]);

    await expect(
      service.createTeamShift(user({ role: 'OWNER' }), {
        endTime: '05:00',
        memberId: 'member-2',
        shiftDate: '2026-09-16',
        startTime: '23:00',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('rejects a shift on active leave', async () => {
    const { prisma, service } = createService();
    mockOwnerAndTarget(prisma);
    prisma.business.findUnique.mockResolvedValue(businessHours());
    prisma.memberLeave.findMany.mockResolvedValue([
      leaveRecord({ startDate: '2026-09-16', endDate: '2026-09-16' }),
    ]);

    await expect(
      service.createTeamShift(user({ role: 'OWNER' }), shiftPayload()),
    ).rejects.toBeInstanceOf(HttpException);
    expect(
      shiftOverlapsMemberLeave(shiftPayload(), [
        leaveRecord({ startDate: '2026-09-16', endDate: '2026-09-16' }),
      ]),
    ).toBe(true);
  });

  it('rejects an overnight shift touching leave on the next day', async () => {
    const { prisma, service } = createService();
    mockOwnerAndTarget(prisma);
    prisma.business.findUnique.mockResolvedValue(
      businessHours({ businessEndTime: '06:00', businessStartTime: '18:00' }),
    );
    prisma.memberLeave.findMany.mockResolvedValue([
      leaveRecord({ startDate: '2026-09-17', endDate: '2026-09-17' }),
    ]);

    await expect(
      service.createTeamShift(user({ role: 'OWNER' }), {
        ...shiftPayload(),
        endTime: '04:00',
        startTime: '22:00',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('rejects inactive or cross-business target members', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst
      .mockResolvedValueOnce(member({ id: 'owner-member', role: 'OWNER' }))
      .mockResolvedValueOnce(null);

    await expect(
      service.createTeamShift(user({ role: 'OWNER' }), shiftPayload()),
    ).rejects.toBeInstanceOf(HttpException);
    const targetLookup = mockArgAt<{
      where: {
        businessId: string;
        id: string;
        status: string;
      };
    }>(prisma.businessMember.findFirst, 1);
    expect(targetLookup.where.businessId).toBe('business-1');
    expect(targetLookup.where.id).toBe('member-2');
    expect(targetLookup.where.status).toBe('ACTIVE');
  });

  it('rejects non-owner shift management', async () => {
    const { service } = createService();

    await expect(
      service.createTeamShift(user({ role: 'ADMIN' }), shiftPayload()),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('lists only active same-business shifts for active members', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(
      member({ id: 'owner-member', role: 'OWNER' }),
    );
    prisma.business.findUnique.mockResolvedValue(
      businessHours({ timezone: 'Australia/Melbourne' }),
    );
    prisma.memberShift.findMany.mockResolvedValue([shiftRecord()]);

    const response = await service.findTeamShifts(user({ role: 'OWNER' }), {
      date: '2026-09-16',
    });

    expect(response.records).toHaveLength(1);
    const findManyInput = firstMockArg<{
      where: {
        businessId: string;
        member: { status: string };
        shiftDate: { gte: string; lte: string };
        status: string;
      };
    }>(prisma.memberShift.findMany);
    expect(findManyInput.where.businessId).toBe('business-1');
    expect(findManyInput.where.member.status).toBe('ACTIVE');
    expect(findManyInput.where.shiftDate).toEqual({
      gte: '2026-09-16',
      lte: '2026-09-16',
    });
    expect(findManyInput.where.status).toBe('ACTIVE');
  });

  it('updates a shift after revalidating leave, overlap and business hours', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst
      .mockResolvedValueOnce(member({ id: 'owner-member', role: 'OWNER' }))
      .mockResolvedValueOnce(member());
    prisma.memberShift.findFirst.mockResolvedValue(shiftRecord());
    prisma.business.findUnique.mockResolvedValue(businessHours());
    prisma.memberLeave.findMany.mockResolvedValue([]);
    prisma.memberShift.findMany.mockResolvedValue([]);
    prisma.memberShift.update.mockResolvedValue(
      shiftRecord({ endTime: '17:00', startTime: '09:00' }),
    );

    const response = await service.updateTeamShift(
      user({ role: 'OWNER' }),
      'shift-1',
      shiftPayload({ endTime: '17:00', startTime: '09:00' }),
    );

    expect(response.shift.startTime).toBe('09:00');
    expect(prisma.memberShift.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'shift-1' },
      }),
    );
  });

  it('rejects moving an existing shift into a past date', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-14T14:30:00.000Z'));
    const { prisma, service } = createService();
    prisma.businessMember.findFirst
      .mockResolvedValueOnce(member({ id: 'owner-member', role: 'OWNER' }))
      .mockResolvedValueOnce(member());
    prisma.memberShift.findFirst.mockResolvedValue(
      shiftRecord({ shiftDate: '2026-09-16' }),
    );
    prisma.business.findUnique.mockResolvedValue(
      businessHours({ timezone: 'Australia/Melbourne' }),
    );

    await expect(
      service.updateTeamShift(
        user({ role: 'OWNER' }),
        'shift-1',
        shiftPayload({ shiftDate: '2026-09-14' }),
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'SHIFT_IN_PAST',
        message: 'Shifts cannot be created for past dates.',
      },
    });
    expect(prisma.memberShift.update).not.toHaveBeenCalled();
  });

  it('cancels a shift without deleting it', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(
      member({ id: 'owner-member', role: 'OWNER' }),
    );
    prisma.memberShift.findFirst.mockResolvedValue(shiftRecord());
    prisma.memberShift.update.mockResolvedValue(
      shiftRecord({
        cancelledAt: new Date('2026-09-16T00:00:00Z'),
        status: 'CANCELLED',
      }),
    );

    const response = await service.cancelTeamShift(
      user({ role: 'OWNER' }),
      'shift-1',
    );

    expect(response.shift.status).toBe('CANCELLED');
    expect(prisma.memberShift.delete).not.toHaveBeenCalled();
  });

  it('cancelled shifts no longer block future valid shifts', async () => {
    const { prisma, service } = createService();
    mockOwnerAndTarget(prisma);
    prisma.business.findUnique.mockResolvedValue(businessHours());
    prisma.memberLeave.findMany.mockResolvedValue([]);
    prisma.memberShift.findMany.mockResolvedValue([]);
    prisma.memberShift.create.mockResolvedValue(shiftRecord());

    await service.createTeamShift(user({ role: 'OWNER' }), shiftPayload());

    const findManyInput = firstMockArg<{ where: { status: string } }>(
      prisma.memberShift.findMany,
    );
    expect(findManyInput.where.status).toBe('ACTIVE');
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
      findMany: jest.fn(),
    },
    memberShift: {
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
  const notifications = {
    create: jest.fn().mockResolvedValue({ id: 'notification-1' }),
  };

  return {
    notifications,
    prisma,
    service: new MemberShiftsService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    ),
  };
}

function mockOwnerAndTarget(
  prisma: ReturnType<typeof createService>['prisma'],
) {
  prisma.businessMember.findFirst
    .mockResolvedValueOnce(member({ id: 'owner-member', role: 'OWNER' }))
    .mockResolvedValueOnce(member());
}

function firstMockArg<T>(mock: { mock: { calls: Array<[T]> } }): T {
  const call = mock.mock.calls[0];
  if (!call) throw new Error('Expected mock to have been called.');
  return call[0];
}

function mockArgAt<T>(mock: { mock: { calls: Array<[T]> } }, index: number): T {
  const call = mock.mock.calls[index];
  if (!call) throw new Error('Expected mock to have been called.');
  return call[0];
}

function user(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    businessId: 'business-1',
    email: 'owner@example.test',
    firstName: 'Owner',
    id: 'owner-user',
    lastName: 'User',
    role: 'OWNER',
    ...overrides,
  };
}

function member(overrides: { id?: string; role?: BusinessRole } = {}) {
  return {
    businessId: 'business-1',
    id: overrides.id ?? 'member-2',
    invitedEmail: 'ram@example.test',
    invitedFirstName: 'Ram',
    invitedLastName: 'G',
    role: overrides.role ?? 'TECHNICIAN',
    status: 'ACTIVE',
    user: {
      email: 'ram@example.test',
      firstName: 'Ram',
      lastName: 'G',
    },
    userId: overrides.id === 'owner-member' ? 'owner-user' : 'tech-user',
  };
}

function businessHours(
  overrides: Partial<{
    businessEndTime: string;
    businessStartTime: string;
    timezone: string;
  }> = {},
) {
  return {
    businessEndTime: '17:00',
    businessStartTime: '08:00',
    timezone: 'Australia/Melbourne',
    ...overrides,
  };
}

function shiftPayload(
  overrides: Partial<MemberShiftPayload> = {},
): MemberShiftPayload {
  return {
    endTime: '16:00',
    memberId: 'member-2',
    note: null,
    shiftDate: '2026-09-16',
    startTime: '08:00',
    ...overrides,
  };
}

type ShiftFixture = {
  businessId: string;
  cancelledAt: Date | null;
  createdAt: Date;
  createdByMemberId: string | null;
  endTime: string;
  id: string;
  member: ReturnType<typeof member>;
  memberId: string;
  note: string | null;
  shiftDate: string;
  startTime: string;
  status: 'ACTIVE' | 'CANCELLED';
  updatedAt: Date;
};

function shiftRecord(overrides: Partial<ShiftFixture> = {}): ShiftFixture {
  return {
    businessId: 'business-1',
    cancelledAt: null,
    createdAt: new Date('2026-09-15T00:00:00Z'),
    createdByMemberId: 'owner-member',
    endTime: '16:00',
    id: 'shift-1',
    member: member(),
    memberId: 'member-2',
    note: null,
    shiftDate: '2026-09-16',
    startTime: '08:00',
    status: 'ACTIVE',
    updatedAt: new Date('2026-09-15T00:00:00Z'),
    ...overrides,
  };
}

function leaveRecord(
  overrides: Partial<{
    endDate: string;
    startDate: string;
    status: 'ACTIVE' | 'CANCELLED';
  }> = {},
) {
  return {
    endDate: '2026-09-16',
    startDate: '2026-09-16',
    status: 'ACTIVE' as const,
    ...overrides,
  };
}
