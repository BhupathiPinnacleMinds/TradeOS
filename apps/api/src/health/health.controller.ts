import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@tradieos/shared';
import { Public } from '../auth/decorators/public.decorator';

@Controller('health')
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
