import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedUser } from '@tradieos/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IdempotencyService } from '../idempotency/idempotency.service';
import {
  ListQuotesQueryDto,
  QuoteAcceptanceDto,
  QuoteLineItemDto,
  QuoteReasonDto,
  ReorderQuoteItemsDto,
  SendQuoteDto,
  UpsertQuoteDto,
} from './dto/quotes.dto';
import { QuotesService } from './quotes.service';

@Controller('quotes')
export class QuotesController {
  constructor(
    private readonly quotes: QuotesService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  findAll(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: ListQuotesQueryDto,
  ) {
    return this.quotes.findAll(currentUser, query);
  }

  @Post()
  create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: UpsertQuoteDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.runAuthenticated(
      {
        businessId: currentUser.businessId,
        idempotencyKey,
        operation: 'quote.create',
        request: dto,
        userId: currentUser.id,
      },
      () => this.quotes.create(currentUser, dto),
    );
  }

  @Get(':id')
  findOne(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.quotes.findOne(currentUser, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpsertQuoteDto,
  ) {
    return this.quotes.update(currentUser, id, dto);
  }

  @Post(':id/items')
  addItem(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: QuoteLineItemDto,
  ) {
    return this.quotes.addItem(currentUser, id, dto);
  }

  @Patch(':id/items/:itemId')
  updateItem(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: QuoteLineItemDto,
  ) {
    return this.quotes.updateItem(currentUser, id, itemId, dto);
  }

  @Delete(':id/items/:itemId')
  deleteItem(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.quotes.deleteItem(currentUser, id, itemId);
  }

  @Post(':id/reorder-items')
  reorderItems(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReorderQuoteItemsDto,
  ) {
    return this.quotes.reorderItems(currentUser, id, dto);
  }

  @Post(':id/send')
  send(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto?: SendQuoteDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.runAuthenticated(
      {
        businessId: currentUser.businessId,
        idempotencyKey,
        operation: 'quote.send',
        request: { dto, id },
        userId: currentUser.id,
      },
      () => this.quotes.send(currentUser, id, dto),
    );
  }

  @Post(':id/revise')
  revise(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: QuoteReasonDto,
  ) {
    return this.quotes.revise(currentUser, id, dto);
  }

  @Post(':id/accept')
  accept(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: QuoteAcceptanceDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.runAuthenticated(
      {
        businessId: currentUser.businessId,
        idempotencyKey,
        operation: 'quote.accept',
        request: { dto, id },
        userId: currentUser.id,
      },
      () => this.quotes.accept(currentUser, id, dto),
    );
  }

  @Post(':id/decline')
  decline(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: QuoteReasonDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.runAuthenticated(
      {
        businessId: currentUser.businessId,
        idempotencyKey,
        operation: 'quote.decline',
        request: { dto, id },
        userId: currentUser.id,
      },
      () => this.quotes.decline(currentUser, id, dto),
    );
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: QuoteReasonDto,
  ) {
    return this.quotes.cancel(currentUser, id, dto);
  }

  @Post(':id/convert-to-job')
  convertToJob(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.runAuthenticated(
      {
        businessId: currentUser.businessId,
        idempotencyKey,
        operation: 'quote.convertToJob',
        request: { id },
        userId: currentUser.id,
      },
      () => this.quotes.convertToJob(currentUser, id),
    );
  }

  @Get(':id/preview')
  preview(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.quotes.preview(currentUser, id);
  }

  @Get(':id/pdf')
  async pdf(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const pdf = await this.quotes.pdf(currentUser, id);
    response.setHeader('Content-Type', pdf.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${pdf.fileName}"`,
    );
    response.send(pdf.buffer);
  }

  @Post(':id/duplicate')
  duplicate(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.runAuthenticated(
      {
        businessId: currentUser.businessId,
        idempotencyKey,
        operation: 'quote.duplicate',
        request: { id },
        userId: currentUser.id,
      },
      () => this.quotes.duplicate(currentUser, id),
    );
  }
}
