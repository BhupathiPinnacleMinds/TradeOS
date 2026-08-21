import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

type MockPrisma = {
  user: { findFirst: jest.Mock };
  businessMember: { findFirst: jest.Mock };
};

function createStrategy() {
  const config = {
    getOrThrow: jest.fn().mockReturnValue('test-secret-that-is-long-enough'),
  } as unknown as ConfigService;
  const prisma: MockPrisma = {
    user: { findFirst: jest.fn() },
    businessMember: { findFirst: jest.fn() },
  };

  return {
    prisma,
    strategy: new JwtStrategy(config, prisma as unknown as PrismaService),
  };
}

describe('JwtStrategy session revocation', () => {
  it('accepts an active user when token authVersion matches', async () => {
    const { prisma, strategy } = createStrategy();
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      businessId: 'business-1',
      email: 'owner@example.test',
      role: 'OWNER',
      authVersion: 3,
    });
    prisma.businessMember.findFirst.mockResolvedValue({ id: 'member-1' });

    await expect(
      strategy.validate({
        sub: 'user-1',
        businessId: 'business-1',
        authVersion: 3,
      }),
    ).resolves.toMatchObject({
      id: 'user-1',
      businessId: 'business-1',
      email: 'owner@example.test',
      role: 'OWNER',
    });
  });

  it('rejects a JWT issued before password reset or logout-all-devices', async () => {
    const { prisma, strategy } = createStrategy();
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      businessId: 'business-1',
      email: 'owner@example.test',
      role: 'OWNER',
      authVersion: 4,
    });

    await expect(
      strategy.validate({
        sub: 'user-1',
        businessId: 'business-1',
        authVersion: 3,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.businessMember.findFirst).not.toHaveBeenCalled();
  });

  it('rejects suspended or removed members even if JWT authVersion matches', async () => {
    const { prisma, strategy } = createStrategy();
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      businessId: 'business-1',
      email: 'staff@example.test',
      role: 'TECHNICIAN',
      authVersion: 1,
    });
    prisma.businessMember.findFirst.mockResolvedValue(null);

    await expect(
      strategy.validate({
        sub: 'user-1',
        businessId: 'business-1',
        authVersion: 1,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
