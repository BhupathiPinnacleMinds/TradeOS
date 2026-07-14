import { HttpException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { AuthResponse, AuthenticatedUser } from '@tradieos/shared';
import { MembersService } from './members.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

const owner: AuthenticatedUser = {
  id: 'owner-1',
  businessId: 'business-1',
  email: 'owner@example.com',
  role: 'OWNER',
};

const admin: AuthenticatedUser = {
  id: 'admin-1',
  businessId: 'business-1',
  email: 'admin@example.com',
  role: 'ADMIN',
};

const technician: AuthenticatedUser = {
  id: 'tech-1',
  businessId: 'business-1',
  email: 'tech@example.com',
  role: 'TECHNICIAN',
};

function member(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'member-1',
    businessId: 'business-1',
    userId: 'user-1',
    role: 'TECHNICIAN',
    status: 'ACTIVE',
    invitedEmail: 'tech@example.com',
    invitedFirstName: 'Tess',
    invitedLastName: 'Tech',
    inviteToken: null,
    invitedBy: 'owner-1',
    invitedAt: new Date('2026-07-01T00:00:00.000Z'),
    joinedAt: new Date('2026-07-01T00:00:00.000Z'),
    lastLoginAt: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    user: {
      firstName: 'Tess',
      lastName: 'Tech',
      email: 'tech@example.com',
    },
    ...overrides,
  };
}

type MockPrisma = {
  business: { findUnique: jest.Mock };
  businessMember: {
    count: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  job: {
    count: jest.Mock;
  };
  user: {
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  auditLog: {
    create: jest.Mock;
    createMany: jest.Mock;
    findMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

function createService(prismaOverrides: Record<string, unknown> = {}) {
  const prisma = {} as MockPrisma;

  Object.assign(prisma, {
    business: { findUnique: jest.fn() },
    businessMember: {
      count: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    job: {
      count: jest.fn(),
    },
    user: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(
      (callback: ((tx: MockPrisma) => unknown) | Array<Promise<unknown>>) => {
        if (typeof callback === 'function') {
          return Promise.resolve(callback(prisma));
        }

        return Promise.all(callback);
      },
    ),
    ...prismaOverrides,
  });

  const config = {
    get: jest.fn((key: string) =>
      key === 'APP_URL' ? 'http://localhost:8081' : undefined,
    ),
    getOrThrow: jest.fn(() => 'test-secret-that-is-long-enough'),
  };
  const jwt = {
    signAsync: jest.fn(() => Promise.resolve('test-access-token')),
  };

  return {
    jwt,
    prisma,
    service: new MembersService(config as never, jwt as never, prisma as never),
  };
}

function inviteMember(overrides: Partial<Record<string, unknown>> = {}) {
  const token = 'valid-invite-token';
  return member({
    status: 'INVITED',
    userId: null,
    role: 'SCHEDULER',
    invitedEmail: 'scheduler@example.com',
    invitedFirstName: 'Sarah',
    invitedLastName: 'Scheduler',
    inviteTokenHash: createHash('sha256').update(token).digest('hex'),
    inviteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    inviteAcceptedAt: null,
    inviteCancelledAt: null,
    inviteEmailDeliveryStatus: null,
    inviteEmailDeliveryError: null,
    business: {
      id: 'business-1',
      name: 'Demo Tradie Co',
      abn: null,
      tradeType: 'Electrical',
      gstRegistered: true,
      phone: null,
      email: null,
      address: null,
      suburb: null,
      state: null,
      postcode: null,
      timezone: 'Australia/Sydney',
    },
    user: null,
    ...overrides,
  });
}

function authUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'accepted-user',
    businessId: 'business-1',
    email: 'scheduler@example.com',
    firstName: 'Sarah',
    lastName: 'Scheduler',
    role: 'SCHEDULER',
    isActive: true,
    business: {
      id: 'business-1',
      name: 'Demo Tradie Co',
      abn: null,
      tradeType: 'Electrical',
      gstRegistered: true,
      phone: null,
      email: null,
      address: null,
      suburb: null,
      state: null,
      postcode: null,
      timezone: 'Australia/Sydney',
    },
    ...overrides,
  };
}

describe('MembersService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  function expectDomainError(error: unknown, code: string) {
    expect(error).toBeInstanceOf(HttpException);
    const response = (error as HttpException).getResponse() as { code: string };
    expect(response.code).toBe(code);
  }

  it('lists members only within the current business', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findMany.mockResolvedValue([member()]);

    const result = await service.findAll(owner);

    expect(prisma.businessMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'business-1', inviteCancelledAt: null },
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.businessId).toBe('business-1');
  });

  it('excludes cancelled invitations from the normal team list', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findMany.mockResolvedValue([]);

    await service.findAll(owner);

    const [[findManyArg]] = prisma.businessMember.findMany.mock.calls as [
      [{ where: { inviteCancelledAt: null } }],
    ];
    expect(findManyArg.where.inviteCancelledAt).toBeNull();
  });

  it('blocks technicians from team management data', async () => {
    const { service } = createService();

    await service.findAll(technician).catch((error: unknown) => {
      expectDomainError(error, 'INSUFFICIENT_PERMISSION');
    });
  });

  it('prevents admins from inviting owners', async () => {
    const { service } = createService();

    await expect(
      service.invite(admin, {
        email: 'new-owner@example.com',
        firstName: 'New',
        lastName: 'Owner',
        role: 'OWNER',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('creates an invite with names and a safe hashed token', async () => {
    const { prisma, service } = createService();
    prisma.business.findUnique.mockResolvedValue({ name: 'Demo Tradie Co' });
    prisma.businessMember.findFirst.mockResolvedValue(null);
    prisma.businessMember.create.mockResolvedValue(inviteMember());
    prisma.businessMember.update.mockResolvedValue(
      inviteMember({ inviteEmailDeliveryStatus: 'SENT' }),
    );

    const response = await service.invite(owner, {
      email: 'scheduler@example.com',
      firstName: 'Sarah',
      lastName: 'Scheduler',
      role: 'SCHEDULER',
    });

    expect(response.inviteUrl).toContain('/invite/');
    expect(response.inviteToken).toBeTruthy();
    const [[createArg]] = prisma.businessMember.create.mock.calls as [
      [
        {
          data: {
            invitedEmail: string;
            invitedFirstName: string;
            invitedLastName: string;
            inviteTokenHash: string;
            role: string;
            status: string;
          };
        },
      ],
    ];
    expect(createArg.data).toMatchObject({
      invitedEmail: 'scheduler@example.com',
      invitedFirstName: 'Sarah',
      invitedLastName: 'Scheduler',
      role: 'SCHEDULER',
      status: 'INVITED',
    });
    expect(createArg.data.inviteTokenHash).not.toBe(response.inviteToken);
  });

  it('returns a specific duplicate pending invite error', async () => {
    const { prisma, service } = createService();
    prisma.business.findUnique.mockResolvedValue({ name: 'Demo Tradie Co' });
    prisma.businessMember.findFirst.mockResolvedValue(
      inviteMember({ status: 'INVITED' }),
    );

    await service
      .invite(owner, {
        email: 'scheduler@example.com',
        firstName: 'Sarah',
        lastName: 'Scheduler',
        role: 'SCHEDULER',
      })
      .catch((error: unknown) => {
        expectDomainError(error, 'INVITE_ALREADY_PENDING');
      });
  });

  it('returns safe metadata for duplicate pending invite errors', async () => {
    const { prisma, service } = createService();
    const pendingInvite = inviteMember({
      invitedAt: new Date('2026-07-01T00:00:00.000Z'),
      inviteExpiresAt: new Date('2026-07-08T00:00:00.000Z'),
      status: 'INVITED',
    });
    prisma.business.findUnique.mockResolvedValue({ name: 'Demo Tradie Co' });
    prisma.businessMember.findFirst.mockResolvedValue(pendingInvite);

    await service
      .invite(owner, {
        email: ' SCHEDULER@EXAMPLE.COM ',
        firstName: 'Sarah',
        lastName: 'Scheduler',
        role: 'SCHEDULER',
      })
      .catch((error: unknown) => {
        expectDomainError(error, 'INVITE_ALREADY_PENDING');
        const response = (error as HttpException).getResponse() as {
          details: Record<string, unknown>;
        };
        expect(response.details).toMatchObject({
          memberId: 'member-1',
          status: 'INVITED',
          invitedAt: '2026-07-01T00:00:00.000Z',
          inviteExpiresAt: '2026-07-08T00:00:00.000Z',
        });
      });
  });

  it('reissues a cancelled invite with a new token instead of blocking as duplicate', async () => {
    const { prisma, service } = createService();
    const cancelled = inviteMember({
      inviteCancelledAt: new Date('2026-07-02T00:00:00.000Z'),
      status: 'INVITED',
    });
    const reissued = inviteMember({
      inviteEmailDeliveryStatus: 'SENT',
      inviteCancelledAt: null,
    });
    prisma.business.findUnique.mockResolvedValue({ name: 'Demo Tradie Co' });
    prisma.businessMember.findFirst.mockResolvedValue(cancelled);
    prisma.businessMember.update.mockResolvedValue(reissued);

    const response = await service.invite(owner, {
      email: 'scheduler@example.com',
      firstName: 'Sarah',
      lastName: 'Scheduler',
      role: 'SCHEDULER',
    });

    expect(response.inviteUrl).toContain('/invite/');
    expect(prisma.businessMember.create).not.toHaveBeenCalled();
    const [[reissueArg]] = prisma.businessMember.update.mock.calls as [
      [{ data: Record<string, unknown>; where: { id: string } }],
    ];
    expect(reissueArg.where).toEqual({ id: 'member-1' });
    expect(reissueArg.data).toMatchObject({
      inviteCancelledAt: null,
      status: 'INVITED',
    });
  });

  it('returns a specific active member duplicate error', async () => {
    const { prisma, service } = createService();
    prisma.business.findUnique.mockResolvedValue({ name: 'Demo Tradie Co' });
    prisma.businessMember.findFirst.mockResolvedValue(
      member({ status: 'ACTIVE' }),
    );

    await service
      .invite(owner, {
        email: 'tech@example.com',
        firstName: 'Tess',
        lastName: 'Tech',
        role: 'TECHNICIAN',
      })
      .catch((error: unknown) => {
        expectDomainError(error, 'MEMBER_ALREADY_ACTIVE');
      });
  });

  it('returns a specific suspended member duplicate error', async () => {
    const { prisma, service } = createService();
    prisma.business.findUnique.mockResolvedValue({ name: 'Demo Tradie Co' });
    prisma.businessMember.findFirst.mockResolvedValue(
      member({ status: 'SUSPENDED' }),
    );

    await service
      .invite(owner, {
        email: 'tech@example.com',
        firstName: 'Tess',
        lastName: 'Tech',
        role: 'TECHNICIAN',
      })
      .catch((error: unknown) => {
        expectDomainError(error, 'MEMBER_SUSPENDED');
      });
  });

  it('does not allow members to change their own role', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(
      member({ userId: owner.id, role: 'OWNER' }),
    );

    await service
      .updateRole(owner, 'member-1', { role: 'ADMIN' })
      .catch((error: unknown) => {
        expectDomainError(error, 'CANNOT_CHANGE_OWN_ROLE');
      });
  });

  it('does not allow removing the last active owner', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(
      member({ userId: 'owner-2', role: 'OWNER' }),
    );
    prisma.businessMember.count.mockResolvedValue(1);

    await service.remove(owner, 'member-1').catch((error: unknown) => {
      expectDomainError(error, 'LAST_OWNER_PROTECTED');
    });
  });

  it('cancels a pending invite without deleting audit history', async () => {
    const { prisma, service } = createService();
    const pendingInvite = inviteMember({ status: 'INVITED' });
    const cancelledInvite = inviteMember({
      inviteCancelledAt: new Date('2026-07-03T00:00:00.000Z'),
      inviteEmailDeliveryStatus: 'CANCELLED',
      inviteTokenHash: null,
      status: 'INVITED',
    });
    prisma.businessMember.findFirst.mockResolvedValue(pendingInvite);
    prisma.businessMember.update.mockResolvedValue(cancelledInvite);

    const result = await service.cancelInvite(owner, 'member-1');

    expect(result.inviteCancelledAt).toBeTruthy();
    const [[cancelArg]] = prisma.businessMember.update.mock.calls as [
      [{ data: Record<string, unknown>; where: { id: string } }],
    ];
    expect(cancelArg.where).toEqual({ id: 'member-1' });
    expect(cancelArg.data).toMatchObject({
      inviteEmailDeliveryError: null,
      inviteEmailDeliveryStatus: 'CANCELLED',
      inviteTokenHash: null,
    });
    const [[auditArg]] = prisma.auditLog.create.mock.calls as [
      [{ data: { action: string } }],
    ];
    expect(auditArg.data.action).toBe('INVITE_CANCELLED');
  });

  it('returns not found instead of leaking cross-business members', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(null);

    await service
      .findOne(owner, 'other-business-member')
      .catch((error: unknown) => {
        expectDomainError(error, 'MEMBER_NOT_FOUND');
      });
    expect(prisma.businessMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'other-business-member', businessId: 'business-1' },
      }),
    );
  });

  it('accepts a valid invite and logs the user into the correct business', async () => {
    const { jwt, prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(inviteMember());
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(authUser());

    const result: AuthResponse = await service.acceptInvitation(
      'valid-invite-token',
      {
        email: 'scheduler@example.com',
        firstName: 'Sarah',
        lastName: 'Scheduler',
        password: 'password123',
        confirmPassword: 'password123',
      },
    );

    expect(result.accessToken).toBe('test-access-token');
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'business-1' }),
      expect.any(Object),
    );
    const [[memberUpdateArg]] = prisma.businessMember.update.mock.calls as [
      [{ data: Record<string, unknown>; where: { id: string } }],
    ];
    expect(memberUpdateArg.where).toEqual({ id: 'member-1' });
    expect(memberUpdateArg.data).toMatchObject({
      status: 'ACTIVE',
      inviteTokenHash: null,
      userId: 'accepted-user',
    });
  });

  it('rejects an expired invite', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(
      inviteMember({ inviteExpiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(
      service.acceptInvitation('valid-invite-token', {
        email: 'scheduler@example.com',
        firstName: 'Sarah',
        lastName: 'Scheduler',
        password: 'password123',
        confirmPassword: 'password123',
      }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects a reused invite', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(
      inviteMember({ status: 'ACTIVE', inviteAcceptedAt: new Date() }),
    );

    await expect(
      service.acceptInvitation('valid-invite-token', {
        email: 'scheduler@example.com',
        firstName: 'Sarah',
        lastName: 'Scheduler',
        password: 'password123',
        confirmPassword: 'password123',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('rejects a cancelled invite', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(
      inviteMember({ inviteCancelledAt: new Date() }),
    );

    await expect(
      service.acceptInvitation('valid-invite-token', {
        email: 'scheduler@example.com',
        firstName: 'Sarah',
        lastName: 'Scheduler',
        password: 'password123',
        confirmPassword: 'password123',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('rejects incorrect invitation email', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(inviteMember());

    await expect(
      service.acceptInvitation('valid-invite-token', {
        email: 'wrong@example.com',
        firstName: 'Sarah',
        lastName: 'Scheduler',
        password: 'password123',
        confirmPassword: 'password123',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('preserves assigned role and does not create a business', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(
      inviteMember({ role: 'ACCOUNTANT' }),
    );
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(authUser({ role: 'ACCOUNTANT' }));

    await service.acceptInvitation('valid-invite-token', {
      email: 'scheduler@example.com',
      firstName: 'Sarah',
      lastName: 'Scheduler',
      password: 'password123',
      confirmPassword: 'password123',
    });

    const [[userCreateArg]] = prisma.user.create.mock.calls as [
      [{ data: Record<string, unknown> }],
    ];
    expect(userCreateArg.data).toMatchObject({
      businessId: 'business-1',
      role: 'ACCOUNTANT',
    });
    expect(prisma.business.findUnique).not.toHaveBeenCalled();
  });

  it('rejects linking an email from another tenant', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(inviteMember());
    prisma.user.findFirst.mockResolvedValue({
      id: 'other-user',
      businessId: 'other-business',
    });

    await expect(
      service.acceptInvitation('valid-invite-token', {
        email: 'scheduler@example.com',
        firstName: 'Sarah',
        lastName: 'Scheduler',
        password: 'password123',
        confirmPassword: 'password123',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
