import { Controller, ForbiddenException, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Public } from './decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('demo-token')
  async demoToken() {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new ForbiddenException(
        'Demo token endpoint is disabled in production',
      );
    }

    const user = await this.prisma.user.findFirst({
      where: {
        email: 'owner@demo.tradieos.au',
        isActive: true,
      },
      select: {
        id: true,
        businessId: true,
        email: true,
        role: true,
      },
    });

    if (!user) {
      throw new ForbiddenException(
        'Run `pnpm db:seed` before requesting a demo token',
      );
    }

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
}
