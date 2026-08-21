import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { RateLimitPolicy } from '../rate-limit/rate-limit.decorator';
import {
  PublicQuoteAcceptanceDto,
  PublicQuoteDeclineDto,
} from './dto/quotes.dto';
import { QuotesService } from './quotes.service';

@Public()
@Controller('public/quotes')
export class PublicQuotesController {
  constructor(
    private readonly quotes: QuotesService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get(':token')
  @RateLimitPolicy('publicRead')
  preview(@Param('token') token: string) {
    return this.quotes.publicPreview(token);
  }

  @Post(':token/view')
  @RateLimitPolicy('publicRead')
  viewed(@Param('token') token: string) {
    return this.quotes.publicPreview(token);
  }

  @Post(':token/accept')
  @RateLimitPolicy('publicMutation')
  accept(
    @Param('token') token: string,
    @Body() dto: PublicQuoteAcceptanceDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.runPublic(
      {
        fallbackKey: `public-quote:${token}:accept`,
        idempotencyKey,
        operation: 'publicQuote.accept',
        publicScope: `public-quote:${token}`,
        request: { dto },
      },
      () => this.quotes.publicAccept(token, dto),
    );
  }

  @Post(':token/decline')
  @RateLimitPolicy('publicMutation')
  decline(
    @Param('token') token: string,
    @Body() dto: PublicQuoteDeclineDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.runPublic(
      {
        fallbackKey: `public-quote:${token}:decline`,
        idempotencyKey,
        operation: 'publicQuote.decline',
        publicScope: `public-quote:${token}`,
        request: { dto },
      },
      () => this.quotes.publicDecline(token, dto),
    );
  }
}
