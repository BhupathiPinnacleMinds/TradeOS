import { Body, Controller, Get, Patch } from '@nestjs/common';
import type { AuthenticatedUser } from '@tradieos/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BusinessesService } from './businesses.service';
import { UpdateBusinessPaymentInstructionsDto } from './dto/businesses.dto';

@Controller('business')
export class BusinessesController {
  constructor(private readonly businesses: BusinessesService) {}

  @Get('payment-instructions')
  paymentInstructions(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.businesses.paymentInstructions(currentUser);
  }

  @Patch('payment-instructions')
  updatePaymentInstructions(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: UpdateBusinessPaymentInstructionsDto,
  ) {
    return this.businesses.updatePaymentInstructions(currentUser, dto);
  }
}
