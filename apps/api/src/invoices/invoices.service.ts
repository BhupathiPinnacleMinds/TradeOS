import { createHash, randomBytes } from 'crypto';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AuthenticatedUser,
  AccountsReceivableResponse,
  Invoice,
  InvoiceDraftResponse,
  InvoiceDetailResponse,
  InvoiceLineItem,
  InvoiceLineItemPayload,
  InvoiceListResponse,
  InvoicePayment,
  InvoiceReceiptDocumentSummary,
  InvoiceStatus,
  PublicInvoiceResponse,
} from '@tradieos/shared';
import {
  ACCOUNTS_RECEIVABLE_VIEW_ROLES,
  getBusinessDateParts,
  INVOICE_CREATE_ROLES,
  INVOICE_PAYMENT_WRITE_ROLES,
  INVOICE_SEND_ROLES,
  INVOICE_VIEW_ROLES,
  INVOICE_VOID_ROLES,
  calculateInvoiceTotals,
  formatAudCents,
  getInvoiceDisplayStatus,
  parseInvoiceQuantityInput,
  roleCanEditInvoice,
  zonedTimeToUtc,
} from '@tradieos/shared';
import type { Prisma } from '../generated/prisma/client';
import { CustomerCommunicationsService } from '../communications/communications.service';
import { STORAGE_PROVIDER } from '../media/storage-provider';
import type { StorageProvider } from '../media/storage-provider';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ConsoleInvoiceEmailProvider,
  type InvoiceEmailProvider,
} from './invoice-email.provider';
import {
  DeterministicInvoicePdfProvider,
  type InvoicePdfProvider,
} from './invoice-pdf.provider';
import type {
  ListInvoicesQueryDto,
  AccountsReceivableQueryDto,
  InvoiceDraftQueryDto,
  RecordInvoicePaymentDto,
  SendInvoiceDto,
  UpsertInvoiceDto,
} from './dto/invoices.dto';

const DEFAULT_PAGE_SIZE = 20;
const OUTSTANDING_STATUSES: InvoiceStatus[] = [
  'SENT',
  'VIEWED',
  'PARTIALLY_PAID',
  'OVERDUE',
];

type InvoiceRecord = Prisma.InvoiceGetPayload<{
  include: ReturnType<InvoicesService['invoiceInclude']>;
}>;

@Injectable()
export class InvoicesService {
  private readonly emailProvider: InvoiceEmailProvider =
    new ConsoleInvoiceEmailProvider();
  private readonly pdfProvider: InvoicePdfProvider =
    new DeterministicInvoicePdfProvider();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly communications: CustomerCommunicationsService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll(
    currentUser: AuthenticatedUser,
    query: ListInvoicesQueryDto,
  ): Promise<InvoiceListResponse> {
    this.assertRole(currentUser, INVOICE_VIEW_ROLES);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(
      100,
      Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const where = this.buildWhere(currentUser, query);
    const [records, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        include: this.invoiceInclude(),
        orderBy: this.orderBy(query.sortBy, query.sortOrder),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      page,
      pageSize,
      records: records.map((invoice) => this.toInvoice(invoice)),
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async accountsReceivable(
    currentUser: AuthenticatedUser,
    query: AccountsReceivableQueryDto,
  ): Promise<AccountsReceivableResponse> {
    this.assertRole(currentUser, ACCOUNTS_RECEIVABLE_VIEW_ROLES);
    const timezone = await this.getBusinessTimezone(currentUser.businessId);
    const today = this.businessDayStart(new Date(), timezone);
    const dueSoonEnd = this.addUtcDays(today, 7);
    const monthStart = this.businessMonthStart(new Date(), timezone);
    const nextMonthStart = this.businessNextMonthStart(new Date(), timezone);
    const baseWhere = this.buildReceivablesBaseWhere(currentUser, query);
    const outstandingWhere: Prisma.InvoiceWhereInput = {
      ...baseWhere,
      balanceDueCents: { gt: 0 },
      status: { in: OUTSTANDING_STATUSES },
    };
    const overdueWhere: Prisma.InvoiceWhereInput = {
      ...outstandingWhere,
      dueDate: { lt: today },
    };
    const dueSoonWhere: Prisma.InvoiceWhereInput = {
      ...outstandingWhere,
      dueDate: { gte: today, lt: dueSoonEnd },
    };
    const paidWhere: Prisma.InvoiceWhereInput = {
      ...baseWhere,
      status: 'PAID',
    };

    const sectionFilter = query.status;
    const [
      outstandingRows,
      overdueRows,
      dueSoonRows,
      paidThisMonth,
      outstandingCount,
      overdueInvoiceCount,
      dueSoonInvoiceCount,
      paidInvoiceCount,
      outstanding,
      overdue,
      dueSoon,
      paid,
    ] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where: outstandingWhere,
        select: { balanceDueCents: true },
      }),
      this.prisma.invoice.findMany({
        where: overdueWhere,
        select: { balanceDueCents: true },
      }),
      this.prisma.invoice.findMany({
        where: dueSoonWhere,
        select: { balanceDueCents: true },
      }),
      this.prisma.invoicePayment.aggregate({
        _sum: { amountCents: true },
        where: {
          businessId: currentUser.businessId,
          receivedAt: { gte: monthStart, lt: nextMonthStart },
          reversedAt: null,
        },
      }),
      this.prisma.invoice.count({ where: outstandingWhere }),
      this.prisma.invoice.count({ where: overdueWhere }),
      this.prisma.invoice.count({ where: dueSoonWhere }),
      this.prisma.invoice.count({ where: paidWhere }),
      this.prisma.invoice.findMany({
        where:
          sectionFilter && sectionFilter !== 'OUTSTANDING'
            ? { ...outstandingWhere, id: { in: [] } }
            : outstandingWhere,
        include: this.invoiceInclude(),
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        take: 10,
      }),
      this.prisma.invoice.findMany({
        where:
          sectionFilter && sectionFilter !== 'OVERDUE'
            ? { ...overdueWhere, id: { in: [] } }
            : overdueWhere,
        include: this.invoiceInclude(),
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        take: 10,
      }),
      this.prisma.invoice.findMany({
        where:
          sectionFilter && sectionFilter !== 'DUE_SOON'
            ? { ...dueSoonWhere, id: { in: [] } }
            : dueSoonWhere,
        include: this.invoiceInclude(),
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        take: 10,
      }),
      this.prisma.invoice.findMany({
        where:
          sectionFilter && sectionFilter !== 'PAID'
            ? { ...paidWhere, id: { in: [] } }
            : paidWhere,
        include: this.invoiceInclude(),
        orderBy: [{ paidAt: 'desc' }, { updatedAt: 'desc' }],
        take: 10,
      }),
    ]);

    return {
      sections: {
        dueSoon: dueSoon.map((invoice) => this.toInvoice(invoice)),
        outstanding: outstanding.map((invoice) => this.toInvoice(invoice)),
        overdue: overdue.map((invoice) => this.toInvoice(invoice)),
        paid: paid.map((invoice) => this.toInvoice(invoice)),
      },
      summary: {
        dueSoonCents: this.sumBalances(dueSoonRows),
        dueSoonInvoiceCount,
        outstandingInvoiceCount: outstandingCount,
        overdueInvoiceCount,
        paidInvoiceCount,
        paidThisMonthCents: paidThisMonth._sum.amountCents ?? 0,
        totalOutstandingCents: this.sumBalances(outstandingRows),
        totalOverdueCents: this.sumBalances(overdueRows),
      },
    };
  }

  async draft(
    currentUser: AuthenticatedUser,
    query: InvoiceDraftQueryDto,
  ): Promise<InvoiceDraftResponse> {
    this.assertRole(currentUser, INVOICE_CREATE_ROLES);
    const today = new Date();
    const dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() + 7);

    const job = query.jobId
      ? await this.prisma.job.findFirst({
          where: {
            businessId: currentUser.businessId,
            id: query.jobId,
            isArchived: false,
            ...(query.customerId ? { customerId: query.customerId } : {}),
          },
          select: {
            customerId: true,
            id: true,
            jobNumber: true,
            sourceQuoteId: true,
            title: true,
          },
        })
      : null;
    if (query.jobId && !job) {
      throw this.domainError(
        'INVOICE_ACCESS_DENIED',
        'Job could not be found for this business and customer.',
        HttpStatus.NOT_FOUND,
      );
    }

    const customerId = query.customerId ?? job?.customerId;
    if (!customerId) {
      return {
        draft: this.defaultInvoiceDraft({
          customerId: '',
          customerSiteId: query.customerSiteId ?? null,
          dueDate,
          issueDate: today,
        }),
        job: null,
        source: 'EMPTY_DEFAULT',
        sourceQuote: null,
      };
    }

    const customer = await this.prisma.customer.findFirst({
      where: {
        businessId: currentUser.businessId,
        id: customerId,
        isArchived: false,
      },
      select: { displayName: true, id: true },
    });
    if (!customer) {
      throw this.domainError(
        'INVOICE_ACCESS_DENIED',
        'Customer could not be found for this business.',
        HttpStatus.NOT_FOUND,
      );
    }

    const explicitSourceQuoteId = query.sourceQuoteId ?? null;
    if (
      explicitSourceQuoteId &&
      job?.sourceQuoteId &&
      explicitSourceQuoteId !== job.sourceQuoteId
    ) {
      throw this.domainError(
        'INVOICE_SOURCE_MISMATCH',
        'Source quote does not match this job.',
        HttpStatus.CONFLICT,
      );
    }
    const sourceQuoteId = explicitSourceQuoteId ?? job?.sourceQuoteId ?? null;
    const sourceQuote = sourceQuoteId
      ? await this.prisma.quote.findFirst({
          where: {
            businessId: currentUser.businessId,
            customerId,
            id: sourceQuoteId,
            status: { in: ['ACCEPTED', 'CONVERTED'] },
          },
          include: {
            lineItems: { orderBy: { position: 'asc' } },
          },
        })
      : null;

    if (sourceQuoteId && !sourceQuote) {
      throw this.domainError(
        'INVOICE_SOURCE_INVALID',
        'Accepted source quote could not be found for this customer.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (sourceQuote && job && !this.sourceQuoteBelongsToJob(sourceQuote, job)) {
      throw this.domainError(
        'INVOICE_SOURCE_MISMATCH',
        'Source quote does not belong to this job.',
        HttpStatus.CONFLICT,
      );
    }

    if (sourceQuote) {
      return {
        draft: {
          creditAppliedCents: 0,
          customerId,
          customerSiteId: query.customerSiteId ?? sourceQuote.customerSiteId,
          customerNotes: sourceQuote.customerNotes ?? undefined,
          description: sourceQuote.description ?? undefined,
          discountType: sourceQuote.discountType,
          discountValue: sourceQuote.discountValue,
          dueDate: dueDate.toISOString(),
          gstRateBasisPoints: sourceQuote.gstRateBasisPoints,
          internalNotes: job
            ? `Created from ${job.jobNumber} and source quote ${sourceQuote.quoteNumber}.`
            : `Created from source quote ${sourceQuote.quoteNumber}.`,
          issueDate: today.toISOString(),
          jobId: job?.id ?? null,
          lineItems: sourceQuote.lineItems
            .filter((item) => item.type !== 'DISCOUNT')
            .map((item) => ({
              description: item.description ?? undefined,
              name: item.name,
              quantity: item.quantity.toString(),
              taxable: item.taxable,
              type: item.type as InvoiceLineItemPayload['type'],
              unit: item.unit,
              unitPriceCents: item.unitPriceCents,
            })),
          paymentTerms:
            'Payment due within 7 days. Bank transfer details to be confirmed.',
          pricingMode: sourceQuote.pricingMode,
          sourceQuoteId: sourceQuote.id,
          title: job
            ? `Invoice for ${job.jobNumber}`
            : `Invoice for ${sourceQuote.quoteNumber}`,
        },
        job: job
          ? { id: job.id, jobNumber: job.jobNumber, title: job.title }
          : null,
        source: 'SOURCE_QUOTE',
        sourceQuote: {
          id: sourceQuote.id,
          quoteNumber: sourceQuote.quoteNumber,
          status: sourceQuote.status,
          title: sourceQuote.title,
          totalCents: sourceQuote.totalCents,
        },
      };
    }

    return {
      draft: this.defaultInvoiceDraft({
        customerId,
        customerSiteId: query.customerSiteId ?? null,
        dueDate,
        issueDate: today,
        jobId: job?.id ?? null,
        title: job
          ? `Invoice for ${job.jobNumber}`
          : `Invoice for ${customer.displayName}`,
      }),
      job: job
        ? { id: job.id, jobNumber: job.jobNumber, title: job.title }
        : null,
      source: job ? 'JOB_DEFAULT' : 'EMPTY_DEFAULT',
      sourceQuote: null,
    };
  }

  async findOne(
    currentUser: AuthenticatedUser,
    id: string,
  ): Promise<InvoiceDetailResponse> {
    this.assertRole(currentUser, INVOICE_VIEW_ROLES);
    const invoice = await this.getInvoiceForUser(currentUser, id);
    const [activity, documents, payments] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where: {
          businessId: currentUser.businessId,
          entityId: invoice.id,
          entityType: 'Invoice',
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.invoicePdfDocument.findMany({
        where: { businessId: currentUser.businessId, invoiceId: invoice.id },
        orderBy: { generatedAt: 'desc' },
      }),
      this.prisma.invoicePayment.findMany({
        where: { businessId: currentUser.businessId, invoiceId: invoice.id },
        include: {
          creator: { select: { email: true, firstName: true, lastName: true } },
          receiptDocuments: {
            orderBy: { generatedAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { receivedAt: 'desc' },
      }),
    ]);

    return {
      activity: activity.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
        metadata: (entry.metadata as Record<string, unknown> | null) ?? null,
      })),
      documents: documents.map((document) => this.toPdfDocument(document)),
      invoice: this.toInvoice(invoice),
      payments: payments.map((payment) => this.toPayment(payment)),
    };
  }

  async create(currentUser: AuthenticatedUser, dto: UpsertInvoiceDto) {
    this.assertRole(currentUser, INVOICE_CREATE_ROLES);
    this.assertDates(dto);
    this.assertLineItems(dto.lineItems);
    const context = await this.assertInvoiceContext(currentUser, dto);
    const created = await this.prisma.$transaction(async (tx) => {
      const invoiceNumber = await this.nextInvoiceNumber(
        tx,
        currentUser.businessId,
        new Date(dto.issueDate),
      );
      const calculated = calculateInvoiceTotals({
        creditAppliedCents: dto.creditAppliedCents,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        gstRateBasisPoints: dto.gstRateBasisPoints,
        lineItems: dto.lineItems,
        pricingMode: dto.pricingMode,
      });
      const invoice = await tx.invoice.create({
        data: {
          ...this.invoiceData(currentUser, dto, calculated),
          customerSiteId: context.customerSiteId,
          invoiceNumber,
          sourceQuoteId: context.sourceQuoteId,
        },
        include: this.invoiceInclude(),
      });
      await this.createLineItems(
        tx,
        currentUser.businessId,
        invoice.id,
        calculated,
      );
      if (invoice.jobId) {
        await tx.job.update({
          where: {
            id_businessId: {
              businessId: currentUser.businessId,
              id: invoice.jobId,
            },
          },
          data: { invoiceCreated: true },
        });
      }
      const withItems = await tx.invoice.findUniqueOrThrow({
        where: {
          id_businessId: { businessId: currentUser.businessId, id: invoice.id },
        },
        include: this.invoiceInclude(),
      });
      await this.writeAudit(tx, currentUser, 'INVOICE_CREATED', withItems, {
        customerId: withItems.customerId,
        jobId: withItems.jobId,
        sourceQuoteId: withItems.sourceQuoteId,
        totalCents: withItems.totalCents,
      });
      return withItems;
    });
    return this.findOne(currentUser, created.id);
  }

  async update(
    currentUser: AuthenticatedUser,
    id: string,
    dto: UpsertInvoiceDto,
  ) {
    const invoice = await this.getInvoiceForUser(currentUser, id);
    if (!roleCanEditInvoice(currentUser.role, invoice.status)) {
      throw this.domainError(
        'INVOICE_INVALID_STATUS',
        'Only draft invoices can be edited.',
        HttpStatus.CONFLICT,
      );
    }
    this.assertDates(dto);
    this.assertLineItems(dto.lineItems);
    const context = await this.assertInvoiceContext(currentUser, dto);
    await this.prisma.$transaction(async (tx) => {
      const calculated = calculateInvoiceTotals({
        creditAppliedCents: dto.creditAppliedCents,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        gstRateBasisPoints: dto.gstRateBasisPoints,
        lineItems: dto.lineItems,
        pricingMode: dto.pricingMode,
      });
      const updated = await tx.invoice.update({
        where: { id_businessId: { businessId: currentUser.businessId, id } },
        data: {
          ...this.invoiceData(currentUser, dto, calculated),
          createdBy: undefined,
          customerSiteId: context.customerSiteId,
          sourceQuoteId: context.sourceQuoteId,
          version: { increment: 1 },
        },
        include: this.invoiceInclude(),
      });
      await tx.invoiceLineItem.deleteMany({
        where: { businessId: currentUser.businessId, invoiceId: id },
      });
      await this.createLineItems(tx, currentUser.businessId, id, calculated);
      await this.writeAudit(tx, currentUser, 'INVOICE_UPDATED', updated, {
        totalCents: updated.totalCents,
      });
    });
    return this.findOne(currentUser, id);
  }

  async send(currentUser: AuthenticatedUser, id: string, dto?: SendInvoiceDto) {
    const invoice = await this.getInvoiceForUser(currentUser, id);
    if (
      !INVOICE_SEND_ROLES.includes(currentUser.role) ||
      !['DRAFT', 'SENT', 'VIEWED', 'PARTIALLY_PAID'].includes(invoice.status)
    ) {
      throw this.domainError(
        'INVOICE_INVALID_STATUS',
        'This invoice is not eligible to send.',
        HttpStatus.CONFLICT,
      );
    }
    if (invoice.lineItems.length === 0) {
      throw this.domainError(
        'INVOICE_LINE_ITEM_INVALID',
        'Add at least one line item before sending.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const to = dto?.to?.trim() || invoice.customer.email?.trim();
    if (!to) {
      throw this.domainError(
        'INVOICE_EMAIL_REQUIRED',
        'Add a customer email before sending this invoice.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const business = await this.getBusiness(currentUser.businessId);
    const subject =
      dto?.subject?.trim() ||
      `Invoice ${invoice.invoiceNumber} from ${business.name}`;
    const message =
      dto?.message?.trim() ||
      `Hi ${invoice.customer.displayName}, please review invoice ${invoice.invoiceNumber}.`;
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const pdf = await this.generateAndStorePdf(
        tx,
        currentUser,
        invoice,
        business,
      );
      const token = await this.createPublicToken(
        tx,
        currentUser.businessId,
        invoice.id,
        invoice.version,
      );
      const next = await tx.invoice.update({
        where: { id_businessId: { businessId: currentUser.businessId, id } },
        data: {
          sentAt: invoice.sentAt ?? now,
          status: invoice.status === 'DRAFT' ? 'SENT' : invoice.status,
          updatedBy: currentUser.id,
        },
        include: this.invoiceInclude(),
      });
      await this.writeAudit(
        tx,
        currentUser,
        invoice.status === 'DRAFT' ? 'INVOICE_SENT' : 'INVOICE_RESENT',
        next,
        {
          invoicePdfDocumentId: pdf.id,
          publicTokenId: token.id,
          to,
        },
      );
      return { invoice: next, pdf, token: token.rawToken };
    });

    const publicUrl = this.publicInvoiceUrl(result.token);
    const delivery = await this.emailProvider.sendInvoice({
      businessName: business.name,
      invoiceNumber: invoice.invoiceNumber,
      invoiceUrl: publicUrl,
      message,
      pdfFileName: result.pdf.fileName,
      subject,
      to,
    });
    if (delivery.status !== 'SENT') {
      throw this.domainError(
        'INVOICE_SEND_FAILED',
        'Invoice email could not be sent. Please try again.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    await this.communications.invoiceSent({
      businessId: currentUser.businessId,
      createdBy: currentUser.id,
      invoiceId: result.invoice.id,
      publicUrl,
    });

    return {
      ...(await this.findOne(currentUser, result.invoice.id)),
      pdfDocument: this.toPdfDocument(result.pdf),
      publicInvoiceUrl: publicUrl,
    };
  }

  async pdf(currentUser: AuthenticatedUser, id: string) {
    const invoice = await this.getInvoiceForUser(currentUser, id);
    const business = await this.getBusiness(currentUser.businessId);
    const document = await this.prisma.$transaction((tx) =>
      this.generateAndStorePdf(tx, currentUser, invoice, business),
    );
    await this.prisma.auditLog.create({
      data: {
        action: 'INVOICE_PDF_GENERATED',
        actorUserId: currentUser.id,
        businessId: currentUser.businessId,
        entityId: invoice.id,
        entityType: 'Invoice',
        metadata: { invoiceNumber: invoice.invoiceNumber },
      },
    });
    const buffer = await this.storage.readObject({
      objectKey: document.objectKey,
    });
    return {
      buffer,
      fileName: document.fileName,
      mimeType: 'application/pdf' as const,
    };
  }

  async recordPayment(
    currentUser: AuthenticatedUser,
    id: string,
    dto: RecordInvoicePaymentDto,
  ) {
    const invoice = await this.getInvoiceForUser(currentUser, id);
    if (!INVOICE_PAYMENT_WRITE_ROLES.includes(currentUser.role)) {
      throw this.domainError(
        'INVOICE_ACCESS_DENIED',
        'You do not have permission to record invoice payments.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (invoice.status === 'VOID') {
      throw this.domainError(
        'INVOICE_VOID',
        'Void invoices cannot receive payments.',
        HttpStatus.CONFLICT,
      );
    }
    if (invoice.status === 'DRAFT') {
      throw this.domainError(
        'INVOICE_INVALID_STATUS',
        'Send the invoice before recording payment.',
        HttpStatus.CONFLICT,
      );
    }
    if (invoice.balanceDueCents <= 0 || invoice.status === 'PAID') {
      throw this.domainError(
        'INVOICE_ALREADY_PAID',
        'This invoice is already paid.',
        HttpStatus.CONFLICT,
      );
    }
    if (dto.amountCents > invoice.balanceDueCents) {
      throw this.domainError(
        'INVOICE_PAYMENT_EXCEEDS_BALANCE',
        'Payment cannot exceed the current balance due.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const paymentId = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.invoicePayment.create({
        data: {
          amountCents: dto.amountCents,
          businessId: currentUser.businessId,
          createdBy: currentUser.id,
          invoiceId: invoice.id,
          method: dto.method,
          notes: dto.notes?.trim() || null,
          receivedAt: new Date(dto.receivedAt),
          reference: dto.reference?.trim() || null,
        },
      });
      const amountPaidCents = invoice.amountPaidCents + dto.amountCents;
      const balanceDueCents = Math.max(
        0,
        invoice.totalCents - invoice.creditAppliedCents - amountPaidCents,
      );
      const status: InvoiceStatus =
        balanceDueCents === 0 ? 'PAID' : 'PARTIALLY_PAID';
      const updated = await tx.invoice.update({
        where: { id_businessId: { businessId: currentUser.businessId, id } },
        data: {
          amountPaidCents,
          balanceDueCents,
          paidAt: status === 'PAID' ? new Date() : null,
          status,
          updatedBy: currentUser.id,
        },
        include: this.invoiceInclude(),
      });
      await this.writeAudit(
        tx,
        currentUser,
        'INVOICE_PAYMENT_RECORDED',
        updated,
        {
          amountCents: dto.amountCents,
          balanceDueCents,
          method: dto.method,
        },
      );
      if (status === 'PAID') {
        await this.writeAudit(tx, currentUser, 'INVOICE_PAID', updated, {
          amountPaidCents,
        });
      }
      return payment.id;
    });
    await this.communications.paymentRecorded({
      businessId: currentUser.businessId,
      createdBy: currentUser.id,
      invoiceId: id,
      paymentId,
    });
    await this.notifyPaymentRecorded(currentUser, invoice, dto.amountCents);
    return this.findOne(currentUser, id);
  }

  async paymentReceipt(
    currentUser: AuthenticatedUser,
    invoiceId: string,
    paymentId: string,
  ) {
    this.assertRole(currentUser, ACCOUNTS_RECEIVABLE_VIEW_ROLES);
    const invoice = await this.getInvoiceForUser(currentUser, invoiceId);
    const payment = await this.prisma.invoicePayment.findFirst({
      where: {
        businessId: currentUser.businessId,
        id: paymentId,
        invoiceId: invoice.id,
      },
      include: {
        creator: { select: { email: true, firstName: true, lastName: true } },
        receiptDocuments: {
          orderBy: { generatedAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!payment) {
      throw this.domainError(
        'INVOICE_PAYMENT_NOT_FOUND',
        'Payment could not be found for this invoice.',
        HttpStatus.NOT_FOUND,
      );
    }
    const business = await this.getBusiness(currentUser.businessId);
    const document = await this.prisma.$transaction((tx) =>
      this.generateAndStoreReceipt(tx, currentUser, invoice, payment, business),
    );
    await this.prisma.auditLog.create({
      data: {
        action: 'INVOICE_RECEIPT_GENERATED',
        actorUserId: currentUser.id,
        businessId: currentUser.businessId,
        entityId: invoice.id,
        entityType: 'Invoice',
        metadata: {
          invoiceNumber: invoice.invoiceNumber,
          paymentId: payment.id,
          receiptNumber: document.receiptNumber,
        },
      },
    });
    const buffer = await this.storage.readObject({
      objectKey: document.objectKey,
    });
    return {
      buffer,
      fileName: document.fileName,
      mimeType: 'application/pdf' as const,
    };
  }

  async void(currentUser: AuthenticatedUser, id: string) {
    const invoice = await this.getInvoiceForUser(currentUser, id);
    if (!INVOICE_VOID_ROLES.includes(currentUser.role)) {
      throw this.domainError(
        'INVOICE_ACCESS_DENIED',
        'You do not have permission to void invoices.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (invoice.status === 'PAID' || invoice.status === 'VOID') {
      throw this.domainError(
        'INVOICE_INVALID_STATUS',
        'Paid or void invoices cannot be voided.',
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.invoice.update({
        where: { id_businessId: { businessId: currentUser.businessId, id } },
        data: {
          balanceDueCents: 0,
          status: 'VOID',
          updatedBy: currentUser.id,
          voidedAt: new Date(),
        },
        include: this.invoiceInclude(),
      });
      await tx.invoicePublicAccessToken.updateMany({
        where: {
          businessId: currentUser.businessId,
          invoiceId: invoice.id,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      await this.writeAudit(tx, currentUser, 'INVOICE_VOIDED', updated, {});
    });
    await this.communications.invoiceClosed(currentUser.businessId, id);
    return this.findOne(currentUser, id);
  }

  async publicFindOne(rawToken: string): Promise<PublicInvoiceResponse> {
    const context = await this.resolvePublicToken(rawToken);
    return this.toPublicInvoice(context.invoice);
  }

  async publicView(rawToken: string): Promise<PublicInvoiceResponse> {
    const context = await this.resolvePublicToken(rawToken);
    await this.prisma.$transaction(async (tx) => {
      await tx.invoicePublicAccessToken.update({
        where: { id: context.token.id },
        data: {
          lastViewedAt: new Date(),
          viewCount: { increment: 1 },
        },
      });
      if (context.invoice.status === 'SENT') {
        const viewed = await tx.invoice.update({
          where: {
            id_businessId: {
              businessId: context.invoice.businessId,
              id: context.invoice.id,
            },
          },
          data: {
            status: 'VIEWED',
            viewedAt: context.invoice.viewedAt ?? new Date(),
          },
          include: this.invoiceInclude(),
        });
        await this.writeAudit(
          tx,
          { businessId: viewed.businessId, id: null },
          'INVOICE_VIEWED',
          viewed,
          { publicTokenId: context.token.id },
        );
      }
    });
    const refreshed = await this.prisma.invoice.findUniqueOrThrow({
      where: {
        id_businessId: {
          businessId: context.invoice.businessId,
          id: context.invoice.id,
        },
      },
      include: this.invoiceInclude(),
    });
    return this.toPublicInvoice(refreshed);
  }

  private buildWhere(
    currentUser: AuthenticatedUser,
    query: ListInvoicesQueryDto,
  ): Prisma.InvoiceWhereInput {
    const where: Prisma.InvoiceWhereInput = {
      businessId: currentUser.businessId,
    };
    if (query.status === 'OUTSTANDING') {
      where.status = { in: OUTSTANDING_STATUSES };
      where.balanceDueCents = { gt: 0 };
    } else if (query.status) {
      where.status = query.status;
    }
    if (query.customerId) where.customerId = query.customerId;
    if (query.jobId) where.jobId = query.jobId;
    if (query.dateFrom || query.dateTo) {
      where.issueDate = {
        gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
        lte: query.dateTo ? new Date(query.dateTo) : undefined,
      };
    }
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        {
          customer: {
            displayName: { contains: search, mode: 'insensitive' },
          },
        },
        { job: { jobNumber: { contains: search, mode: 'insensitive' } } },
        { job: { title: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (currentUser.role === 'TECHNICIAN') {
      where.job = { assignedToUserId: currentUser.id };
    }
    return where;
  }

  private buildReceivablesBaseWhere(
    currentUser: AuthenticatedUser,
    query: AccountsReceivableQueryDto,
  ): Prisma.InvoiceWhereInput {
    const where: Prisma.InvoiceWhereInput = {
      businessId: currentUser.businessId,
    };
    if (query.customerId) where.customerId = query.customerId;
    if (query.dateFrom || query.dateTo) {
      where.dueDate = {
        gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
        lte: query.dateTo ? new Date(query.dateTo) : undefined,
      };
    }
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        {
          customer: {
            displayName: { contains: search, mode: 'insensitive' },
          },
        },
        {
          customer: {
            companyName: { contains: search, mode: 'insensitive' },
          },
        },
      ];
    }
    return where;
  }

  private orderBy(
    sortBy: ListInvoicesQueryDto['sortBy'] = 'createdAt',
    sortOrder: ListInvoicesQueryDto['sortOrder'] = 'desc',
  ): Prisma.InvoiceOrderByWithRelationInput {
    return { [sortBy]: sortOrder };
  }

  private async getInvoiceForUser(
    currentUser: AuthenticatedUser,
    id: string,
  ): Promise<InvoiceRecord> {
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        businessId: currentUser.businessId,
        id,
        ...(currentUser.role === 'TECHNICIAN'
          ? { job: { assignedToUserId: currentUser.id } }
          : {}),
      },
      include: this.invoiceInclude(),
    });
    if (!invoice) {
      throw this.domainError(
        'INVOICE_NOT_FOUND',
        'Invoice could not be found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return invoice;
  }

  private async assertInvoiceContext(
    currentUser: AuthenticatedUser,
    dto: UpsertInvoiceDto,
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: {
        businessId: currentUser.businessId,
        id: dto.customerId,
        isArchived: false,
      },
      select: { id: true },
    });
    if (!customer) {
      throw this.domainError(
        'INVOICE_ACCESS_DENIED',
        'Customer could not be found for this business.',
        HttpStatus.NOT_FOUND,
      );
    }
    const customerSiteId = dto.customerSiteId ?? null;
    if (customerSiteId) {
      const site = await this.prisma.customerSite.findFirst({
        where: {
          businessId: currentUser.businessId,
          customerId: dto.customerId,
          id: customerSiteId,
          isArchived: false,
        },
        select: { id: true },
      });
      if (!site) {
        throw this.domainError(
          'INVOICE_ACCESS_DENIED',
          'Service site could not be found for this customer.',
          HttpStatus.NOT_FOUND,
        );
      }
    }
    let sourceQuoteId = dto.sourceQuoteId ?? null;
    let jobContext: { id: string; sourceQuoteId: string | null } | null = null;
    if (dto.jobId) {
      const job = await this.prisma.job.findFirst({
        where: {
          businessId: currentUser.businessId,
          customerId: dto.customerId,
          id: dto.jobId,
          isArchived: false,
        },
        select: { id: true, sourceQuoteId: true },
      });
      if (!job) {
        throw this.domainError(
          'INVOICE_ACCESS_DENIED',
          'Job could not be found for this customer.',
          HttpStatus.NOT_FOUND,
        );
      }
      jobContext = job;
      sourceQuoteId = sourceQuoteId ?? job.sourceQuoteId;
    }
    if (sourceQuoteId) {
      const quote = await this.prisma.quote.findFirst({
        where: {
          businessId: currentUser.businessId,
          customerId: dto.customerId,
          id: sourceQuoteId,
          status: { in: ['ACCEPTED', 'CONVERTED'] },
        },
        select: {
          convertedJobId: true,
          id: true,
          jobId: true,
          relatedJobId: true,
        },
      });
      if (!quote) {
        throw this.domainError(
          'INVOICE_ACCESS_DENIED',
          'Accepted source quote could not be found for this customer.',
          HttpStatus.NOT_FOUND,
        );
      }
      if (jobContext && !this.sourceQuoteBelongsToJob(quote, jobContext)) {
        throw this.domainError(
          'INVOICE_SOURCE_MISMATCH',
          'Source quote does not belong to this job.',
          HttpStatus.CONFLICT,
        );
      }
    }
    return { customerSiteId, sourceQuoteId };
  }

  private sourceQuoteBelongsToJob(
    quote: {
      convertedJobId: string | null;
      id: string;
      jobId: string | null;
      relatedJobId: string | null;
    },
    job: { id: string; sourceQuoteId: string | null },
  ) {
    return (
      quote.convertedJobId === job.id ||
      quote.relatedJobId === job.id ||
      quote.jobId === job.id ||
      job.sourceQuoteId === quote.id
    );
  }

  private defaultInvoiceDraft(input: {
    customerId: string;
    customerSiteId?: string | null;
    dueDate: Date;
    issueDate: Date;
    jobId?: string | null;
    title?: string;
  }) {
    return {
      creditAppliedCents: 0,
      customerId: input.customerId,
      customerSiteId: input.customerSiteId ?? null,
      discountType: 'NONE' as const,
      discountValue: 0,
      dueDate: input.dueDate.toISOString(),
      issueDate: input.issueDate.toISOString(),
      jobId: input.jobId ?? null,
      lineItems: [
        {
          name: 'Labour',
          quantity: '1',
          taxable: true,
          type: 'LABOUR' as const,
          unit: 'hour',
          unitPriceCents: 12000,
        },
      ],
      paymentTerms:
        'Payment due within 7 days. Bank transfer details to be confirmed.',
      pricingMode: 'GST_EXCLUSIVE' as const,
      sourceQuoteId: null,
      title: input.title ?? 'New invoice',
    };
  }

  private assertDates(dto: UpsertInvoiceDto) {
    const issue = new Date(dto.issueDate);
    const due = new Date(dto.dueDate);
    if (!Number.isFinite(issue.getTime()) || !Number.isFinite(due.getTime())) {
      throw this.domainError(
        'INVOICE_DUE_DATE_INVALID',
        'Invoice issue and due dates must be valid dates.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (due < issue) {
      throw this.domainError(
        'INVOICE_DUE_DATE_INVALID',
        'Due date cannot be before the issue date.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private assertLineItems(items: InvoiceLineItemPayload[]) {
    if (!items?.length) {
      throw this.domainError(
        'INVOICE_LINE_ITEM_INVALID',
        'Add at least one invoice line item.',
        HttpStatus.BAD_REQUEST,
      );
    }
    items.forEach((item) => {
      const quantity = parseInvoiceQuantityInput(String(item.quantity));
      if (quantity.error || !quantity.isComplete) {
        throw this.domainError(
          'INVOICE_LINE_ITEM_INVALID',
          quantity.error ?? 'Complete invoice quantities before saving.',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!item.name?.trim()) {
        throw this.domainError(
          'INVOICE_LINE_ITEM_INVALID',
          'Each invoice line item needs a name.',
          HttpStatus.BAD_REQUEST,
        );
      }
    });
  }

  private invoiceData(
    currentUser: AuthenticatedUser,
    dto: UpsertInvoiceDto,
    calculated: ReturnType<typeof calculateInvoiceTotals>,
  ) {
    return {
      amountPaidCents: calculated.amountPaidCents,
      balanceDueCents: calculated.balanceDueCents,
      businessId: currentUser.businessId,
      creditAppliedCents: calculated.creditAppliedCents,
      currency: 'AUD',
      customerId: dto.customerId,
      customerNotes: dto.customerNotes?.trim() || null,
      description: dto.description?.trim() || null,
      discountCents: calculated.discountCents,
      discountType: dto.discountType ?? 'NONE',
      discountValue: dto.discountValue ?? 0,
      dueDate: new Date(dto.dueDate),
      gstCents: calculated.gstCents,
      gstRateBasisPoints: dto.gstRateBasisPoints ?? 1000,
      internalNotes: dto.internalNotes?.trim() || null,
      issueDate: new Date(dto.issueDate),
      jobId: dto.jobId ?? null,
      paymentTerms: dto.paymentTerms?.trim() || null,
      pricingMode: dto.pricingMode,
      subtotalCents: calculated.subtotalCents,
      title: dto.title.trim(),
      totalCents: calculated.totalCents,
      updatedBy: currentUser.id,
      createdBy: currentUser.id,
    };
  }

  private async createLineItems(
    tx: Prisma.TransactionClient,
    businessId: string,
    invoiceId: string,
    calculated: ReturnType<typeof calculateInvoiceTotals>,
  ) {
    await tx.invoiceLineItem.createMany({
      data: calculated.lineItems.map((item, position) => ({
        businessId,
        description: item.description?.trim() || null,
        invoiceId,
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
      })),
    });
  }

  private async nextInvoiceNumber(
    tx: Prisma.TransactionClient,
    businessId: string,
    issueDate: Date,
  ) {
    await tx.invoiceSequence.upsert({
      where: { businessId },
      create: { businessId, nextNumber: 1 },
      update: {},
    });
    const sequence = await tx.invoiceSequence.update({
      where: { businessId },
      data: { nextNumber: { increment: 1 } },
    });
    return `INV-${issueDate.getUTCFullYear()}-${String(
      sequence.nextNumber,
    ).padStart(6, '0')}`;
  }

  private async generateAndStorePdf(
    tx: Prisma.TransactionClient,
    currentUser: AuthenticatedUser,
    invoice: InvoiceRecord,
    business: Awaited<ReturnType<InvoicesService['getBusiness']>>,
  ) {
    const existing = await tx.invoicePdfDocument.findFirst({
      where: {
        businessId: currentUser.businessId,
        invoiceId: invoice.id,
        version: invoice.version,
      },
    });
    if (existing && invoice.status !== 'DRAFT') return existing;
    const generated = this.pdfProvider.generateInvoicePdf({
      business,
      invoice: this.toInvoice(invoice),
    });
    const objectKey = this.storage.createObjectKey({
      businessId: currentUser.businessId,
      entityId: invoice.id,
      entityType: 'invoices',
      mediaType: 'PDF',
      originalFileName: generated.fileName,
    });
    const metadata = await this.storage.uploadFile({
      content: generated.buffer,
      mimeType: generated.mimeType,
      objectKey,
    });
    if (existing) {
      return tx.invoicePdfDocument.update({
        where: { id: existing.id },
        data: {
          checksum: metadata.checksum ?? generated.checksum,
          fileName: generated.fileName,
          fileSizeBytes: metadata.contentLength || generated.buffer.length,
          generatedAt: new Date(),
          mimeType: generated.mimeType,
          objectKey,
        },
      });
    }
    return tx.invoicePdfDocument.create({
      data: {
        businessId: currentUser.businessId,
        checksum: metadata.checksum ?? generated.checksum,
        createdBy: currentUser.id,
        fileName: generated.fileName,
        fileSizeBytes: metadata.contentLength || generated.buffer.length,
        invoiceId: invoice.id,
        mimeType: generated.mimeType,
        objectKey,
        version: invoice.version,
      },
    });
  }

  private async generateAndStoreReceipt(
    tx: Prisma.TransactionClient,
    currentUser: AuthenticatedUser,
    invoice: InvoiceRecord,
    payment: {
      amountCents: number;
      businessId: string;
      createdAt: Date;
      createdBy: string | null;
      creator?: {
        email: string;
        firstName: string;
        lastName: string;
      } | null;
      id: string;
      invoiceId: string;
      method: string;
      notes: string | null;
      receiptDocuments?: Array<{
        checksum: string;
        fileName: string;
        fileSizeBytes: number;
        generatedAt: Date;
        id: string;
        invoiceId: string;
        mimeType: string;
        objectKey: string;
        paymentId: string;
        receiptNumber: string;
      }>;
      receivedAt: Date;
      reference: string | null;
      reversalReason: string | null;
      reversedAt: Date | null;
    },
    business: Awaited<ReturnType<InvoicesService['getBusiness']>>,
  ) {
    const existing = payment.receiptDocuments?.[0];
    if (existing) return existing;
    const receiptNumber = await this.nextReceiptNumber(
      tx,
      currentUser.businessId,
      payment.receivedAt,
    );
    const generated = this.pdfProvider.generateReceiptPdf({
      business,
      invoice: this.toInvoice(invoice),
      payment: this.toPayment(payment),
      receiptNumber,
    });
    const objectKey = this.storage.createObjectKey({
      businessId: currentUser.businessId,
      entityId: payment.id,
      entityType: 'payments',
      mediaType: 'PDF',
      originalFileName: generated.fileName,
    });
    const metadata = await this.storage.uploadFile({
      content: generated.buffer,
      mimeType: generated.mimeType,
      objectKey,
    });
    const document = await tx.invoiceReceiptDocument.create({
      data: {
        businessId: currentUser.businessId,
        checksum: metadata.checksum ?? generated.checksum,
        createdBy: currentUser.id,
        fileName: generated.fileName,
        fileSizeBytes: metadata.contentLength || generated.buffer.length,
        invoiceId: invoice.id,
        mimeType: generated.mimeType,
        objectKey,
        paymentId: payment.id,
        receiptNumber,
      },
    });
    await this.writeAudit(
      tx,
      currentUser,
      'INVOICE_RECEIPT_DOCUMENT_CREATED',
      invoice,
      {
        paymentId: payment.id,
        receiptDocumentId: document.id,
        receiptNumber,
      },
    );
    return document;
  }

  private async createPublicToken(
    tx: Prisma.TransactionClient,
    businessId: string,
    invoiceId: string,
    version: number,
  ) {
    await tx.invoicePublicAccessToken.updateMany({
      where: {
        businessId,
        invoiceId,
        revokedAt: null,
        version: { lt: version },
      },
      data: { revokedAt: new Date() },
    });
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const token = await tx.invoicePublicAccessToken.create({
      data: {
        businessId,
        expiresAt,
        invoiceId,
        tokenHash,
        version,
      },
    });
    return { ...token, rawToken };
  }

  private async nextReceiptNumber(
    tx: Prisma.TransactionClient,
    businessId: string,
    receivedAt: Date,
  ) {
    await tx.receiptSequence.upsert({
      where: { businessId },
      create: { businessId, nextNumber: 1 },
      update: {},
    });
    const sequence = await tx.receiptSequence.update({
      where: { businessId },
      data: { nextNumber: { increment: 1 } },
    });
    return `RCT-${receivedAt.getUTCFullYear()}-${String(
      sequence.nextNumber,
    ).padStart(6, '0')}`;
  }

  private async resolvePublicToken(rawToken: string) {
    if (!rawToken?.trim()) {
      throw this.domainError(
        'INVOICE_PUBLIC_TOKEN_INVALID',
        'This invoice link is not valid.',
        HttpStatus.NOT_FOUND,
      );
    }
    const token = await this.prisma.invoicePublicAccessToken.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
      include: { invoice: { include: this.invoiceInclude() } },
    });
    if (!token) {
      throw this.domainError(
        'INVOICE_PUBLIC_TOKEN_INVALID',
        'This invoice link is not valid.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (token.revokedAt) {
      throw this.domainError(
        'INVOICE_PUBLIC_TOKEN_REVOKED',
        'This invoice link is no longer active.',
        HttpStatus.GONE,
      );
    }
    if (token.expiresAt < new Date()) {
      throw this.domainError(
        'INVOICE_PUBLIC_TOKEN_EXPIRED',
        'This invoice link has expired.',
        HttpStatus.GONE,
      );
    }
    if (token.invoice.status === 'VOID') {
      throw this.domainError(
        'INVOICE_VOID',
        'This invoice is no longer payable.',
        HttpStatus.GONE,
      );
    }
    return { invoice: token.invoice, token };
  }

  private async getBusiness(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: {
        abn: true,
        address: true,
        email: true,
        gstRegistered: true,
        id: true,
        name: true,
        phone: true,
        postcode: true,
        state: true,
        suburb: true,
        timezone: true,
      },
    });
    if (!business) {
      throw this.domainError(
        'INVOICE_ACCESS_DENIED',
        'Business could not be found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return business;
  }

  private async getBusinessTimezone(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { timezone: true },
    });
    return business?.timezone ?? 'Australia/Melbourne';
  }

  private async notifyPaymentRecorded(
    currentUser: AuthenticatedUser,
    invoice: InvoiceRecord,
    amountCents: number,
  ) {
    await this.notifications.createForRoles({
      actorUserId: currentUser.id,
      body: `${formatAudCents(amountCents)} was recorded against ${
        invoice.invoiceNumber
      }.`,
      businessId: currentUser.businessId,
      entityId: invoice.id,
      entityType: 'invoice',
      metadata: {
        amountCents,
        invoiceNumber: invoice.invoiceNumber,
      },
      roles: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'ACCOUNTANT'],
      title: 'Payment recorded',
      type: 'PAYMENT_RECORDED',
    });
  }

  private invoiceInclude() {
    return {
      business: {
        select: {
          abn: true,
          address: true,
          email: true,
          gstRegistered: true,
          id: true,
          name: true,
          phone: true,
          postcode: true,
          state: true,
          suburb: true,
        },
      },
      customer: {
        select: {
          companyName: true,
          displayName: true,
          email: true,
          id: true,
          phone: true,
        },
      },
      customerSite: {
        select: {
          addressLine1: true,
          addressLine2: true,
          id: true,
          label: true,
          postcode: true,
          state: true,
          suburb: true,
        },
      },
      job: {
        select: {
          assignedToUserId: true,
          id: true,
          jobNumber: true,
          title: true,
        },
      },
      lineItems: { orderBy: { position: 'asc' as const } },
      sourceQuote: {
        select: {
          id: true,
          quoteNumber: true,
          status: true,
          title: true,
          totalCents: true,
        },
      },
    };
  }

  private toInvoice(invoice: InvoiceRecord): Invoice {
    const plain = {
      amountPaidCents: invoice.amountPaidCents,
      balanceDueCents: invoice.balanceDueCents,
      businessId: invoice.businessId,
      createdAt: invoice.createdAt.toISOString(),
      createdBy: invoice.createdBy,
      creditAppliedCents: invoice.creditAppliedCents,
      currency: 'AUD' as const,
      customer: invoice.customer,
      customerId: invoice.customerId,
      customerNotes: invoice.customerNotes,
      customerSite: invoice.customerSite,
      customerSiteId: invoice.customerSiteId,
      description: invoice.description,
      discountCents: invoice.discountCents,
      discountType: invoice.discountType,
      discountValue: invoice.discountValue,
      dueDate: invoice.dueDate.toISOString(),
      gstCents: invoice.gstCents,
      gstRateBasisPoints: invoice.gstRateBasisPoints,
      id: invoice.id,
      internalNotes: invoice.internalNotes,
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate.toISOString(),
      job: invoice.job
        ? {
            id: invoice.job.id,
            jobNumber: invoice.job.jobNumber,
            title: invoice.job.title,
          }
        : null,
      jobId: invoice.jobId,
      lineItems: invoice.lineItems.map((item) => this.toLineItem(item)),
      paidAt: invoice.paidAt?.toISOString() ?? null,
      paymentTerms: invoice.paymentTerms,
      pricingMode: invoice.pricingMode,
      sentAt: invoice.sentAt?.toISOString() ?? null,
      sourceQuote: invoice.sourceQuote,
      sourceQuoteId: invoice.sourceQuoteId,
      status: invoice.status,
      subtotalCents: invoice.subtotalCents,
      title: invoice.title,
      totalCents: invoice.totalCents,
      updatedAt: invoice.updatedAt.toISOString(),
      updatedBy: invoice.updatedBy,
      version: invoice.version,
      viewedAt: invoice.viewedAt?.toISOString() ?? null,
      voidedAt: invoice.voidedAt?.toISOString() ?? null,
    };
    return {
      ...plain,
      displayStatus: getInvoiceDisplayStatus(plain),
    };
  }

  private toLineItem(
    item: InvoiceRecord['lineItems'][number],
  ): InvoiceLineItem {
    return {
      businessId: item.businessId,
      createdAt: item.createdAt.toISOString(),
      description: item.description,
      id: item.id,
      invoiceId: item.invoiceId,
      lineGstCents: item.lineGstCents,
      lineSubtotalCents: item.lineSubtotalCents,
      lineTotalCents: item.lineTotalCents,
      name: item.name,
      position: item.position,
      quantity: item.quantity.toString(),
      taxable: item.taxable,
      type: item.type as InvoiceLineItem['type'],
      unit: item.unit,
      unitPriceCents: item.unitPriceCents,
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private toPayment(payment: {
    amountCents: number;
    businessId: string;
    createdAt: Date;
    createdBy: string | null;
    creator?: {
      email: string;
      firstName: string;
      lastName: string;
    } | null;
    id: string;
    invoiceId: string;
    method: string;
    notes: string | null;
    receiptDocuments?: Array<{
      fileName: string;
      fileSizeBytes: number;
      generatedAt: Date;
      id: string;
      invoiceId: string;
      mimeType: string;
      paymentId: string;
      receiptNumber: string;
    }>;
    receivedAt: Date;
    reference: string | null;
    reversalReason: string | null;
    reversedAt: Date | null;
  }): InvoicePayment {
    const receiptDocument = payment.receiptDocuments?.[0] ?? null;
    return {
      amountCents: payment.amountCents,
      businessId: payment.businessId,
      createdAt: payment.createdAt.toISOString(),
      createdBy: payment.createdBy,
      createdByName: payment.creator
        ? `${payment.creator.firstName} ${payment.creator.lastName}`.trim() ||
          payment.creator.email
        : null,
      id: payment.id,
      invoiceId: payment.invoiceId,
      method: payment.method as InvoicePayment['method'],
      notes: payment.notes,
      receivedAt: payment.receivedAt.toISOString(),
      reference: payment.reference,
      receiptDocument: receiptDocument
        ? this.toReceiptDocument(receiptDocument)
        : null,
      reversalReason: payment.reversalReason,
      reversedAt: payment.reversedAt?.toISOString() ?? null,
    };
  }

  private toReceiptDocument(document: {
    fileName: string;
    fileSizeBytes: number;
    generatedAt: Date;
    id: string;
    invoiceId: string;
    mimeType: string;
    paymentId: string;
    receiptNumber: string;
  }): InvoiceReceiptDocumentSummary {
    return {
      fileName: document.fileName,
      fileSizeBytes: document.fileSizeBytes,
      generatedAt: document.generatedAt.toISOString(),
      id: document.id,
      invoiceId: document.invoiceId,
      mimeType: document.mimeType,
      paymentId: document.paymentId,
      receiptNumber: document.receiptNumber,
    };
  }

  private toPdfDocument(document: {
    fileName: string;
    fileSizeBytes: number;
    generatedAt: Date;
    id: string;
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

  private sumBalances(rows: Array<{ balanceDueCents: number }>) {
    return rows.reduce((sum, row) => sum + row.balanceDueCents, 0);
  }

  private businessDayStart(value: Date, timezone: string) {
    const parts = getBusinessDateParts(value, timezone);
    return zonedTimeToUtc(
      { day: parts.day, month: parts.month, year: parts.year },
      timezone,
    );
  }

  private businessMonthStart(value: Date, timezone: string) {
    const parts = getBusinessDateParts(value, timezone);
    return zonedTimeToUtc(
      { day: 1, month: parts.month, year: parts.year },
      timezone,
    );
  }

  private businessNextMonthStart(value: Date, timezone: string) {
    const parts = getBusinessDateParts(value, timezone);
    return zonedTimeToUtc(
      { day: 1, month: parts.month + 1, year: parts.year },
      timezone,
    );
  }

  private addUtcDays(value: Date, days: number) {
    const next = new Date(value);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  }

  private toPublicInvoice(invoice: InvoiceRecord): PublicInvoiceResponse {
    const safe = this.toInvoice(invoice);
    return {
      business: {
        abn: invoice.business?.abn ?? null,
        address: invoice.business?.address ?? null,
        email: invoice.business?.email ?? null,
        name: invoice.business?.name ?? 'TradieOS',
        phone: invoice.business?.phone ?? null,
        postcode: invoice.business?.postcode ?? null,
        state: invoice.business?.state ?? null,
        suburb: invoice.business?.suburb ?? null,
      },
      invoice: {
        amountPaidCents: safe.amountPaidCents,
        balanceDueCents: safe.balanceDueCents,
        creditAppliedCents: safe.creditAppliedCents,
        customer: safe.customer,
        customerNotes: safe.customerNotes,
        customerSite: safe.customerSite,
        description: safe.description,
        discountCents: safe.discountCents,
        dueDate: safe.dueDate,
        gstCents: safe.gstCents,
        invoiceNumber: safe.invoiceNumber,
        issueDate: safe.issueDate,
        lineItems: safe.lineItems.map((item) => ({
          lineTotalCents: item.lineTotalCents,
          name: item.name,
          quantity: item.quantity,
          taxable: item.taxable,
          type: item.type,
          unit: item.unit,
          unitPriceCents: item.unitPriceCents,
        })),
        paymentTerms: safe.paymentTerms,
        pricingMode: safe.pricingMode,
        status: safe.displayStatus,
        subtotalCents: safe.subtotalCents,
        title: safe.title,
        totalCents: safe.totalCents,
        version: safe.version,
      },
    };
  }

  private publicInvoiceUrl(token: string) {
    const base =
      this.config.get<string>('APP_PUBLIC_URL') ??
      this.config.get<string>('PUBLIC_APP_URL') ??
      this.config.get<string>('EXPO_PUBLIC_APP_URL') ??
      'http://localhost:8081';
    return `${base.replace(/\/$/, '')}/invoice/${encodeURIComponent(token)}`;
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    currentUser: { businessId: string; id: string | null },
    action: string,
    invoice: InvoiceRecord,
    metadata: Record<string, unknown>,
  ) {
    await tx.auditLog.create({
      data: {
        action,
        actorUserId: currentUser.id,
        businessId: currentUser.businessId,
        entityId: invoice.id,
        entityType: 'Invoice',
        metadata: {
          customerId: invoice.customerId,
          invoiceNumber: invoice.invoiceNumber,
          jobId: invoice.jobId,
          ...metadata,
        },
      },
    });
  }

  private assertRole(currentUser: AuthenticatedUser, roles: string[]) {
    if (!roles.includes(currentUser.role)) {
      throw this.domainError(
        'INVOICE_ACCESS_DENIED',
        'You do not have access to invoices.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private domainError(code: string, message: string, status: HttpStatus) {
    return new HttpException({ code, message }, status);
  }
}
