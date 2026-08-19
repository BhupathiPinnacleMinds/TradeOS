import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedUser } from '@tradieos/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  AccountsReceivableQueryDto,
  InvoiceDraftQueryDto,
  ListInvoicesQueryDto,
  RecordInvoicePaymentDto,
  SendInvoiceDto,
  UpsertInvoiceDto,
} from './dto/invoices.dto';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  findAll(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: ListInvoicesQueryDto,
  ) {
    return this.invoices.findAll(currentUser, query);
  }

  @Get('accounts-receivable')
  accountsReceivable(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: AccountsReceivableQueryDto,
  ) {
    return this.invoices.accountsReceivable(currentUser, query);
  }

  @Get('draft')
  draft(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: InvoiceDraftQueryDto,
  ) {
    return this.invoices.draft(currentUser, query);
  }

  @Post()
  create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: UpsertInvoiceDto,
  ) {
    return this.invoices.create(currentUser, dto);
  }

  @Get(':id')
  findOne(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.invoices.findOne(currentUser, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpsertInvoiceDto,
  ) {
    return this.invoices.update(currentUser, id, dto);
  }

  @Post(':id/send')
  send(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto?: SendInvoiceDto,
  ) {
    return this.invoices.send(currentUser, id, dto);
  }

  @Post(':id/payments')
  recordPayment(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordInvoicePaymentDto,
  ) {
    return this.invoices.recordPayment(currentUser, id, dto);
  }

  @Get(':id/payments/:paymentId/receipt')
  async paymentReceipt(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Res() response: Response,
  ) {
    const pdf = await this.invoices.paymentReceipt(currentUser, id, paymentId);
    response.setHeader('Content-Type', pdf.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${pdf.fileName}"`,
    );
    response.send(pdf.buffer);
  }

  @Post(':id/void')
  void(@CurrentUser() currentUser: AuthenticatedUser, @Param('id') id: string) {
    return this.invoices.void(currentUser, id);
  }

  @Get(':id/pdf')
  async pdf(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const pdf = await this.invoices.pdf(currentUser, id);
    response.setHeader('Content-Type', pdf.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${pdf.fileName}"`,
    );
    response.send(pdf.buffer);
  }
}
