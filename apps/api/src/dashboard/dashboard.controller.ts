import { Controller, Get } from '@nestjs/common';
import { CurrentBusinessId } from '../auth/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  summary(@CurrentBusinessId() businessId: string) {
    return this.dashboard.summary(businessId);
  }
}
