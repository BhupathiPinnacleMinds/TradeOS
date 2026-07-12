import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '@tradieos/shared';
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
  user: {
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  auditLog: {
    create: jest.Mock;
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
    user: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(
      async (
        callback: ((tx: MockPrisma) => unknown) | Array<Promise<unknown>>,
      ) => {
        if (typeof callback === 'function') {
          return callback(prisma);
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
  };

  return {
    prisma,
    service: new MembersService(config as never, prisma as never),
  };
}

describe('MembersService', () => {
  it('lists members only within the current business', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findMany.mockResolvedValue([member()]);

    const result = await service.findAll(owner);

    expect(prisma.businessMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'business-1' },
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.businessId).toBe('business-1');
  });

  it('blocks technicians from team management data', async () => {
    const { service } = createService();

    await expect(service.findAll(technician)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('prevents admins from inviting owners', async () => {
    const { service } = createService();

    await expect(
      service.invite(admin, {
        email: 'new-owner@example.com',
        role: 'OWNER',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not allow members to change their own role', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(
      member({ userId: owner.id, role: 'OWNER' }),
    );

    await expect(
      service.updateRole(owner, 'member-1', { role: 'ADMIN' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not allow removing the last active owner', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(
      member({ userId: 'owner-2', role: 'OWNER' }),
    );
    prisma.businessMember.count.mockResolvedValue(1);

    await expect(service.remove(owner, 'member-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns not found instead of leaking cross-business members', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findFirst.mockResolvedValue(null);

    await expect(
      service.findOne(owner, 'other-business-member'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.businessMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'other-business-member', businessId: 'business-1' },
      }),
    );
  });
});
