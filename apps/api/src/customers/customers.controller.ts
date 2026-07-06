import { Controller, Get } from '@nestjs/common';
import { CurrentBusinessId } from '../auth/decorators/current-user.decorator';
import { CustomersService } from './customers.service';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  findAll(@CurrentBusinessId() businessId: string) {
    return this.customers.findAll(businessId);
  }
}
