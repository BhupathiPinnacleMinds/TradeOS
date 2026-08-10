import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import {
  PublicQuoteAcceptanceDto,
  PublicQuoteDeclineDto,
} from './dto/quotes.dto';
import { QuotesService } from './quotes.service';

@Public()
@Controller('public/quotes')
export class PublicQuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get(':token')
  preview(@Param('token') token: string) {
    return this.quotes.publicPreview(token);
  }

  @Post(':token/view')
  viewed(@Param('token') token: string) {
    return this.quotes.publicPreview(token);
  }

  @Post(':token/accept')
  accept(@Param('token') token: string, @Body() dto: PublicQuoteAcceptanceDto) {
    return this.quotes.publicAccept(token, dto);
  }

  @Post(':token/decline')
  decline(@Param('token') token: string, @Body() dto: PublicQuoteDeclineDto) {
    return this.quotes.publicDecline(token, dto);
  }
}
