import { createHash, randomBytes } from 'crypto';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  QUOTE_SEND_ROLES,
  QUOTE_VIEW_ROLES,
  calculateQuoteTotals,
  canTransitionQuoteStatus,
  formatAudCents,
  parseQuoteQuantityInput,
  roleCanAcceptOrDeclineQuote,
  roleCanCancelQuote,
  roleCanConvertQuote,
  roleCanEditQuote,
  roleCanReviseQuote,
} from '@tradieos/shared';
import type { Prisma } from '../generated/prisma/client';
import { CustomerCommunicationsService } from '../communications/communications.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ListQuotesQueryDto,
  QuoteAcceptanceDto,
  QuoteLineItemDto,
  QuoteReasonDto,
  PublicQuoteAcceptanceDto,
  PublicQuoteDeclineDto,
  ReorderQuoteItemsDto,
  SendQuoteDto,
  UpsertQuoteDto,
} from './dto/quotes.dto';
import { STORAGE_PROVIDER } from '../media/storage-provider';
import type { StorageProvider } from '../media/storage-provider';
import {
  ConsoleQuoteEmailProvider,
  type QuoteEmailProvider,
} from './quote-email.provider';
import {
  DeterministicQuotePdfProvider,
  type QuotePdfProvider,
} from './quote-pdf.provider';

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
  private readonly logger = new Logger(QuotesService.name);
  private readonly emailProvider: QuoteEmailProvider =
    new ConsoleQuoteEmailProvider();
  private readonly pdfProvider: QuotePdfProvider =
    new DeterministicQuotePdfProvider();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly communications: CustomerCommunicationsService,
  ) {}

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
    const documents = await this.prisma.quotePdfDocument.findMany({
      where: { businessId: currentUser.businessId, quoteId: quote.id },
      orderBy: { generatedAt: 'desc' },
    });
    return {
      activity: activity.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
        metadata: (entry.metadata as Record<string, unknown> | null) ?? null,
      })),
      documents: documents.map((document) => this.toPdfDocument(document)),
      quote: this.toQuote(quote),
    };
  }

  async create(currentUser: AuthenticatedUser, dto: UpsertQuoteDto) {
    this.logCreate('QUOTE_CREATE_REQUEST', currentUser, dto);
    try {
      this.logCreate('QUOTE_CREATE_AUTH_CONTEXT', currentUser, dto);
      this.assertRole(currentUser, QUOTE_CREATE_ROLES);
      this.assertDates(dto);
      this.assertLineItems(dto.lineItems);
      this.logCreate('QUOTE_CREATE_PAYLOAD_PARSED', currentUser, dto);
      await this.assertQuoteContext(currentUser, dto);
      this.logCreate('QUOTE_CREATE_RELATIONS_VALIDATED', currentUser, dto);
      const created = await this.prisma.$transaction(async (tx) => {
        this.logCreate('QUOTE_CREATE_TRANSACTION_STARTED', currentUser, dto);
        const quoteNumber = await this.nextQuoteNumber(
          tx,
          currentUser.businessId,
          new Date(dto.issueDate),
        );
        this.logCreate('QUOTE_CREATE_NUMBER_ALLOCATED', currentUser, dto, {
          quoteNumber,
        });
        const calculated = calculateQuoteTotals({
          depositType: dto.depositType,
          depositValue: dto.depositValue,
          discountType: dto.discountType,
          discountValue: dto.discountValue,
          gstRateBasisPoints: dto.gstRateBasisPoints,
          lineItems: dto.lineItems,
          pricingMode: dto.pricingMode,
        });
        this.logCreate('QUOTE_CREATE_TOTALS_CALCULATED', currentUser, dto, {
          discountCents: calculated.discountCents,
          gstCents: calculated.gstCents,
          subtotalCents: calculated.subtotalCents,
          totalCents: calculated.totalCents,
        });
        const quote = await tx.quote.create({
          data: {
            ...this.quoteData(currentUser, dto, calculated),
            quoteNumber,
          },
          include: this.quoteInclude(),
        });
        this.logCreate('QUOTE_CREATE_QUOTE_INSERTED', currentUser, dto, {
          quoteId: quote.id,
          quoteNumber: quote.quoteNumber,
        });
        await this.createLineItems(
          tx,
          currentUser.businessId,
          quote.id,
          calculated,
        );
        this.logCreate('QUOTE_CREATE_ITEMS_INSERTED', currentUser, dto, {
          itemCount: calculated.lineItems.length,
          quoteId: quote.id,
        });
        const quoteWithItems = await tx.quote.findUniqueOrThrow({
          where: {
            id_businessId: { businessId: currentUser.businessId, id: quote.id },
          },
          include: this.quoteInclude(),
        });
        await this.writeAudit(
          tx,
          currentUser,
          'QUOTE_CREATED',
          quoteWithItems,
          {
            status: quoteWithItems.status,
          },
        );
        if (quoteWithItems.relatedJobId) {
          await tx.job.update({
            where: {
              id_businessId: {
                businessId: currentUser.businessId,
                id: quoteWithItems.relatedJobId,
              },
            },
            data: { quoteCreated: true },
          });
          await this.writeAudit(
            tx,
            currentUser,
            'QUOTE_CREATED_FOR_JOB',
            quoteWithItems,
            {
              relatedJobId: quoteWithItems.relatedJobId,
              status: quoteWithItems.status,
            },
          );
        }
        return quoteWithItems;
      });
      this.logCreate('QUOTE_CREATE_TRANSACTION_COMMITTED', currentUser, dto, {
        quoteId: created.id,
        quoteNumber: created.quoteNumber,
      });

      return this.findOne(currentUser, created.id);
    } catch (error) {
      this.logCreateFailure(currentUser, dto, error);
      throw this.mapCreateFailure(error);
    }
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

  async send(currentUser: AuthenticatedUser, id: string, dto?: SendQuoteDto) {
    const quote = await this.getQuoteForUser(currentUser, id);
    if (
      !QUOTE_SEND_ROLES.includes(currentUser.role) ||
      !['DRAFT', 'SENT', 'VIEWED'].includes(quote.status)
    ) {
      throw this.domainError(
        'QUOTE_INVALID_STATUS',
        'This quote is not eligible to send.',
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
    const to = dto?.to?.trim() || quote.customer.email?.trim();
    if (!to) {
      throw this.domainError(
        'QUOTE_EMAIL_REQUIRED',
        'Add a customer email before sending this quote.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const business = await this.getBusiness(currentUser.businessId);
    const subject =
      dto?.subject?.trim() ||
      `Quote ${quote.quoteNumber} from ${business.name}`;
    const message =
      dto?.message?.trim() ||
      `Hi ${quote.customer.displayName}, please review quote ${quote.quoteNumber}.`;
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const revision = await this.createRevision(
        tx,
        currentUser,
        quote,
        quote.status === 'DRAFT' ? 'Customer-facing send' : 'Resend',
      );
      const pdf = await this.generateAndStorePdf(
        tx,
        currentUser,
        quote,
        revision.id,
        business,
      );
      const token = await this.createPublicToken(
        tx,
        currentUser.businessId,
        quote.id,
        revision.id,
        quote.version,
      );
      const next = await tx.quote.update({
        where: { id_businessId: { businessId: currentUser.businessId, id } },
        data: {
          sentAt: quote.sentAt ?? now,
          status: quote.status === 'DRAFT' ? 'SENT' : quote.status,
          updatedBy: currentUser.id,
        },
        include: this.quoteInclude(),
      });
      await this.writeAudit(
        tx,
        currentUser,
        quote.status === 'DRAFT' ? 'QUOTE_SENT' : 'QUOTE_RESENT',
        next,
        {
          pdfDocumentId: pdf.id,
          quoteRevisionId: revision.id,
          publicTokenId: token.id,
          to,
        },
      );
      return { pdf, token: token.rawToken, quote: next };
    });

    const publicUrl = this.publicQuoteUrl(result.token);
    const delivery = await this.emailProvider.sendQuote({
      businessName: business.name,
      message,
      pdfFileName: result.pdf.fileName,
      quoteNumber: quote.quoteNumber,
      quoteUrl: publicUrl,
      subject,
      to,
    });
    if (delivery.status !== 'SENT') {
      throw this.domainError(
        'QUOTE_SEND_FAILED',
        'Quote email could not be sent. Please try again.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    await this.communications.quoteSent({
      businessId: currentUser.businessId,
      createdBy: currentUser.id,
      publicUrl,
      quoteId: result.quote.id,
    });

    return {
      ...(await this.findOne(currentUser, result.quote.id)),
      pdfDocument: this.toPdfDocument(result.pdf),
      publicQuoteUrl: publicUrl,
    };
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
    await this.communications.quoteFinalised(
      currentUser.businessId,
      updated.id,
    );
    return this.findOne(currentUser, updated.id);
  }

  async accept(
    currentUser: AuthenticatedUser,
    id: string,
    dto: QuoteAcceptanceDto,
  ) {
    const quote = await this.getQuoteForUser(currentUser, id);
    if (!roleCanAcceptOrDeclineQuote(currentUser.role, quote.status)) {
      throw this.domainError(
        'QUOTE_ACCESS_DENIED',
        'You do not have permission to mark quotes accepted.',
        HttpStatus.FORBIDDEN,
      );
    }
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
    if (updated.relatedJobId) {
      await this.prisma.auditLog.create({
        data: {
          action: 'QUOTE_ACCEPTED_FOR_EXISTING_JOB',
          actorUserId: currentUser.id,
          businessId: currentUser.businessId,
          entityId: updated.id,
          entityType: 'Quote',
          metadata: {
            quoteNumber: updated.quoteNumber,
            relatedJobId: updated.relatedJobId,
          },
        },
      });
    }
    await this.communications.quoteFinalised(
      currentUser.businessId,
      updated.id,
    );
    return this.findOne(currentUser, updated.id);
  }

  async decline(
    currentUser: AuthenticatedUser,
    id: string,
    dto: QuoteReasonDto,
  ) {
    const quote = await this.getQuoteForUser(currentUser, id);
    if (!roleCanAcceptOrDeclineQuote(currentUser.role, quote.status)) {
      throw this.domainError(
        'QUOTE_ACCESS_DENIED',
        'You do not have permission to decline quotes.',
        HttpStatus.FORBIDDEN,
      );
    }
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
    await this.communications.quoteFinalised(
      currentUser.businessId,
      updated.id,
    );
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
    await this.communications.quoteFinalised(
      currentUser.businessId,
      updated.id,
    );
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
    if (quote.relatedJobId) {
      throw this.domainError(
        'QUOTE_ALREADY_RELATED_TO_JOB',
        'This accepted quote is already related to an existing job.',
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
          sourceQuoteId: quote.id,
          status: 'NEW',
          title: this.convertedJobTitle(quote),
          createdBy: currentUser.id,
        },
      });
      const updated = await tx.quote.update({
        where: { id_businessId: { businessId: currentUser.businessId, id } },
        data: {
          convertedJobId: job.id,
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

    await this.communications.quoteFinalised(
      currentUser.businessId,
      result.quoteId,
    );
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
      relatedJobId: quote.relatedJobId,
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
    const business = await this.getBusiness(currentUser.businessId);
    return {
      business,
      html: this.renderPreviewHtml(quote),
      quote,
    };
  }

  async pdf(currentUser: AuthenticatedUser, id: string) {
    const quote = await this.getQuoteForUser(currentUser, id);
    const business = await this.getBusiness(currentUser.businessId);
    const revision = await this.prisma.quoteRevision.findFirst({
      where: {
        businessId: currentUser.businessId,
        quoteId: quote.id,
        version: quote.version,
      },
      orderBy: { createdAt: 'desc' },
    });
    const document =
      (await this.prisma.quotePdfDocument.findFirst({
        where: {
          businessId: currentUser.businessId,
          quoteId: quote.id,
          version: quote.version,
        },
        orderBy: { generatedAt: 'desc' },
      })) ??
      (await this.prisma.$transaction(async (tx) => {
        const frozen =
          revision ??
          (await this.createRevision(tx, currentUser, quote, 'PDF generated'));
        return this.generateAndStorePdf(
          tx,
          currentUser,
          quote,
          frozen.id,
          business,
        );
      }));
    const buffer = await this.storage.readObject({
      objectKey: document.objectKey,
    });
    return {
      buffer,
      fileName: document.fileName,
      mimeType: document.mimeType,
    };
  }

  async publicPreview(token: string, markViewed = true) {
    const context = await this.resolvePublicToken(token);
    const quote = this.snapshotQuote(context.revision.snapshot);
    const business = await this.getBusiness(context.token.businessId);
    const now = new Date();
    const state = this.publicState(context.quote, context.token, now);
    if (markViewed && state === 'ACTIVE') {
      await this.prisma.$transaction(async (tx) => {
        const firstViewedAt = context.quote.firstViewedAt ?? now;
        const status =
          context.quote.status === 'SENT' ? 'VIEWED' : context.quote.status;
        await tx.quote.update({
          where: {
            id_businessId: {
              businessId: context.quote.businessId,
              id: context.quote.id,
            },
          },
          data: {
            firstViewedAt,
            latestViewedAt: now,
            status,
            viewedAt: context.quote.viewedAt ?? now,
            viewCount: { increment: 1 },
          },
        });
        await tx.quotePublicAccessToken.update({
          where: { id: context.token.id },
          data: { lastViewedAt: now, viewCount: { increment: 1 } },
        });
        await tx.auditLog.create({
          data: {
            action: 'QUOTE_VIEWED',
            actorUserId: null,
            businessId: context.quote.businessId,
            entityId: context.quote.id,
            entityType: 'Quote',
            metadata: {
              publicTokenId: context.token.id,
              quoteNumber: context.quote.quoteNumber,
              quoteRevisionId: context.revision.id,
              version: context.revision.version,
            },
          },
        });
      });
    }
    return {
      business,
      quote: this.publicQuote(quote),
      state,
    };
  }

  async publicAccept(token: string, dto: PublicQuoteAcceptanceDto) {
    if (!dto.acceptedByName?.trim()) {
      throw this.domainError(
        'QUOTE_ACCEPTANCE_NAME_REQUIRED',
        'Enter your name to accept this quote.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!dto.acceptedTerms) {
      throw this.domainError(
        'QUOTE_ACCEPTANCE_CONFIRMATION_REQUIRED',
        'Confirm that you accept the quote terms.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const context = await this.resolvePublicToken(token);
    this.assertPublicMutationAllowed(context);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.quote.update({
        where: {
          id_businessId: {
            businessId: context.quote.businessId,
            id: context.quote.id,
          },
        },
        data: {
          acceptedAt: now,
          acceptedByEmail: context.quote.customer.email,
          acceptedByName: dto.acceptedByName.trim(),
          acceptedQuoteVersion: context.revision.version,
          status: 'ACCEPTED',
          updatedBy: null,
        },
      });
      await tx.quotePublicAccessToken.update({
        where: { id: context.token.id },
        data: { acceptedAt: now },
      });
      await tx.auditLog.create({
        data: {
          action: 'QUOTE_ACCEPTED',
          actorUserId: null,
          businessId: context.quote.businessId,
          entityId: context.quote.id,
          entityType: 'Quote',
          metadata: {
            acceptedByName: dto.acceptedByName.trim(),
            acceptedByTitle: dto.acceptedByTitle ?? null,
            acceptedTotalCents: context.quote.totalCents,
            note: dto.note ?? null,
            publicTokenId: context.token.id,
            quoteNumber: context.quote.quoteNumber,
            quoteRevisionId: context.revision.id,
            version: context.revision.version,
          },
        },
      });
    });
    await this.communications.quoteFinalised(
      context.quote.businessId,
      context.quote.id,
    );
    return this.publicPreview(token, false);
  }

  async publicDecline(token: string, dto: PublicQuoteDeclineDto) {
    const context = await this.resolvePublicToken(token);
    this.assertPublicMutationAllowed(context);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.quote.update({
        where: {
          id_businessId: {
            businessId: context.quote.businessId,
            id: context.quote.id,
          },
        },
        data: {
          declinedAt: now,
          declineComment: this.clean(dto.comment),
          declineReason: dto.reason ?? null,
          status: 'DECLINED',
          updatedBy: null,
        },
      });
      await tx.quotePublicAccessToken.update({
        where: { id: context.token.id },
        data: { declinedAt: now },
      });
      await tx.auditLog.create({
        data: {
          action: 'QUOTE_DECLINED',
          actorUserId: null,
          businessId: context.quote.businessId,
          entityId: context.quote.id,
          entityType: 'Quote',
          metadata: {
            comment: dto.comment ?? null,
            publicTokenId: context.token.id,
            quoteNumber: context.quote.quoteNumber,
            quoteRevisionId: context.revision.id,
            reason: dto.reason ?? null,
            version: context.revision.version,
          },
        },
      });
    });
    await this.communications.quoteFinalised(
      context.quote.businessId,
      context.quote.id,
    );
    return this.publicPreview(token, false);
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
      await tx.quote.update({
        where: { id_businessId: { businessId: currentUser.businessId, id } },
        data: {
          ...this.quoteData(currentUser, dto, calculated),
        },
        include: this.quoteInclude(),
      });
      await this.createLineItems(tx, currentUser.businessId, id, calculated);
      const quoteWithItems = await tx.quote.findUniqueOrThrow({
        where: { id_businessId: { businessId: currentUser.businessId, id } },
        include: this.quoteInclude(),
      });
      await this.writeAudit(tx, currentUser, action, quoteWithItems, {
        totalCents: quoteWithItems.totalCents,
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
    const and: Prisma.QuoteWhereInput[] = [];
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
      and.push({
        OR: [
          { quoteNumber: { contains: search, mode: 'insensitive' } },
          { title: { contains: search, mode: 'insensitive' } },
          {
            customer: {
              displayName: { contains: search, mode: 'insensitive' },
            },
          },
        ],
      });
    }
    if (currentUser.role === 'TECHNICIAN') {
      and.push({
        OR: [
          { job: { assignedToUserId: currentUser.id } },
          { relatedJob: { assignedToUserId: currentUser.id } },
          { convertedJob: { assignedToUserId: currentUser.id } },
          { sourceAppointment: { assignedUserId: currentUser.id } },
        ],
      });
    }
    if (and.length) where.AND = and;
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
    const relatedJobId = this.relatedJobId(dto);
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
      jobId: relatedJobId,
      relatedJobId,
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

  private relatedJobId(dto: UpsertQuoteDto) {
    return dto.relatedJobId || dto.jobId || null;
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

  private async createLineItems(
    tx: Prisma.TransactionClient,
    businessId: string,
    quoteId: string,
    calculated: ReturnType<typeof calculateQuoteTotals>,
  ) {
    if (!calculated.lineItems.length) return;
    await tx.quoteLineItem.createMany({
      data: calculated.lineItems.map((item, index) => ({
        ...this.lineItemData(businessId, item, index, quoteId),
        quoteId,
      })),
    });
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
    const relatedJobId = this.relatedJobId(dto);
    if (relatedJobId) {
      const job = await this.prisma.job.findFirst({
        where: {
          businessId: currentUser.businessId,
          customerId: dto.customerId,
          id: relatedJobId,
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

  private assertLineItems(items: QuoteLineItemPayload[]) {
    if (!items.length) {
      throw this.domainError(
        'QUOTE_LINE_ITEM_INVALID',
        'Add at least one line item.',
        HttpStatus.BAD_REQUEST,
      );
    }
    for (const item of items) {
      const quantity = parseQuoteQuantityInput(String(item.quantity));
      if (quantity.error) {
        throw this.domainError(
          'QUOTE_QUANTITY_INVALID',
          quantity.error,
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!quantity.value) {
        throw this.domainError(
          'QUOTE_QUANTITY_INVALID',
          'Enter a quantity.',
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
    const snapshot = this.toQuote(quote);
    return tx.quoteRevision.upsert({
      create: {
        businessId: currentUser.businessId,
        createdBy: currentUser.id,
        quoteId: quote.id,
        reason,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        snapshotHash: this.hashJson(snapshot),
        status: quote.status,
        version: quote.version,
      },
      update: {},
      where: {
        businessId_quoteId_version: {
          businessId: currentUser.businessId,
          quoteId: quote.id,
          version: quote.version,
        },
      },
    });
  }

  private async generateAndStorePdf(
    tx: Prisma.TransactionClient,
    currentUser: AuthenticatedUser,
    quote: QuoteRecord,
    quoteRevisionId: string,
    business: Awaited<ReturnType<QuotesService['getBusiness']>>,
  ) {
    const existing = await tx.quotePdfDocument.findFirst({
      where: {
        businessId: currentUser.businessId,
        quoteId: quote.id,
        version: quote.version,
      },
    });
    if (existing && quote.status !== 'DRAFT') return existing;

    const generated = this.pdfProvider.generateQuotePdf({
      business,
      quote: this.toQuote(quote),
    });
    const objectKey = this.storage.createObjectKey({
      businessId: currentUser.businessId,
      mediaType: 'PDF',
      originalFileName: generated.fileName,
    });
    const metadata = await this.storage.uploadFile({
      content: generated.buffer,
      mimeType: generated.mimeType,
      objectKey,
    });
    if (existing) {
      return tx.quotePdfDocument.update({
        where: { id: existing.id },
        data: {
          checksum: metadata.checksum ?? generated.checksum,
          fileName: generated.fileName,
          fileSizeBytes: metadata.contentLength || generated.buffer.length,
          generatedAt: new Date(),
          mimeType: generated.mimeType,
          objectKey,
          quoteRevisionId,
          storageProvider: this.storage.name,
        },
      });
    }
    return tx.quotePdfDocument.create({
      data: {
        businessId: currentUser.businessId,
        checksum: metadata.checksum ?? generated.checksum,
        fileName: generated.fileName,
        fileSizeBytes: metadata.contentLength || generated.buffer.length,
        mimeType: generated.mimeType,
        objectKey,
        quoteId: quote.id,
        quoteRevisionId,
        storageProvider: this.storage.name,
        version: quote.version,
      },
    });
  }

  private async createPublicToken(
    tx: Prisma.TransactionClient,
    businessId: string,
    quoteId: string,
    quoteRevisionId: string,
    version: number,
  ) {
    await tx.quotePublicAccessToken.updateMany({
      where: {
        acceptedAt: null,
        businessId,
        declinedAt: null,
        quoteId,
        revokedAt: null,
        version: { lt: version },
      },
      data: { revokedAt: new Date() },
    });
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const token = await tx.quotePublicAccessToken.create({
      data: {
        businessId,
        expiresAt,
        quoteId,
        quoteRevisionId,
        tokenHash,
        version,
      },
    });
    return { ...token, rawToken };
  }

  private async resolvePublicToken(rawToken: string) {
    if (!rawToken?.trim()) {
      throw this.domainError(
        'QUOTE_PUBLIC_TOKEN_INVALID',
        'This quote link is not valid.',
        HttpStatus.NOT_FOUND,
      );
    }
    const tokenHash = this.hashToken(rawToken);
    const token = await this.prisma.quotePublicAccessToken.findUnique({
      where: { tokenHash },
      include: {
        quote: { include: this.quoteInclude() },
        quoteRevision: true,
      },
    });
    if (!token) {
      throw this.domainError(
        'QUOTE_PUBLIC_TOKEN_INVALID',
        'This quote link is not valid.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (token.revokedAt) {
      throw this.domainError(
        'QUOTE_SUPERSEDED',
        'A newer quote revision is available. Please use the latest quote link.',
        HttpStatus.GONE,
      );
    }
    if (token.expiresAt < new Date()) {
      throw this.domainError(
        'QUOTE_PUBLIC_TOKEN_EXPIRED',
        'This quote link has expired.',
        HttpStatus.GONE,
      );
    }
    return {
      quote: token.quote,
      revision: token.quoteRevision,
      token,
    };
  }

  private assertPublicMutationAllowed(
    context: Awaited<ReturnType<QuotesService['resolvePublicToken']>>,
  ) {
    const now = new Date();
    if (context.quote.expiryDate && context.quote.expiryDate < now) {
      throw this.domainError(
        'QUOTE_EXPIRED',
        'This quote has expired. Please contact the business.',
        HttpStatus.CONFLICT,
      );
    }
    if (context.quote.status === 'ACCEPTED' || context.token.acceptedAt) {
      throw this.domainError(
        'QUOTE_ALREADY_ACCEPTED',
        'This quote has already been accepted.',
        HttpStatus.CONFLICT,
      );
    }
    if (context.quote.status === 'DECLINED' || context.token.declinedAt) {
      throw this.domainError(
        'QUOTE_ALREADY_DECLINED',
        'This quote has already been declined.',
        HttpStatus.CONFLICT,
      );
    }
    if (context.quote.status === 'EXPIRED') {
      throw this.domainError(
        'QUOTE_EXPIRED',
        'This quote has expired. Please contact the business.',
        HttpStatus.CONFLICT,
      );
    }
    if (context.revision.version !== context.quote.version) {
      throw this.domainError(
        'QUOTE_SUPERSEDED',
        'A newer quote revision is available. Please use the latest quote link.',
        HttpStatus.CONFLICT,
      );
    }
    if (!['SENT', 'VIEWED'].includes(context.quote.status)) {
      throw this.domainError(
        'QUOTE_INVALID_STATUS',
        'This quote cannot be accepted or declined.',
        HttpStatus.CONFLICT,
      );
    }
  }

  private publicState(
    quote: QuoteRecord,
    token: { acceptedAt: Date | null; declinedAt: Date | null },
    now: Date,
  ) {
    if (quote.status === 'CONVERTED') return 'CONVERTED';
    if (quote.status === 'ACCEPTED' || token.acceptedAt) return 'ACCEPTED';
    if (quote.status === 'DECLINED' || token.declinedAt) return 'DECLINED';
    if (quote.expiryDate && quote.expiryDate < now) return 'EXPIRED';
    if (quote.status === 'EXPIRED') return 'EXPIRED';
    if (quote.status === 'CANCELLED') return 'CANCELLED';
    return 'ACTIVE';
  }

  private publicQuote(quote: Quote) {
    return {
      acceptedAt: quote.acceptedAt,
      acceptedByName: quote.acceptedByName,
      customer: {
        displayName: quote.customer.displayName,
        email: quote.customer.email,
        phone: quote.customer.phone,
      },
      customerNotes: quote.customerNotes,
      customerSite: quote.customerSite,
      declinedAt: quote.declinedAt,
      depositCents: quote.depositCents,
      description: quote.description,
      discountCents: quote.discountCents,
      expiryDate: quote.expiryDate,
      gstCents: quote.gstCents,
      issueDate: quote.issueDate,
      lineItems: quote.lineItems.map((item) => ({
        lineTotalCents: item.lineTotalCents,
        name: item.name,
        quantity: item.quantity,
        taxable: item.taxable,
        type: item.type,
        unit: item.unit,
        unitPriceCents: item.unitPriceCents,
      })),
      pricingMode: quote.pricingMode,
      quoteNumber: quote.quoteNumber,
      status: quote.status,
      subtotalCents: quote.subtotalCents,
      termsAndConditions: quote.termsAndConditions,
      title: quote.title,
      totalCents: quote.totalCents,
      version: quote.version,
    };
  }

  private snapshotQuote(snapshot: Prisma.JsonValue): Quote {
    const quote = snapshot as unknown as Quote;
    return {
      ...quote,
      convertedJob: quote.convertedJob ?? null,
      convertedJobId: quote.convertedJobId ?? null,
      job: quote.job ?? null,
      jobId: quote.jobId ?? null,
      relatedJob: quote.relatedJob ?? null,
      relatedJobId: quote.relatedJobId ?? null,
    };
  }

  private toPdfDocument(document: {
    id: string;
    fileName: string;
    fileSizeBytes: number;
    generatedAt: Date;
    mimeType: string;
    version: number;
  }) {
    return {
      fileName: document.fileName,
      fileSizeBytes: document.fileSizeBytes,
      generatedAt: document.generatedAt.toISOString(),
      id: document.id,
      mimeType: document.mimeType,
      version: document.version,
    };
  }

  private publicQuoteUrl(token: string) {
    const base =
      this.config.get<string>('PUBLIC_APP_URL') ??
      this.config.get<string>('EXPO_PUBLIC_APP_URL') ??
      'http://localhost:8081';
    return `${base.replace(/\/$/, '')}/quote/${encodeURIComponent(token)}`;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private hashJson(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private async getBusiness(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: {
        abn: true,
        address: true,
        email: true,
        id: true,
        name: true,
        phone: true,
        postcode: true,
        state: true,
        suburb: true,
      },
    });
    if (!business) {
      throw this.domainError(
        'BUSINESS_NOT_FOUND',
        'Business workspace could not be found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return business;
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
      | 'relatedJobId'
      | 'convertedJobId'
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
          convertedJobId: quote.convertedJobId,
          jobId: quote.jobId,
          quoteNumber: quote.quoteNumber,
          relatedJobId: quote.relatedJobId,
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
      relatedJob: { select: { id: true, jobNumber: true, title: true } },
      convertedJob: { select: { id: true, jobNumber: true, title: true } },
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
      acceptedQuoteVersion: quote.acceptedQuoteVersion,
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
      convertedJob: quote.convertedJob,
      convertedJobId: quote.convertedJobId,
      declinedAt: quote.declinedAt?.toISOString() ?? null,
      declineComment: quote.declineComment,
      declineReason: quote.declineReason,
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
      firstViewedAt: quote.firstViewedAt?.toISOString() ?? null,
      job: quote.job,
      jobId: quote.jobId,
      latestViewedAt: quote.latestViewedAt?.toISOString() ?? null,
      lineItems: quote.lineItems.map((item) => this.toLineItem(item)),
      pricingMode: quote.pricingMode,
      quoteNumber: quote.quoteNumber,
      relatedJob: quote.relatedJob,
      relatedJobId: quote.relatedJobId,
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
      viewCount: quote.viewCount,
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

  private convertedJobTitle(quote: QuoteRecord) {
    const fallback = `Quote for ${quote.customer.displayName}`;
    const candidates = [
      quote.title,
      quote.description,
      ...quote.lineItems.map((item) => item.description ?? item.name),
    ];

    return (
      candidates
        .map((candidate) => this.meaningfulJobTitleCandidate(candidate))
        .find(Boolean) ?? fallback
    );
  }

  private meaningfulJobTitleCandidate(candidate?: string | null) {
    const value = candidate?.trim();
    if (!value) return null;
    if (/^quote\s+for\s+/i.test(value)) return null;
    if (/^\$?\d+(\.\d{1,2})?$/.test(value)) return null;
    if (/^(labou?r|materials?|parts?|service|fee|other)$/i.test(value)) {
      return null;
    }
    return value.length > 160 ? `${value.slice(0, 157).trim()}...` : value;
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

  private logCreate(
    event: string,
    currentUser: AuthenticatedUser,
    dto: UpsertQuoteDto,
    metadata: Record<string, unknown> = {},
  ) {
    if (!this.shouldLogCreateDiagnostics()) return;
    this.logger.log({
      event,
      ...this.safeCreateMetadata(currentUser, dto),
      ...metadata,
    });
  }

  private logCreateFailure(
    currentUser: AuthenticatedUser,
    dto: UpsertQuoteDto,
    error: unknown,
  ) {
    if (!this.shouldLogCreateDiagnostics()) return;
    const errorRecord = this.errorRecord(error);
    this.logger.error({
      event: 'QUOTE_CREATE_FAILED',
      ...this.safeCreateMetadata(currentUser, dto),
      ...errorRecord,
    });
  }

  private safeCreateMetadata(
    currentUser: AuthenticatedUser,
    dto: UpsertQuoteDto,
  ) {
    return {
      businessId: currentUser.businessId,
      customerId: dto.customerId,
      customerSiteId: dto.customerSiteId ?? null,
      jobId: dto.jobId ?? null,
      relatedJobId: dto.relatedJobId ?? dto.jobId ?? null,
      lineItems: dto.lineItems.map((item, index) => ({
        index,
        quantity: item.quantity,
        taxable: item.taxable,
        type: item.type,
        unit: item.unit,
        unitPriceCents: item.unitPriceCents,
      })),
      lineItemCount: dto.lineItems.length,
      pricingMode: dto.pricingMode,
      role: currentUser.role,
      sourceAppointmentId: dto.sourceAppointmentId ?? null,
      titleLength: dto.title?.length ?? 0,
      userId: currentUser.id,
    };
  }

  private errorRecord(error: unknown) {
    const record = error as {
      code?: unknown;
      name?: unknown;
      stack?: unknown;
      message?: unknown;
      meta?: unknown;
    };
    return {
      errorCode: typeof record.code === 'string' ? record.code : undefined,
      errorMessage:
        typeof record.message === 'string' ? record.message : undefined,
      errorName: typeof record.name === 'string' ? record.name : undefined,
      meta: record.meta,
      stack: typeof record.stack === 'string' ? record.stack : undefined,
    };
  }

  private mapCreateFailure(error: unknown) {
    if (error instanceof HttpException) return error;
    const record = this.errorRecord(error);
    if (record.errorCode === 'P2002') {
      return this.domainError(
        'QUOTE_NUMBER_CONFLICT',
        'Quote number conflict. Please try saving again.',
        HttpStatus.CONFLICT,
      );
    }
    if (record.errorCode === 'P2003') {
      return this.domainError(
        'QUOTE_RELATION_MISMATCH',
        'Quote customer, site, job or appointment details no longer match.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.domainError(
      'QUOTE_CREATE_FAILED',
      'Quote could not be saved. Please try again.',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  private shouldLogCreateDiagnostics() {
    return !['production', 'test'].includes(process.env.NODE_ENV ?? '');
  }

  private domainError(code: string, message: string, status: HttpStatus) {
    return new HttpException({ code, message }, status);
  }
}
