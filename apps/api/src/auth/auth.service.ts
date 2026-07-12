import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import type { AuthenticatedUser, BusinessRole } from '@tradieos/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { LoginDto, RegisterDto } from './dto/auth.dto';

const scrypt = promisify(scryptCallback);

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

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
      throw new UnauthorizedException('Invalid email or password');
    }

    const isValid = await this.verifyPassword(dto.password, user.passwordHash);

    if (!isValid) {
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

    return this.authResponse({
      id: user.id,
      businessId: user.businessId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isActive: user.isActive,
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
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        businessId: user.businessId,
      },
      {
        expiresIn: 12 * 60 * 60,
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      },
    );

    return {
      accessToken,
      user,
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

  private userSelect() {
    return {
      id: true,
      businessId: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
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
