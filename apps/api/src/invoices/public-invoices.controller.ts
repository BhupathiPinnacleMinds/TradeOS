import { Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { RateLimitPolicy } from '../rate-limit/rate-limit.decorator';
import { InvoicesService } from './invoices.service';

@Public()
@Controller('public/invoices')
export class PublicInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get(':token')
  @RateLimitPolicy('publicRead')
  findOne(@Param('token') token: string) {
    return this.invoices.publicFindOne(token);
  }

  @Post(':token/view')
  @RateLimitPolicy('publicMutation')
  view(@Param('token') token: string) {
    return this.invoices.publicView(token);
  }
}
