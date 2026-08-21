import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'crypto';
import { promisify } from 'util';
import type { AuthenticatedUser, BusinessRole } from '@tradieos/shared';
import {
  normaliseBusinessTimezone,
  timezoneForAustralianState,
} from '@tradieos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StructuredLogger } from '../observability/structured-logger';
import {
  createEmailProvider,
  type EmailProvider,
} from '../members/email-provider';
import type {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';

const scrypt = promisify(scryptCallback);
const PASSWORD_RESET_NEUTRAL_MESSAGE =
  'If an account exists, password reset instructions have been sent.';

@Injectable()
export class AuthService {
  private readonly emailProvider: EmailProvider;

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly logger: StructuredLogger,
  ) {
    this.emailProvider = createEmailProvider({
      apiKey: this.config.get<string>('RESEND_API_KEY'),
      fromAddress: this.config.get<string>('EMAIL_FROM_ADDRESS'),
      fromName: this.config.get<string>('EMAIL_FROM_NAME', 'TradieOS'),
      isProduction: this.config.get<string>('NODE_ENV') === 'production',
      provider: this.config.get<string>('EMAIL_PROVIDER', 'console'),
    });
  }

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const existingUser = await this.prisma.user.findFirst({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException('An account already exists for this email');
    }

    const passwordHash = await this.hashPassword(dto.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: {
          name: dto.businessName.trim(),
          abn: dto.abn?.trim() || null,
          tradeType: dto.tradeType.trim(),
          gstRegistered: dto.gstRegistered,
          phone: dto.phone?.trim() || null,
          email: dto.businessEmail?.trim().toLowerCase() || email,
          address: dto.address?.trim() || null,
          suburb: dto.suburb?.trim() || null,
          state: dto.state?.trim() || null,
          postcode: dto.postcode?.trim() || null,
          timezone: normaliseBusinessTimezone(
            dto.timezone ?? timezoneForAustralianState(dto.state),
          ),
        },
      });

      const owner = await tx.user.create({
        data: {
          businessId: business.id,
          email,
          passwordHash,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          role: 'OWNER',
        },
        select: this.userSelect(),
      });

      await tx.businessMember.create({
        data: {
          businessId: business.id,
          userId: owner.id,
          role: 'OWNER',
          status: 'ACTIVE',
          invitedEmail: email,
          joinedAt: new Date(),
        },
      });

      return owner;
    });

    return this.authResponse(user);
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { email },
      select: {
        ...this.userSelect(),
        passwordHash: true,
      },
    });

    if (!user || !user.isActive) {
      this.logger.warn('login_failure', {
        category: 'auth',
        event: 'login_failure',
        reason: 'invalid_credentials',
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    const isValid = await this.verifyPassword(dto.password, user.passwordHash);

    if (!isValid) {
      this.logger.warn('login_failure', {
        category: 'auth',
        event: 'login_failure',
        reason: 'invalid_credentials',
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.prisma.$transaction([
      this.prisma.businessMember.updateMany({
        where: {
          businessId: user.businessId,
          userId: user.id,
          status: 'ACTIVE',
        },
        data: { lastLoginAt: new Date() },
      }),
      ...(user.role === 'OWNER'
        ? [
            this.prisma.auditLog.create({
              data: {
                businessId: user.businessId,
                actorUserId: user.id,
                action: 'OWNER_LOGIN',
                entityType: 'User',
                entityId: user.id,
                metadata: { email: user.email },
              },
            }),
          ]
        : []),
    ]);

    this.logger.info('login_success', {
      businessId: user.businessId,
      category: 'auth',
      event: 'login_success',
      userId: user.id,
    });

    return this.authResponse({
      id: user.id,
      businessId: user.businessId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isActive: user.isActive,
      authVersion: user.authVersion,
      business: user.business,
    });
  }

  async me(user: AuthenticatedUser) {
    const currentUser = await this.prisma.user.findFirst({
      where: {
        id: user.id,
        businessId: user.businessId,
        isActive: true,
      },
      select: this.userSelect(),
    });

    if (!currentUser) {
      throw new UnauthorizedException();
    }

    return { user: currentUser };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { email, isActive: true },
      select: {
        id: true,
        email: true,
        firstName: true,
      },
    });

    this.logger.info('password_reset_requested', {
      category: 'auth',
      event: 'password_reset_requested',
      reason: user ? 'eligible_account' : 'account_not_found_or_inactive',
      userId: user?.id,
    });

    if (!user) {
      return { message: PASSWORD_RESET_NEUTRAL_MESSAGE };
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashResetToken(token);
    const expiresAt = new Date(
      Date.now() + this.passwordResetTtlMinutes() * 60 * 1000,
    );

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const delivery = await this.emailProvider.sendPasswordReset({
      to: user.email,
      firstName: user.firstName,
      resetUrl: this.buildPasswordResetUrl(token),
      expiresAt,
    });

    if (delivery.status === 'FAILED') {
      this.logger.warn('password_reset_email_failed', {
        category: 'auth',
        event: 'password_reset_email_failed',
        reason: delivery.error ?? 'email_delivery_failed',
        userId: user.id,
      });
    }

    return { message: PASSWORD_RESET_NEUTRAL_MESSAGE };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = this.hashResetToken(dto.token);
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            businessId: true,
            isActive: true,
          },
        },
      },
    });
    const now = new Date();

    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.revokedAt ||
      resetToken.expiresAt <= now ||
      !resetToken.user.isActive
    ) {
      this.logger.warn('password_reset_failed', {
        category: 'auth',
        event: 'password_reset_failed',
        reason: this.passwordResetFailureReason(resetToken, now),
        userId: resetToken?.userId,
      });
      throw new BadRequestException({
        code: 'INVALID_OR_EXPIRED_PASSWORD_RESET_TOKEN',
        message: 'This password reset link is invalid or has expired.',
      });
    }

    const passwordHash = await this.hashPassword(dto.newPassword);

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: {
          id: resetToken.id,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });

      if (claimed.count !== 1) {
        throw new BadRequestException({
          code: 'INVALID_OR_EXPIRED_PASSWORD_RESET_TOKEN',
          message: 'This password reset link is invalid or has expired.',
        });
      }

      await tx.user.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash,
          authVersion: { increment: 1 },
        },
      });

      await tx.passwordResetToken.updateMany({
        where: {
          userId: resetToken.userId,
          id: { not: resetToken.id },
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
    });

    this.logger.info('password_reset_completed', {
      businessId: resetToken.user.businessId,
      category: 'auth',
      event: 'password_reset_completed',
      userId: resetToken.userId,
    });

    return { message: 'Password has been reset. Please sign in again.' };
  }

  async changePassword(user: AuthenticatedUser, dto: ChangePasswordDto) {
    const currentUser = await this.prisma.user.findFirst({
      where: {
        id: user.id,
        businessId: user.businessId,
        isActive: true,
      },
      select: { id: true, businessId: true, passwordHash: true },
    });

    if (!currentUser) {
      throw new UnauthorizedException();
    }

    const currentPasswordValid = await this.verifyPassword(
      dto.currentPassword,
      currentUser.passwordHash,
    );

    if (!currentPasswordValid) {
      throw new UnauthorizedException('Invalid current password');
    }

    const passwordHash = await this.hashPassword(dto.newPassword);
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: currentUser.id },
        data: {
          passwordHash,
          authVersion: { increment: 1 },
        },
      }),
      this.prisma.passwordResetToken.updateMany({
        where: {
          userId: currentUser.id,
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      }),
    ]);

    this.logger.info('password_change_completed', {
      businessId: currentUser.businessId,
      category: 'auth',
      event: 'password_change_completed',
      userId: currentUser.id,
    });

    return { message: 'Password changed. Please sign in again.' };
  }

  async signOutAllDevices(user: AuthenticatedUser) {
    await this.prisma.user.updateMany({
      where: {
        id: user.id,
        businessId: user.businessId,
      },
      data: { authVersion: { increment: 1 } },
    });

    this.logger.info('sessions_revoked', {
      businessId: user.businessId,
      category: 'auth',
      event: 'logout_all_devices',
      userId: user.id,
    });

    return { message: 'All devices have been signed out.' };
  }

  async demoToken() {
    const user = await this.prisma.user.findFirst({
      where: { email: 'owner@demo-tradieos.com' },
      select: this.userSelect(),
    });

    if (!user) {
      throw new UnauthorizedException(
        'Run `pnpm db:seed` before requesting a demo token',
      );
    }

    return this.authResponse(user);
  }

  private async authResponse(user: UserAuthPayload) {
    const { authVersion, ...authUser } = user;
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        businessId: user.businessId,
        authVersion,
      },
      {
        expiresIn: 12 * 60 * 60,
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      },
    );

    return {
      accessToken,
      user: authUser,
    };
  }

  private async hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const hash = (await scrypt(password, salt, 64)) as Buffer;
    return `scrypt:${salt}:${hash.toString('hex')}`;
  }

  private async verifyPassword(password: string, storedHash: string) {
    const [algorithm, salt, hash] = storedHash.split(':');

    if (algorithm !== 'scrypt' || !salt || !hash) {
      return false;
    }

    const candidate = (await scrypt(password, salt, 64)) as Buffer;
    const expected = Buffer.from(hash, 'hex');

    return (
      expected.length === candidate.length &&
      timingSafeEqual(expected, candidate)
    );
  }

  private hashResetToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private passwordResetTtlMinutes() {
    const configured = Number(
      this.config.get<string>('PASSWORD_RESET_TOKEN_TTL_MINUTES', '60'),
    );
    return Number.isFinite(configured) && configured > 0 ? configured : 60;
  }

  private buildPasswordResetUrl(token: string) {
    const configuredResetUrl =
      this.config.get<string>('APP_RESET_PASSWORD_URL') ??
      this.config.get<string>('APP_PUBLIC_URL') ??
      this.config.get<string>('APP_URL') ??
      'http://localhost:8081/reset-password';
    const baseUrl = configuredResetUrl.replace(/\/$/, '');
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}token=${encodeURIComponent(token)}`;
  }

  private passwordResetFailureReason(
    token: {
      expiresAt: Date;
      revokedAt: Date | null;
      usedAt: Date | null;
      user: { isActive: boolean };
    } | null,
    now: Date,
  ) {
    if (!token) return 'token_not_found';
    if (token.usedAt) return 'token_used';
    if (token.revokedAt) return 'token_revoked';
    if (token.expiresAt <= now) return 'token_expired';
    if (!token.user.isActive) return 'user_inactive';
    return 'invalid_token';
  }

  private userSelect() {
    return {
      id: true,
      businessId: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      authVersion: true,
      business: {
        select: {
          id: true,
          name: true,
          abn: true,
          tradeType: true,
          gstRegistered: true,
          phone: true,
          email: true,
          address: true,
          suburb: true,
          state: true,
          postcode: true,
          timezone: true,
        },
      },
    } as const;
  }
}

type UserAuthPayload = {
  id: string;
  businessId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: BusinessRole;
  isActive: boolean;
  authVersion: number;
  business: {
    id: string;
    name: string;
    abn: string | null;
    tradeType: string | null;
    gstRegistered: boolean;
    phone: string | null;
    email: string | null;
    address: string | null;
    suburb: string | null;
    state: string | null;
    postcode: string | null;
    timezone: string;
  };
};
