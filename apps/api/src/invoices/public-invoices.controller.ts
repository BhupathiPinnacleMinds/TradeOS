import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { RateLimitPolicy } from '../rate-limit/rate-limit.decorator';
import { PublicInvoicePaymentDeclarationDto } from './dto/invoices.dto';
import { InvoicesService } from './invoices.service';

@Public()
@Controller('public/invoices')
export class PublicInvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly idempotency: IdempotencyService,
  ) {}

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

  @Get(':token/pdf')
  @RateLimitPolicy('publicRead')
  async pdf(@Param('token') token: string, @Res() response: Response) {
    const pdf = await this.invoices.publicPdf(token);
    response.setHeader('Content-Type', pdf.mimeType);
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${pdf.fileName}"`,
    );
    response.send(pdf.buffer);
  }

  @Post(':token/payment-declarations')
  @RateLimitPolicy('publicMutation')
  declarePayment(
    @Param('token') token: string,
    @Body() dto: PublicInvoicePaymentDeclarationDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.runPublic(
      {
        fallbackKey: `public-invoice:${token}:payment-declaration`,
        idempotencyKey,
        operation: 'publicInvoice.paymentDeclaration',
        publicScope: `public-invoice:${token}`,
        request: { dto },
      },
      () => this.invoices.publicDeclarePayment(token, dto),
    );
  }
}
