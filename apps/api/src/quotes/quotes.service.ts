import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type {
  AuthenticatedUser,
  Quote,
  QuoteDetailResponse,
  QuoteLineItem,
  QuoteLineItemPayload,
  QuoteListResponse,
  QuoteStatus,
} from '@tradieos/shared';
import {
  QUOTE_CREATE_ROLES,
  QUOTE_VIEW_ROLES,
  calculateQuoteTotals,
  canTransitionQuoteStatus,
  formatAudCents,
  roleCanCancelQuote,
  roleCanConvertQuote,
  roleCanEditQuote,
  roleCanReviseQuote,
  roleCanSendQuote,
} from '@tradieos/shared';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ListQuotesQueryDto,
  QuoteAcceptanceDto,
  QuoteLineItemDto,
  QuoteReasonDto,
  ReorderQuoteItemsDto,
  UpsertQuoteDto,
} from './dto/quotes.dto';

const DEFAULT_PAGE_SIZE = 20;
const QUOTE_STATUS_AUDIT_EVENTS: Partial<Record<QuoteStatus, string>> = {
  ACCEPTED: 'QUOTE_ACCEPTED',
  CANCELLED: 'QUOTE_CANCELLED',
  CONVERTED: 'QUOTE_CONVERTED_TO_JOB',
  DECLINED: 'QUOTE_DECLINED',
  EXPIRED: 'QUOTE_EXPIRED',
  SENT: 'QUOTE_SENT',
  VIEWED: 'QUOTE_VIEWED',
};

type QuoteRecord = Prisma.QuoteGetPayload<{
  include: ReturnType<QuotesService['quoteInclude']>;
}>;

@Injectable()
export class QuotesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    currentUser: AuthenticatedUser,
    query: ListQuotesQueryDto,
  ): Promise<QuoteListResponse> {
    this.assertRole(currentUser, QUOTE_VIEW_ROLES);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(
      100,
      Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const where = this.buildWhere(currentUser, query);

    const [records, total] = await this.prisma.$transaction([
      this.prisma.quote.findMany({
        where,
        orderBy: this.orderBy(query.sortBy, query.sortOrder),
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: this.quoteInclude(),
      }),
      this.prisma.quote.count({ where }),
    ]);

    return {
      page,
      pageSize,
      records: records.map((quote) => this.toQuote(quote)),
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async findOne(
    currentUser: AuthenticatedUser,
    id: string,
  ): Promise<QuoteDetailResponse> {
    this.assertRole(currentUser, QUOTE_VIEW_ROLES);
    const quote = await this.getQuoteForUser(currentUser, id);
    const activity = await this.prisma.auditLog.findMany({
      where: {
        businessId: currentUser.businessId,
        entityType: 'Quote',
        entityId: quote.id,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return {
      activity: activity.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
        metadata: (entry.metadata as Record<string, unknown> | null) ?? null,
      })),
      quote: this.toQuote(quote),
    };
  }

  async create(currentUser: AuthenticatedUser, dto: UpsertQuoteDto) {
    this.assertRole(currentUser, QUOTE_CREATE_ROLES);
    this.assertDates(dto);
    this.assertLineItems(dto.lineItems);
    await this.assertQuoteContext(currentUser, dto);
    if (
      currentUser.role === 'TECHNICIAN' &&
      !(await this.canTechnicianCreateDraft(currentUser, dto.jobId))
    ) {
      throw this.domainError(
        'QUOTE_ACCESS_DENIED',
        'Technicians can only draft quotes for assigned jobs.',
        HttpStatus.FORBIDDEN,
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const quoteNumber = await this.nextQuoteNumber(
        tx,
        currentUser.businessId,
        new Date(dto.issueDate),
      );
      const calculated = calculateQuoteTotals({
        depositType: dto.depositType,
        depositValue: dto.depositValue,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        gstRateBasisPoints: dto.gstRateBasisPoints,
        lineItems: dto.lineItems,
        pricingMode: dto.pricingMode,
      });
      const quote = await tx.quote.create({
        data: {
          ...this.quoteData(currentUser, dto, calculated),
          quoteNumber,
          lineItems: {
            create: calculated.lineItems.map((item, index) =>
              this.lineItemData(currentUser.businessId, item, index),
            ),
          },
        },
        include: this.quoteInclude(),
      });
      await this.writeAudit(tx, currentUser, 'QUOTE_CREATED', quote, {
        status: quote.status,
      });
      if (quote.jobId) {
        await tx.job.update({
          where: {
            id_businessId: {
              businessId: currentUser.businessId,
              id: quote.jobId,
            },
          },
          data: { quoteCreated: true },
        });
      }
      return quote;
    });

    return this.findOne(currentUser, created.id);
  }

  async update(
    currentUser: AuthenticatedUser,
    id: string,
    dto: UpsertQuoteDto,
  ) {
    const quote = await this.getQuoteForUser(currentUser, id);
    if (!roleCanEditQuote(currentUser.role, quote.status)) {
      throw this.domainError(
        'QUOTE_EDIT_NOT_ALLOWED',
        'Only draft quotes can be edited directly.',
        HttpStatus.CONFLICT,
      );
    }
    this.assertDates(dto);
    this.assertLineItems(dto.lineItems);
    await this.assertQuoteContext(currentUser, dto);
    await this.replaceQuoteContents(
      currentUser,
      quote.id,
      dto,
      'QUOTE_UPDATED',
    );
    return this.findOne(currentUser, quote.id);
  }

  async addItem(
    currentUser: AuthenticatedUser,
    id: string,
    dto: QuoteLineItemDto,
  ) {
    const quote = await this.assertEditableQuote(currentUser, id);
    this.assertLineItems([dto]);
    await this.prisma.$transaction(async (tx) => {
      const position = quote.lineItems.length;
      const updatedItems = [
        ...quote.lineItems.map((item) => this.toPayload(item)),
        dto,
      ];
      const calculated = calculateQuoteTotals({
        depositType: quote.depositType,
        depositValue: quote.depositValue,
        discountType: quote.discountType,
        discountValue: quote.discountValue,
        gstRateBasisPoints: quote.gstRateBasisPoints,
        lineItems: updatedItems,
        pricingMode: quote.pricingMode,
      });
      const line = calculated.lineItems[position];
      await tx.quoteLineItem.create({
        data: this.lineItemData(
          currentUser.businessId,
          line,
          position,
          quote.id,
        ) as Prisma.QuoteLineItemUncheckedCreateInput,
      });
      await this.updateTotals(tx, quote.id, calculated);
      await this.writeAudit(tx, currentUser, 'QUOTE_ITEM_ADDED', quote, {
        name: dto.name,
      });
    });
    return this.findOne(currentUser, id);
  }

  async updateItem(
    currentUser: AuthenticatedUser,
    id: string,
    itemId: string,
    dto: QuoteLineItemDto,
  ) {
    const quote = await this.assertEditableQuote(currentUser, id);
    this.assertLineItems([dto]);
    const existing = quote.lineItems.find((item) => item.id === itemId);
    if (!existing) {
      throw this.domainError(
        'QUOTE_LINE_ITEM_INVALID',
        'Quote line item could not be found.',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const updatedItems = quote.lineItems.map((item) =>
        item.id === itemId ? dto : this.toPayload(item),
      );
      const calculated = calculateQuoteTotals({
        depositType: quote.depositType,
        depositValue: quote.depositValue,
        discountType: quote.discountType,
        discountValue: quote.discountValue,
        gstRateBasisPoints: quote.gstRateBasisPoints,
        lineItems: updatedItems,
        pricingMode: quote.pricingMode,
      });
      const next = calculated.lineItems[existing.position];
      await tx.quoteLineItem.update({
        where: { id: itemId },
        data: this.lineItemData(
          currentUser.businessId,
          next,
          existing.position,
        ),
      });
      await this.updateTotals(tx, quote.id, calculated);
      await this.writeAudit(tx, currentUser, 'QUOTE_ITEM_UPDATED', quote, {
        itemId,
      });
    });
    return this.findOne(currentUser, id);
  }

  async deleteItem(currentUser: AuthenticatedUser, id: string, itemId: string) {
    const quote = await this.assertEditableQuote(currentUser, id);
    if (!quote.lineItems.some((item) => item.id === itemId)) {
      throw this.domainError(
        'QUOTE_LINE_ITEM_INVALID',
        'Quote line item could not be found.',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const remaining = quote.lineItems
        .filter((item) => item.id !== itemId)
        .map((item) => this.toPayload(item));
      await tx.quoteLineItem.delete({ where: { id: itemId } });
      await this.rewriteItemsAndTotals(tx, quote, remaining);
      await this.writeAudit(tx, currentUser, 'QUOTE_ITEM_REMOVED', quote, {
        itemId,
      });
    });
    return this.findOne(currentUser, id);
  }

  async reorderItems(
    currentUser: AuthenticatedUser,
    id: string,
    dto: ReorderQuoteItemsDto,
  ) {
    const quote = await this.assertEditableQuote(currentUser, id);
    const existingIds = quote.lineItems.map((item) => item.id).sort();
    if (dto.itemIds.slice().sort().join('|') !== existingIds.join('|')) {
      throw this.domainError(
        'QUOTE_LINE_ITEM_INVALID',
        'Reorder list must include every quote line item exactly once.',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await Promise.all(
        dto.itemIds.map((itemId, position) =>
          tx.quoteLineItem.update({
            where: { id: itemId },
            data: { position },
          }),
        ),
      );
      await this.writeAudit(tx, currentUser, 'QUOTE_ITEM_REORDERED', quote, {});
    });
    return this.findOne(currentUser, id);
  }

  async send(currentUser: AuthenticatedUser, id: string) {
    const quote = await this.getQuoteForUser(currentUser, id);
    if (!roleCanSendQuote(currentUser.role, quote.status)) {
      throw this.domainError(
        'QUOTE_INVALID_STATUS',
        'Only draft quotes can be sent.',
        HttpStatus.CONFLICT,
      );
    }
    if (quote.lineItems.length === 0) {
      throw this.domainError(
        'QUOTE_LINE_ITEM_INVALID',
        'Add at least one line item before sending.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.createRevision(tx, currentUser, quote, 'Initial send');
      const next = await tx.quote.update({
        where: { id_businessId: { businessId: currentUser.businessId, id } },
        data: { sentAt: new Date(), status: 'SENT', updatedBy: currentUser.id },
        include: this.quoteInclude(),
      });
      await this.writeAudit(tx, currentUser, 'QUOTE_SENT', next, {
        localDelivery: true,
        previewUrl: `/api/quotes/${id}/preview`,
      });
      console.info('[TradieOS quote:SEND]', {
        customer: next.customer.email ?? next.customer.displayName,
        quoteNumber: next.quoteNumber,
        total: formatAudCents(next.totalCents),
        url: `/api/quotes/${id}/preview`,
      });
      return next;
    });
    return this.findOne(currentUser, updated.id);
  }

  async revise(
    currentUser: AuthenticatedUser,
    id: string,
    dto: QuoteReasonDto,
  ) {
    const quote = await this.getQuoteForUser(currentUser, id);
    if (!roleCanReviseQuote(currentUser.role, quote.status)) {
      throw this.domainError(
        'QUOTE_INVALID_STATUS',
        'Only sent or viewed quotes can be revised.',
        HttpStatus.CONFLICT,
      );
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.createRevision(
        tx,
        currentUser,
        quote,
        dto.reason ?? 'Revision',
      );
      const next = await tx.quote.update({
        where: { id_businessId: { businessId: currentUser.businessId, id } },
        data: {
          status: 'DRAFT',
          updatedBy: currentUser.id,
          version: { increment: 1 },
        },
        include: this.quoteInclude(),
      });
      await this.writeAudit(tx, currentUser, 'QUOTE_REVISED', next, {
        reason: dto.reason ?? null,
      });
      return next;
    });
    return this.findOne(currentUser, updated.id);
  }

  async accept(
    currentUser: AuthenticatedUser,
    id: string,
    dto: QuoteAcceptanceDto,
  ) {
    const quote = await this.getQuoteForUser(currentUser, id);
    if (!['SENT', 'VIEWED'].includes(quote.status)) {
      throw this.domainError(
        'QUOTE_INVALID_STATUS',
        'Only sent quotes can be accepted.',
        HttpStatus.CONFLICT,
      );
    }
    const updated = await this.transition(currentUser, quote, 'ACCEPTED', {
      acceptedAt: new Date(),
      acceptedByEmail: dto.acceptedByEmail ?? null,
      acceptedByName: dto.acceptedByName,
    });
    return this.findOne(currentUser, updated.id);
  }

  async decline(
    currentUser: AuthenticatedUser,
    id: string,
    dto: QuoteReasonDto,
  ) {
    const quote = await this.getQuoteForUser(currentUser, id);
    if (!['SENT', 'VIEWED'].includes(quote.status)) {
      throw this.domainError(
        'QUOTE_INVALID_STATUS',
        'Only sent quotes can be declined.',
        HttpStatus.CONFLICT,
      );
    }
    const updated = await this.transition(currentUser, quote, 'DECLINED', {
      declinedAt: new Date(),
      internalNotes: dto.reason
        ? [quote.internalNotes, `Declined: ${dto.reason}`]
            .filter(Boolean)
            .join('\n')
        : quote.internalNotes,
    });
    return this.findOne(currentUser, updated.id);
  }

  async cancel(
    currentUser: AuthenticatedUser,
    id: string,
    dto: QuoteReasonDto,
  ) {
    const quote = await this.getQuoteForUser(currentUser, id);
    if (!roleCanCancelQuote(currentUser.role, quote.status)) {
      throw this.domainError(
        'QUOTE_INVALID_STATUS',
        'This quote can no longer be cancelled.',
        HttpStatus.CONFLICT,
      );
    }
    const updated = await this.transition(currentUser, quote, 'CANCELLED', {
      cancelledAt: new Date(),
      internalNotes: dto.reason
        ? [quote.internalNotes, `Cancelled: ${dto.reason}`]
            .filter(Boolean)
            .join('\n')
        : quote.internalNotes,
    });
    return this.findOne(currentUser, updated.id);
  }

  async convertToJob(currentUser: AuthenticatedUser, id: string) {
    const quote = await this.getQuoteForUser(currentUser, id);
    if (!roleCanConvertQuote(currentUser.role, quote.status)) {
      throw this.domainError(
        'QUOTE_INVALID_STATUS',
        'Only accepted quotes can be converted to a job.',
        HttpStatus.CONFLICT,
      );
    }
    if (quote.convertedAt || quote.status === 'CONVERTED') {
      throw this.domainError(
        'QUOTE_ALREADY_CONVERTED',
        'This quote has already been converted.',
        HttpStatus.CONFLICT,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const jobNumber = await this.nextJobNumber(tx, currentUser.businessId);
      const address = this.quoteAddress(quote);
      const job = await tx.job.create({
        data: {
          ...address,
          businessId: currentUser.businessId,
          customerId: quote.customerId,
          description: quote.description,
          internalNotes: `Created from ${quote.quoteNumber}. Accepted total ${formatAudCents(
            quote.totalCents,
          )}.`,
          jobNumber,
          priority: 'NORMAL',
          quoteCreated: true,
          requiresQuote: false,
          scheduledStart: new Date(),
          status: 'NEW',
          title: quote.title,
          createdBy: currentUser.id,
        },
      });
      const updated = await tx.quote.update({
        where: { id_businessId: { businessId: currentUser.businessId, id } },
        data: {
          convertedAt: new Date(),
          jobId: job.id,
          status: 'CONVERTED',
          updatedBy: currentUser.id,
        },
        include: this.quoteInclude(),
      });
      await this.writeAudit(
        tx,
        currentUser,
        'QUOTE_CONVERTED_TO_JOB',
        updated,
        {
          jobId: job.id,
          jobNumber,
        },
      );
      await tx.auditLog.create({
        data: {
          action: 'JOB_CREATED_FROM_QUOTE',
          actorUserId: currentUser.id,
          businessId: currentUser.businessId,
          entityId: job.id,
          entityType: 'Job',
          metadata: { quoteId: quote.id, quoteNumber: quote.quoteNumber },
        },
      });
      return { jobId: job.id, quoteId: updated.id };
    });

    return {
      ...(await this.findOne(currentUser, result.quoteId)),
      jobId: result.jobId,
      nextAction: 'Schedule appointment',
    };
  }

  async duplicate(currentUser: AuthenticatedUser, id: string) {
    const quote = await this.getQuoteForUser(currentUser, id);
    this.assertRole(currentUser, QUOTE_CREATE_ROLES);
    const dto: UpsertQuoteDto = {
      customerId: quote.customerId,
      customerNotes: quote.customerNotes ?? undefined,
      customerSiteId: quote.customerSiteId,
      depositType: quote.depositType,
      depositValue: quote.depositValue,
      description: quote.description ?? undefined,
      discountType: quote.discountType,
      discountValue: quote.discountValue,
      expiryDate: quote.expiryDate?.toISOString() ?? null,
      gstRateBasisPoints: quote.gstRateBasisPoints,
      internalNotes: quote.internalNotes ?? undefined,
      issueDate: new Date().toISOString(),
      jobId: quote.jobId,
      lineItems: quote.lineItems.map((item) => this.toPayload(item)),
      pricingMode: quote.pricingMode,
      sourceAppointmentId: quote.sourceAppointmentId,
      termsAndConditions: quote.termsAndConditions ?? undefined,
      title: `${quote.title} copy`,
    };
    return this.create(currentUser, dto);
  }

  async preview(currentUser: AuthenticatedUser, id: string) {
    const quote = (await this.findOne(currentUser, id)).quote;
    return {
      html: this.renderPreviewHtml(quote),
      quote,
    };
  }

  async pdf(currentUser: AuthenticatedUser, id: string) {
    const quote = (await this.findOne(currentUser, id)).quote;
    return {
      documentType: 'QUOTE_PRINT_READY_HTML',
      html: this.renderPreviewHtml(quote),
      message:
        'PDF provider seam is ready; local milestone returns reproducible print-ready HTML.',
      quoteId: quote.id,
    };
  }

  private async replaceQuoteContents(
    currentUser: AuthenticatedUser,
    id: string,
    dto: UpsertQuoteDto,
    action: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const calculated = calculateQuoteTotals({
        depositType: dto.depositType,
        depositValue: dto.depositValue,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        gstRateBasisPoints: dto.gstRateBasisPoints,
        lineItems: dto.lineItems,
        pricingMode: dto.pricingMode,
      });
      await tx.quoteLineItem.deleteMany({
        where: { businessId: currentUser.businessId, quoteId: id },
      });
      const quote = await tx.quote.update({
        where: { id_businessId: { businessId: currentUser.businessId, id } },
        data: {
          ...this.quoteData(currentUser, dto, calculated),
          lineItems: {
            create: calculated.lineItems.map((item, index) =>
              this.lineItemData(currentUser.businessId, item, index),
            ),
          },
        },
        include: this.quoteInclude(),
      });
      await this.writeAudit(tx, currentUser, action, quote, {
        totalCents: quote.totalCents,
      });
    });
  }

  private async assertEditableQuote(
    currentUser: AuthenticatedUser,
    id: string,
  ) {
    const quote = await this.getQuoteForUser(currentUser, id);
    if (!roleCanEditQuote(currentUser.role, quote.status)) {
      throw this.domainError(
        'QUOTE_EDIT_NOT_ALLOWED',
        'Only draft quotes can be edited.',
        HttpStatus.CONFLICT,
      );
    }
    return quote;
  }

  private async transition(
    currentUser: AuthenticatedUser,
    quote: QuoteRecord,
    nextStatus: QuoteStatus,
    data: Record<string, unknown>,
  ) {
    if (!canTransitionQuoteStatus(quote.status, nextStatus)) {
      throw this.domainError(
        'QUOTE_INVALID_STATUS',
        `Cannot move quote from ${quote.status} to ${nextStatus}.`,
        HttpStatus.CONFLICT,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      if (nextStatus === 'ACCEPTED') {
        await this.createRevision(tx, currentUser, quote, 'Accepted version');
      }
      const updated = await tx.quote.update({
        where: {
          id_businessId: { businessId: currentUser.businessId, id: quote.id },
        },
        data: { ...data, status: nextStatus, updatedBy: currentUser.id },
        include: this.quoteInclude(),
      });
      await this.writeAudit(
        tx,
        currentUser,
        QUOTE_STATUS_AUDIT_EVENTS[nextStatus] ?? 'QUOTE_STATUS_CHANGED',
        updated,
        {
          previousStatus: quote.status,
          status: nextStatus,
        },
      );
      return updated;
    });
  }

  private async getQuoteForUser(currentUser: AuthenticatedUser, id: string) {
    const quote = await this.prisma.quote.findFirst({
      where: {
        id,
        ...this.buildWhere(currentUser, {}),
      },
      include: this.quoteInclude(),
    });
    if (!quote) {
      throw this.domainError(
        'QUOTE_NOT_FOUND',
        'Quote could not be found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return quote;
  }

  private buildWhere(
    currentUser: AuthenticatedUser,
    query: ListQuotesQueryDto,
  ): Prisma.QuoteWhereInput {
    const where: Prisma.QuoteWhereInput = {
      archivedAt: null,
      businessId: currentUser.businessId,
    };
    if (query.status) where.status = query.status;
    if (query.customerId) where.customerId = query.customerId;
    if (query.createdBy) where.createdBy = query.createdBy;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
        lte: query.dateTo ? new Date(query.dateTo) : undefined,
      };
    }
    if (query.expired === 'true') {
      where.expiryDate = { lt: new Date() };
      where.status = { in: ['DRAFT', 'SENT', 'VIEWED'] };
    }
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { quoteNumber: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        {
          customer: { displayName: { contains: search, mode: 'insensitive' } },
        },
      ];
    }
    if (currentUser.role === 'TECHNICIAN') {
      where.OR = [
        ...(where.OR ?? []),
        { job: { assignedToUserId: currentUser.id } },
        { sourceAppointment: { assignedUserId: currentUser.id } },
        { createdBy: currentUser.id },
      ];
    }
    return where;
  }

  private orderBy(
    sortBy: ListQuotesQueryDto['sortBy'] = 'createdAt',
    sortOrder: ListQuotesQueryDto['sortOrder'] = 'desc',
  ): Prisma.QuoteOrderByWithRelationInput {
    return { [sortBy]: sortOrder };
  }

  private quoteData(
    currentUser: AuthenticatedUser,
    dto: UpsertQuoteDto,
    calculated: ReturnType<typeof calculateQuoteTotals>,
  ): Omit<Prisma.QuoteUncheckedCreateInput, 'quoteNumber'> {
    return {
      businessId: currentUser.businessId,
      currency: 'AUD',
      customerId: dto.customerId,
      customerNotes: this.clean(dto.customerNotes),
      customerSiteId: dto.customerSiteId || null,
      depositCents: calculated.depositCents,
      depositType: dto.depositType ?? 'NONE',
      depositValue: dto.depositValue ?? 0,
      description: this.clean(dto.description),
      discountCents: calculated.discountCents,
      discountType: dto.discountType ?? 'NONE',
      discountValue: dto.discountValue ?? 0,
      expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
      gstCents: calculated.gstCents,
      gstRateBasisPoints: dto.gstRateBasisPoints ?? 1000,
      internalNotes: this.clean(dto.internalNotes),
      issueDate: new Date(dto.issueDate),
      jobId: dto.jobId || null,
      pricingMode: dto.pricingMode,
      sourceAppointmentId: dto.sourceAppointmentId || null,
      status: 'DRAFT',
      subtotalCents: calculated.subtotalCents,
      termsAndConditions: this.clean(dto.termsAndConditions),
      title: dto.title.trim(),
      totalCents: calculated.totalCents,
      updatedBy: currentUser.id,
      createdBy: currentUser.id,
    };
  }

  private lineItemData(
    businessId: string,
    item: ReturnType<typeof calculateQuoteTotals>['lineItems'][number],
    position: number,
    quoteId?: string,
  ) {
    const data = {
      businessId,
      description: this.clean(item.description),
      lineGstCents: item.lineGstCents,
      lineSubtotalCents: item.lineSubtotalCents,
      lineTotalCents: item.lineTotalCents,
      name: item.name.trim(),
      position,
      quantity: item.quantity,
      taxable: item.taxable,
      type: item.type,
      unit: item.unit.trim() || 'item',
      unitPriceCents: item.unitPriceCents,
    };
    if (quoteId) {
      return { ...data, quoteId };
    }
    return data;
  }

  private async rewriteItemsAndTotals(
    tx: Prisma.TransactionClient,
    quote: QuoteRecord,
    items: QuoteLineItemPayload[],
  ) {
    const calculated = calculateQuoteTotals({
      depositType: quote.depositType,
      depositValue: quote.depositValue,
      discountType: quote.discountType,
      discountValue: quote.discountValue,
      gstRateBasisPoints: quote.gstRateBasisPoints,
      lineItems: items,
      pricingMode: quote.pricingMode,
    });
    await tx.quoteLineItem.deleteMany({
      where: { businessId: quote.businessId, quoteId: quote.id },
    });
    if (calculated.lineItems.length) {
      await tx.quoteLineItem.createMany({
        data: calculated.lineItems.map((item, index) => ({
          ...this.lineItemData(quote.businessId, item, index, quote.id),
          quoteId: quote.id,
        })),
      });
    }
    await this.updateTotals(tx, quote.id, calculated);
  }

  private async updateTotals(
    tx: Prisma.TransactionClient,
    quoteId: string,
    calculated: ReturnType<typeof calculateQuoteTotals>,
  ) {
    await tx.quote.update({
      where: { id: quoteId },
      data: {
        depositCents: calculated.depositCents,
        discountCents: calculated.discountCents,
        gstCents: calculated.gstCents,
        subtotalCents: calculated.subtotalCents,
        totalCents: calculated.totalCents,
      },
    });
  }

  private async assertQuoteContext(
    currentUser: AuthenticatedUser,
    dto: UpsertQuoteDto,
  ) {
    await this.assertCustomer(currentUser.businessId, dto.customerId);
    if (dto.customerSiteId) {
      const site = await this.prisma.customerSite.findFirst({
        where: {
          businessId: currentUser.businessId,
          customerId: dto.customerId,
          id: dto.customerSiteId,
          isArchived: false,
        },
      });
      if (!site) {
        throw this.domainError(
          'QUOTE_ACCESS_DENIED',
          'Customer site does not belong to this customer.',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    if (dto.jobId) {
      const job = await this.prisma.job.findFirst({
        where: {
          businessId: currentUser.businessId,
          customerId: dto.customerId,
          id: dto.jobId,
          isArchived: false,
        },
      });
      if (!job) {
        throw this.domainError(
          'QUOTE_ACCESS_DENIED',
          'Job does not belong to this customer.',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    if (dto.sourceAppointmentId) {
      const appointment = await this.prisma.appointment.findFirst({
        where: {
          businessId: currentUser.businessId,
          id: dto.sourceAppointmentId,
          job: { customerId: dto.customerId },
        },
      });
      if (!appointment) {
        throw this.domainError(
          'QUOTE_ACCESS_DENIED',
          'Appointment does not belong to this customer.',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
  }

  private async assertCustomer(businessId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { businessId, id: customerId, isArchived: false },
    });
    if (!customer) {
      throw this.domainError(
        'QUOTE_ACCESS_DENIED',
        'Customer could not be found.',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private async canTechnicianCreateDraft(
    currentUser: AuthenticatedUser,
    jobId?: string | null,
  ) {
    if (!jobId) return false;
    const job = await this.prisma.job.findFirst({
      where: {
        assignedToUserId: currentUser.id,
        businessId: currentUser.businessId,
        id: jobId,
      },
    });
    return Boolean(job);
  }

  private assertLineItems(items: QuoteLineItemPayload[]) {
    if (!items.length) {
      throw this.domainError(
        'QUOTE_LINE_ITEM_INVALID',
        'Add at least one line item.',
        HttpStatus.BAD_REQUEST,
      );
    }
    for (const item of items) {
      if (!/^\d+(\.\d{1,3})?$/.test(String(item.quantity))) {
        throw this.domainError(
          'QUOTE_LINE_ITEM_INVALID',
          'Line item quantity must be greater than zero with up to 3 decimals.',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (
        Number(item.quantity) <= 0 ||
        !Number.isFinite(Number(item.quantity))
      ) {
        throw this.domainError(
          'QUOTE_LINE_ITEM_INVALID',
          'Line item quantity must be greater than zero.',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
  }

  private assertDates(dto: UpsertQuoteDto) {
    if (dto.expiryDate && new Date(dto.expiryDate) < new Date(dto.issueDate)) {
      throw this.domainError(
        'QUOTE_EXPIRY_INVALID',
        'Quote expiry must be after the issue date.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private assertRole(
    currentUser: AuthenticatedUser,
    allowedRoles: readonly string[],
  ) {
    if (!allowedRoles.includes(currentUser.role)) {
      throw this.domainError(
        'QUOTE_ACCESS_DENIED',
        'You do not have permission to manage quotes.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async nextQuoteNumber(
    tx: Prisma.TransactionClient,
    businessId: string,
    issueDate: Date,
  ) {
    await tx.quoteSequence.upsert({
      where: { businessId },
      create: { businessId, nextNumber: 1 },
      update: {},
    });
    const sequence = await tx.quoteSequence.update({
      where: { businessId },
      data: { nextNumber: { increment: 1 } },
    });
    return `Q-${issueDate.getUTCFullYear()}-${String(
      sequence.nextNumber,
    ).padStart(6, '0')}`;
  }

  private async nextJobNumber(
    tx: Prisma.TransactionClient,
    businessId: string,
  ) {
    await tx.jobSequence.upsert({
      where: { businessId },
      create: { businessId, nextNumber: 1 },
      update: {},
    });
    const sequence = await tx.jobSequence.update({
      where: { businessId },
      data: { nextNumber: { increment: 1 } },
    });
    return `JOB-${new Date().getUTCFullYear()}-${String(
      sequence.nextNumber,
    ).padStart(6, '0')}`;
  }

  private async createRevision(
    tx: Prisma.TransactionClient,
    currentUser: AuthenticatedUser,
    quote: QuoteRecord,
    reason: string,
  ) {
    await tx.quoteRevision.create({
      data: {
        businessId: currentUser.businessId,
        createdBy: currentUser.id,
        quoteId: quote.id,
        reason,
        snapshot: this.toQuote(quote) as unknown as Prisma.InputJsonValue,
        status: quote.status,
        version: quote.version,
      },
    });
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    currentUser: AuthenticatedUser,
    action: string,
    quote: Pick<
      QuoteRecord,
      | 'id'
      | 'quoteNumber'
      | 'customerId'
      | 'jobId'
      | 'sourceAppointmentId'
      | 'status'
    >,
    metadata: Record<string, unknown>,
  ) {
    await tx.auditLog.create({
      data: {
        action,
        actorUserId: currentUser.id,
        businessId: currentUser.businessId,
        entityId: quote.id,
        entityType: 'Quote',
        metadata: {
          customerId: quote.customerId,
          jobId: quote.jobId,
          quoteNumber: quote.quoteNumber,
          sourceAppointmentId: quote.sourceAppointmentId,
          ...metadata,
        },
      },
    });
  }

  private quoteInclude() {
    return {
      customer: {
        select: {
          companyName: true,
          displayName: true,
          email: true,
          id: true,
          phone: true,
        },
      },
      customerSite: true,
      job: { select: { id: true, jobNumber: true, title: true } },
      lineItems: { orderBy: { position: 'asc' as const } },
    };
  }

  private toPayload(item: QuoteRecord['lineItems'][number]): QuoteLineItemDto {
    return {
      description: item.description ?? undefined,
      name: item.name,
      quantity: String(item.quantity),
      taxable: item.taxable,
      type: item.type,
      unit: item.unit,
      unitPriceCents: item.unitPriceCents,
    };
  }

  private toQuote(quote: QuoteRecord): Quote {
    return {
      acceptedAt: quote.acceptedAt?.toISOString() ?? null,
      acceptedByEmail: quote.acceptedByEmail,
      acceptedByName: quote.acceptedByName,
      archivedAt: quote.archivedAt?.toISOString() ?? null,
      businessId: quote.businessId,
      cancelledAt: quote.cancelledAt?.toISOString() ?? null,
      convertedAt: quote.convertedAt?.toISOString() ?? null,
      createdAt: quote.createdAt.toISOString(),
      createdBy: quote.createdBy,
      currency: 'AUD',
      customer: quote.customer,
      customerId: quote.customerId,
      customerNotes: quote.customerNotes,
      customerSite: quote.customerSite
        ? {
            addressLine1: quote.customerSite.addressLine1,
            addressLine2: quote.customerSite.addressLine2,
            id: quote.customerSite.id,
            label: quote.customerSite.label,
            postcode: quote.customerSite.postcode,
            state: quote.customerSite.state,
            suburb: quote.customerSite.suburb,
          }
        : null,
      customerSiteId: quote.customerSiteId,
      declinedAt: quote.declinedAt?.toISOString() ?? null,
      depositCents: quote.depositCents,
      depositType: quote.depositType,
      depositValue: quote.depositValue,
      description: quote.description,
      discountCents: quote.discountCents,
      discountType: quote.discountType,
      discountValue: quote.discountValue,
      expiredAt: quote.expiredAt?.toISOString() ?? null,
      expiryDate: quote.expiryDate?.toISOString() ?? null,
      gstCents: quote.gstCents,
      gstRateBasisPoints: quote.gstRateBasisPoints,
      id: quote.id,
      internalNotes: quote.internalNotes,
      issueDate: quote.issueDate.toISOString(),
      job: quote.job,
      jobId: quote.jobId,
      lineItems: quote.lineItems.map((item) => this.toLineItem(item)),
      pricingMode: quote.pricingMode,
      quoteNumber: quote.quoteNumber,
      sentAt: quote.sentAt?.toISOString() ?? null,
      sourceAppointmentId: quote.sourceAppointmentId,
      status: quote.status,
      subtotalCents: quote.subtotalCents,
      termsAndConditions: quote.termsAndConditions,
      title: quote.title,
      totalCents: quote.totalCents,
      updatedAt: quote.updatedAt.toISOString(),
      updatedBy: quote.updatedBy,
      version: quote.version,
      viewedAt: quote.viewedAt?.toISOString() ?? null,
    };
  }

  private toLineItem(item: QuoteRecord['lineItems'][number]): QuoteLineItem {
    return {
      businessId: item.businessId,
      createdAt: item.createdAt.toISOString(),
      description: item.description,
      id: item.id,
      lineGstCents: item.lineGstCents,
      lineSubtotalCents: item.lineSubtotalCents,
      lineTotalCents: item.lineTotalCents,
      name: item.name,
      position: item.position,
      quantity: String(item.quantity),
      quoteId: item.quoteId,
      taxable: item.taxable,
      type: item.type,
      unit: item.unit,
      unitPriceCents: item.unitPriceCents,
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private quoteAddress(quote: QuoteRecord) {
    const site = quote.customerSite;
    return {
      accessInstructions: site?.accessInstructions ?? null,
      addressLine1: site?.addressLine1 ?? 'Address to be confirmed',
      addressLine2: site?.addressLine2 ?? null,
      postcode: site?.postcode ?? '0000',
      state: site?.state ?? 'NSW',
      suburb: site?.suburb ?? 'To be confirmed',
    };
  }

  private renderPreviewHtml(quote: Quote) {
    const rows = quote.lineItems
      .map(
        (item) =>
          `<tr><td>${this.escape(item.name)}</td><td>${item.quantity} ${
            item.unit
          }</td><td>${formatAudCents(item.unitPriceCents)}</td><td>${formatAudCents(
            item.lineTotalCents,
          )}</td></tr>`,
      )
      .join('');
    return `<!doctype html><html><body><h1>${quote.quoteNumber}</h1><h2>${this.escape(
      quote.title,
    )}</h2><p>${this.escape(quote.customer.displayName)}</p><table>${rows}</table><p>Subtotal: ${formatAudCents(
      quote.subtotalCents,
    )}</p><p>GST: ${formatAudCents(quote.gstCents)}</p><h2>Total: ${formatAudCents(
      quote.totalCents,
    )}</h2></body></html>`;
  }

  private clean(value?: string | null) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private escape(value: string) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  private domainError(code: string, message: string, status: HttpStatus) {
    return new HttpException({ code, message }, status);
  }
}
