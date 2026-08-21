import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import { StructuredLogger } from '../observability/structured-logger';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

const resetMessage =
  'If an account exists, password reset instructions have been sent.';

type MockPrisma = {
  user: {
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    create: jest.Mock;
  };
  business: { create: jest.Mock };
  businessMember: {
    create: jest.Mock;
    updateMany: jest.Mock;
  };
  auditLog: { create: jest.Mock };
  passwordResetToken: {
    create: jest.Mock;
    findUnique: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

function firstMockArg<T>(mock: jest.Mock): T {
  const calls = mock.mock.calls as unknown as Array<[T]>;
  const first = calls[0]?.[0];
  if (!first) {
    throw new Error('Expected mock to have been called');
  }
  return first;
}

function firstConsolePayload<T>() {
  const calls = (console.info as jest.Mock).mock.calls as unknown as Array<
    [string, T]
  >;
  const payload = calls[0]?.[1];
  if (!payload) {
    throw new Error('Expected console.info payload');
  }
  return payload;
}

function createService() {
  const config = {
    get: jest.fn((key: string, fallback?: string) => {
      const values: Record<string, string> = {
        APP_RESET_PASSWORD_URL: 'https://app.tradieos.example/reset-password',
        EMAIL_PROVIDER: 'console',
        JWT_SECRET: 'test-secret-that-is-long-enough-for-local-tests',
        PASSWORD_RESET_TOKEN_TTL_MINUTES: '60',
      };
      return values[key] ?? fallback;
    }),
    getOrThrow: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') {
        return 'test-secret-that-is-long-enough-for-local-tests';
      }
      throw new Error(`Missing ${key}`);
    }),
  } as unknown as ConfigService;
  const jwtSignAsync = jest.fn().mockResolvedValue('access-token');
  const jwt = { signAsync: jwtSignAsync } as unknown as JwtService;
  const prisma: MockPrisma = {
    user: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn(),
    },
    business: { create: jest.fn() },
    businessMember: {
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: { create: jest.fn() },
    passwordResetToken: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn((input: unknown[] | ((tx: MockPrisma) => unknown)) =>
      Array.isArray(input) ? Promise.all(input) : input(prisma),
    ),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
  } as unknown as StructuredLogger;

  return {
    config,
    jwt,
    jwtSignAsync,
    logger,
    prisma,
    service: new AuthService(
      config,
      jwt,
      prisma as unknown as PrismaService,
      logger,
    ),
  };
}

function authUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    businessId: 'business-1',
    email: 'owner@example.test',
    firstName: 'Olivia',
    lastName: 'Owner',
    role: 'OWNER' as const,
    isActive: true,
    authVersion: 2,
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
      timezone: 'Australia/Melbourne',
    },
    ...overrides,
  };
}

function resetToken(overrides: Record<string, unknown> = {}) {
  return {
    id: 'reset-token-1',
    userId: 'user-1',
    tokenHash: createHash('sha256').update('valid-token').digest('hex'),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    usedAt: null,
    revokedAt: null,
    createdAt: new Date(),
    user: {
      id: 'user-1',
      businessId: 'business-1',
      isActive: true,
    },
    ...overrides,
  };
}

describe('AuthService account recovery and session revocation', () => {
  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('issues JWTs with the current authVersion', async () => {
    const { jwtSignAsync, service } = createService();

    await service['authResponse'](authUser());

    expect(jwtSignAsync).toHaveBeenCalledWith(
      { authVersion: 2, businessId: 'business-1', sub: 'user-1' },
      expect.objectContaining({ expiresIn: 43_200 }),
    );
  });

  it('returns the same neutral forgot-password response for existing users', async () => {
    const { prisma, service } = createService();
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      email: 'owner@example.test',
      firstName: 'Olivia',
    });

    const response = await service.forgotPassword({
      email: ' OWNER@example.test ',
    });

    expect(response).toEqual({ message: resetMessage });
    const createArg = firstMockArg<{
      data: { tokenHash: string; userId: string };
    }>(prisma.passwordResetToken.create);
    expect(createArg.data.userId).toBe('user-1');
    expect(createArg.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns a neutral forgot-password response without creating a token for unknown email', async () => {
    const { prisma, service } = createService();
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.forgotPassword({ email: 'unknown@example.test' }),
    ).resolves.toEqual({ message: resetMessage });
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('stores only a hashed reset token, never the raw token', async () => {
    const { prisma, service } = createService();
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      email: 'owner@example.test',
      firstName: 'Olivia',
    });

    await service.forgotPassword({ email: 'owner@example.test' });

    const createArg = firstMockArg<{ data: { tokenHash: string } }>(
      prisma.passwordResetToken.create,
    );
    const { resetUrl } = firstConsolePayload<{ resetUrl: string }>();

    expect(resetUrl).toContain('token=%5Bredacted%5D');
    expect(createArg.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      JSON.stringify((console.info as jest.Mock).mock.calls),
    ).not.toContain(createArg.data.tokenHash);
  });

  it('resets a password, consumes the token and increments authVersion', async () => {
    const { prisma, service } = createService();
    prisma.passwordResetToken.findUnique.mockResolvedValue(resetToken());

    await expect(
      service.resetPassword({
        token: 'valid-token',
        newPassword: 'new-password123',
      }),
    ).resolves.toEqual({
      message: 'Password has been reset. Please sign in again.',
    });

    const tokenUpdateArg = firstMockArg<{
      data: { usedAt: Date };
      where: { id?: string; usedAt?: Date | null; revokedAt?: Date | null };
    }>(prisma.passwordResetToken.updateMany);
    expect(tokenUpdateArg.where).toMatchObject({
      id: 'reset-token-1',
      usedAt: null,
      revokedAt: null,
    });
    expect(tokenUpdateArg.data.usedAt).toBeInstanceOf(Date);

    const userUpdateArg = firstMockArg<{
      data: { authVersion: { increment: number }; passwordHash: string };
      where: { id: string };
    }>(prisma.user.update);
    expect(userUpdateArg).toMatchObject({
      where: { id: 'user-1' },
      data: { authVersion: { increment: 1 } },
    });
    expect(userUpdateArg.data.passwordHash).toMatch(/^scrypt:/);
  });

  it('rejects reused, expired or invalid reset tokens', async () => {
    const { prisma, service } = createService();

    prisma.passwordResetToken.findUnique.mockResolvedValue(
      resetToken({ usedAt: new Date() }),
    );
    await expect(
      service.resetPassword({
        token: 'used-token',
        newPassword: 'password123',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.passwordResetToken.findUnique.mockResolvedValue(
      resetToken({ expiresAt: new Date(Date.now() - 1000) }),
    );
    await expect(
      service.resetPassword({
        token: 'expired-token',
        newPassword: 'password123',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.passwordResetToken.findUnique.mockResolvedValue(null);
    await expect(
      service.resetPassword({
        token: 'invalid-token',
        newPassword: 'password123',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows only one concurrent reset attempt to claim a token', async () => {
    const { prisma, service } = createService();
    prisma.passwordResetToken.findUnique.mockResolvedValue(resetToken());
    prisma.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.resetPassword({
        token: 'valid-token',
        newPassword: 'password123',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('changes password only after current password verification and revokes sessions', async () => {
    const { prisma, service } = createService();
    const createdHash = await service['hashPassword']('old-password123');
    prisma.user.findFirst.mockResolvedValueOnce({
      id: 'user-1',
      businessId: 'business-1',
      passwordHash: createdHash,
    });

    await service.changePassword(
      {
        id: 'user-1',
        businessId: 'business-1',
        email: 'owner@example.test',
        role: 'OWNER',
      },
      { currentPassword: 'old-password123', newPassword: 'new-password123' },
    );

    const updateArg = firstMockArg<{
      data: { authVersion: { increment: number } };
    }>(prisma.user.update);
    expect(updateArg.data.authVersion).toEqual({ increment: 1 });
  });

  it('rejects password changes with an incorrect current password', async () => {
    const { prisma, service } = createService();
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      businessId: 'business-1',
      passwordHash: 'scrypt:salt:hash',
    });

    await expect(
      service.changePassword(
        {
          id: 'user-1',
          businessId: 'business-1',
          email: 'owner@example.test',
          role: 'OWNER',
        },
        { currentPassword: 'wrong-password', newPassword: 'new-password123' },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('signs out all devices by incrementing authVersion', async () => {
    const { prisma, service } = createService();

    await service.signOutAllDevices({
      id: 'user-1',
      businessId: 'business-1',
      email: 'owner@example.test',
      role: 'OWNER',
    });

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', businessId: 'business-1' },
      data: { authVersion: { increment: 1 } },
    });
  });
});
