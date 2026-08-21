import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type { HealthResponse, ReadinessResponse } from '@tradieos/shared';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { SkipRateLimit } from '../rate-limit/rate-limit.decorator';

@Controller('health')
@SkipRateLimit()
export class HealthController {
  @Public()
  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      service: 'tradieos-api',
      timestamp: new Date().toISOString(),
    };
  }
}

@Controller('ready')
@SkipRateLimit()
export class ReadinessController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check(): Promise<ReadinessResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
      } satisfies ReadinessResponse);
    }
  }
}
