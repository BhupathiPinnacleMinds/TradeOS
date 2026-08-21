import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthenticatedUser } from '@tradieos/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { RateLimitPolicy } from '../rate-limit/rate-limit.decorator';
import { CustomerCommunicationsService } from './communications.service';
import {
  ListCommunicationsQueryDto,
  ManualCustomerCommunicationDto,
  UpdateCommunicationPreferencesDto,
  UpdateCommunicationSettingsDto,
} from './dto/communications.dto';

@Controller('communications')
export class CustomerCommunicationsController {
  constructor(
    private readonly communications: CustomerCommunicationsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  findAll(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: ListCommunicationsQueryDto,
  ) {
    return this.communications.findAll(currentUser, query);
  }

  @Get('settings')
  settings(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.communications.settings(currentUser);
  }

  @Patch('settings')
  updateSettings(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: UpdateCommunicationSettingsDto,
  ) {
    return this.communications.updateSettings(currentUser, dto);
  }

  @Get('customers/:customerId/preferences')
  preferences(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('customerId') customerId: string,
  ) {
    return this.communications.preferences(currentUser, customerId);
  }

  @Patch('customers/:customerId/preferences')
  updatePreferences(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('customerId') customerId: string,
    @Body() dto: UpdateCommunicationPreferencesDto,
  ) {
    return this.communications.updatePreferences(currentUser, customerId, dto);
  }

  @Post('manual')
  @RateLimitPolicy('publicMutation')
  sendManual(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: ManualCustomerCommunicationDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.runAuthenticated(
      {
        businessId: currentUser.businessId,
        idempotencyKey,
        operation: 'communications.manualSend',
        request: dto,
        userId: currentUser.id,
      },
      () => this.communications.sendManual(currentUser, dto),
    );
  }

  @Post('process-due')
  @RateLimitPolicy('internal')
  processDue(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.communications.processDueCustomerCommunications(currentUser);
  }

  @Get(':id')
  findOne(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.communications.findOne(currentUser, id);
  }
}
