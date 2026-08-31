import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type {
  AuthenticatedUser,
  CustomerCommunication,
  CustomerCommunicationChannel,
  CustomerCommunicationSettings,
  CustomerCommunicationType,
} from '@tradieos/shared';
import {
  COMMUNICATION_APPOINTMENT_SEND_ROLES,
  COMMUNICATION_SEND_ROLES,
  COMMUNICATION_VIEW_ROLES,
  getBusinessDateParts,
  zonedTimeToUtc,
} from '@tradieos/shared';
import type {
  CustomerCommunication as PrismaCustomerCommunication,
  Prisma,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerCommunicationProvider } from './customer-communication.provider';
import {
  appointmentCancelledTemplate,
  appointmentConfirmationTemplate,
  appointmentReminderTemplate,
  appointmentRescheduledTemplate,
  invoiceDueSoonTemplate,
  invoiceOverdueTemplate,
  invoiceSentTemplate,
  jobCompletedTemplate,
  paymentReceivedTemplate,
  quoteFollowUpTemplate,
  type CommunicationTemplate,
} from './customer-communication.templates';
import type {
  ListCommunicationsQueryDto,
  ManualCustomerCommunicationDto,
  UpdateCommunicationPreferencesDto,
  UpdateCommunicationSettingsDto,
} from './dto/communications.dto';

type Tx = Prisma.TransactionClient | PrismaService;

type CustomerWithPreferences = {
  displayName: string;
  email: string | null;
  id: string;
  phone: string | null;
  communicationPreference?: {
    emailEnabled: boolean;
    smsEnabled: boolean;
  } | null;
};

type BusinessContact = {
  email: string | null;
  name: string;
  phone: string | null;
  timezone: string | null;
};

type InvoiceReminderType = 'INVOICE_DUE_SOON' | 'INVOICE_OVERDUE';

type ProcessableCommunicationRecord = PrismaCustomerCommunication;

type CommunicationEntityRefs = {
  relatedAppointmentId?: string | null;
  relatedInvoiceId?: string | null;
  relatedJobId?: string | null;
  relatedPaymentId?: string | null;
  relatedQuoteId?: string | null;
};

type UpsertCommunicationInput = CommunicationEntityRefs & {
  business: BusinessContact;
  channel?: CustomerCommunicationChannel;
  createdBy?: string | null;
  customer: CustomerWithPreferences;
  idempotencyKey: string;
  scheduledFor?: Date | null;
  template: CommunicationTemplate;
  type: CustomerCommunicationType;
};

const DEFAULT_PROCESS_LIMIT = 50;
const DEFAULT_PROCESSING_LOCK_SECONDS = 10 * 60;

@Injectable()
export class CustomerCommunicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: CustomerCommunicationProvider,
  ) {}

  async findAll(
    currentUser: AuthenticatedUser,
    query: ListCommunicationsQueryDto,
  ) {
    this.assertRole(currentUser, COMMUNICATION_VIEW_ROLES);
    const records = await this.prisma.customerCommunication.findMany({
      where: {
        businessId: currentUser.businessId,
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.appointmentId
          ? { relatedAppointmentId: query.appointmentId }
          : {}),
        ...(query.quoteId ? { relatedQuoteId: query.quoteId } : {}),
        ...(query.invoiceId ? { relatedInvoiceId: query.invoiceId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(100, Math.max(1, query.pageSize ?? 25)),
    });
    return { records: records.map((record) => this.toCommunication(record)) };
  }

  async findOne(currentUser: AuthenticatedUser, id: string) {
    this.assertRole(currentUser, COMMUNICATION_VIEW_ROLES);
    const record = await this.prisma.customerCommunication.findFirst({
      where: { businessId: currentUser.businessId, id },
    });
    if (!record) {
      throw this.domainError(
        'COMMUNICATION_NOT_FOUND',
        'Communication not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return { communication: this.toCommunication(record) };
  }

  async settings(currentUser: AuthenticatedUser) {
    this.assertRole(currentUser, COMMUNICATION_VIEW_ROLES);
    return { settings: await this.getSettings(currentUser.businessId) };
  }

  async updateSettings(
    currentUser: AuthenticatedUser,
    dto: UpdateCommunicationSettingsDto,
  ) {
    this.assertRole(currentUser, ['OWNER', 'ADMIN', 'OFFICE_MANAGER']);
    const settings = await this.prisma.businessCommunicationSettings.upsert({
      create: { businessId: currentUser.businessId, ...dto },
      update: dto,
      where: { businessId: currentUser.businessId },
    });
    return { settings: this.toSettings(settings) };
  }

  async preferences(currentUser: AuthenticatedUser, customerId: string) {
    this.assertRole(currentUser, COMMUNICATION_VIEW_ROLES);
    await this.assertCustomer(currentUser.businessId, customerId);
    return {
      preferences: await this.getPreferences(
        currentUser.businessId,
        customerId,
      ),
    };
  }

  async updatePreferences(
    currentUser: AuthenticatedUser,
    customerId: string,
    dto: UpdateCommunicationPreferencesDto,
  ) {
    this.assertRole(currentUser, COMMUNICATION_SEND_ROLES);
    await this.assertCustomer(currentUser.businessId, customerId);
    const preferences =
      await this.prisma.customerCommunicationPreference.upsert({
        create: {
          businessId: currentUser.businessId,
          customerId,
          emailEnabled: dto.emailEnabled ?? true,
          smsEnabled: dto.smsEnabled ?? true,
        },
        update: dto,
        where: {
          businessId_customerId: {
            businessId: currentUser.businessId,
            customerId,
          },
        },
      });
    return { preferences };
  }

  async sendManual(
    currentUser: AuthenticatedUser,
    dto: ManualCustomerCommunicationDto,
  ) {
    this.assertRole(currentUser, COMMUNICATION_SEND_ROLES);
    const [business, customer] = await Promise.all([
      this.getBusiness(currentUser.businessId),
      this.getCustomer(currentUser.businessId, dto.customerId),
    ]);
    const communication = await this.createOrSend(this.prisma, {
      business,
      channel: dto.channel,
      createdBy: currentUser.id,
      customer,
      idempotencyKey: this.idempotencyKey(
        currentUser.businessId,
        'MANUAL',
        dto.customerId,
        String(Date.now()),
      ),
      template: {
        message: dto.message.trim(),
        subject: dto.subject?.trim() || null,
      },
      type: 'MANUAL_MESSAGE',
    });
    return { communication: this.toCommunication(communication) };
  }

  async processDueCustomerCommunications(
    currentUser?: AuthenticatedUser,
    limit = DEFAULT_PROCESS_LIMIT,
  ) {
    if (currentUser) {
      this.assertRole(currentUser, ['OWNER', 'ADMIN', 'OFFICE_MANAGER']);
    }
    const startedAt = Date.now();
    const due = await this.findDueCommunications(limit);
    let sent = 0;
    let failed = 0;
    let claimed = 0;
    let skipped = 0;
    for (const record of due) {
      let current = await this.claimDueCommunication(record);
      if (!current) {
        skipped += 1;
        continue;
      }
      claimed += 1;
      current = await this.prepareScheduledCommunicationForDelivery(current);
      if (!current || current.status !== 'PROCESSING') {
        skipped += 1;
        continue;
      }
      const delivery = await this.provider.send({
        businessId: current.businessId,
        channel: current.channel,
        communicationId: current.id,
        entityReference: this.entityReference(current),
        message: current.message,
        recipient: current.recipient,
        subject: current.subject,
        type: current.type,
      });
      if (delivery.status === 'SENT') {
        await this.prisma.customerCommunication.update({
          where: { id: current.id },
          data: {
            failedAt: null,
            failureReason: null,
            processingExpiresAt: null,
            processingStartedAt: null,
            provider: delivery.provider ?? null,
            providerMessageId: delivery.providerMessageId ?? null,
            sentAt: new Date(),
            status: 'SENT',
          },
        });
        sent += 1;
      } else {
        await this.prisma.customerCommunication.update({
          where: { id: current.id },
          data: {
            failedAt: new Date(),
            failureReason: this.safeFailure(delivery.failureReason),
            processingExpiresAt: null,
            processingStartedAt: null,
            provider: delivery.provider ?? null,
            providerMessageId: delivery.providerMessageId ?? null,
            status: 'FAILED',
          },
        });
        await this.notifyCommunicationFailure(current);
        failed += 1;
      }
    }
    const result = {
      claimed,
      durationMs: Date.now() - startedAt,
      due: due.length,
      failed,
      processed: claimed,
      sent,
      skipped,
    };
    console.info('[TradieOS communications worker]', result);
    return result;
  }

  async appointmentCreated(
    tx: Tx,
    currentUser: AuthenticatedUser,
    appointment: {
      addressLine1: string;
      addressLine2: string | null;
      appointmentType: string;
      id: string;
      job: {
        customer: CustomerWithPreferences;
        customerId: string;
        title: string;
      };
      jobId: string;
      postcode: string;
      scheduledEnd: Date;
      scheduledStart: Date;
      state: string;
      suburb: string;
    },
  ) {
    this.assertRole(currentUser, COMMUNICATION_APPOINTMENT_SEND_ROLES);
    const [business, settings] = await Promise.all([
      this.getBusiness(currentUser.businessId, tx),
      this.getSettings(currentUser.businessId, tx),
    ]);
    const serviceAddress = this.serviceAddress(appointment);
    if (settings.appointmentConfirmationsEnabled) {
      await this.createOrSend(tx, {
        business,
        createdBy: currentUser.id,
        customer: appointment.job.customer,
        idempotencyKey: this.idempotencyKey(
          currentUser.businessId,
          'APPOINTMENT_CONFIRMATION',
          appointment.id,
        ),
        relatedAppointmentId: appointment.id,
        relatedJobId: appointment.jobId,
        template: appointmentConfirmationTemplate({
          appointmentType: appointment.appointmentType,
          business,
          customer: appointment.job.customer,
          end: appointment.scheduledEnd,
          jobTitle: appointment.job.title,
          serviceAddress,
          start: appointment.scheduledStart,
        }),
        type: 'APPOINTMENT_CONFIRMATION',
      });
    }
    if (settings.appointmentRemindersEnabled) {
      await this.scheduleAppointmentReminder(
        tx,
        currentUser,
        appointment,
        business,
        settings.appointmentReminderLeadMinutes,
      );
    }
  }

  async appointmentRescheduled(
    tx: Tx,
    currentUser: AuthenticatedUser,
    appointment: Parameters<
      CustomerCommunicationsService['appointmentCreated']
    >[2],
  ) {
    this.assertRole(currentUser, COMMUNICATION_APPOINTMENT_SEND_ROLES);
    const [business, settings] = await Promise.all([
      this.getBusiness(currentUser.businessId, tx),
      this.getSettings(currentUser.businessId, tx),
    ]);
    await this.cancelPending(tx, currentUser.businessId, {
      relatedAppointmentId: appointment.id,
      types: ['APPOINTMENT_REMINDER'],
    });
    await this.createOrSend(tx, {
      business,
      createdBy: currentUser.id,
      customer: appointment.job.customer,
      idempotencyKey: this.idempotencyKey(
        currentUser.businessId,
        'APPOINTMENT_RESCHEDULED',
        appointment.id,
        appointment.scheduledStart.toISOString(),
      ),
      relatedAppointmentId: appointment.id,
      relatedJobId: appointment.jobId,
      template: appointmentRescheduledTemplate({
        business,
        customer: appointment.job.customer,
        end: appointment.scheduledEnd,
        jobTitle: appointment.job.title,
        serviceAddress: this.serviceAddress(appointment),
        start: appointment.scheduledStart,
      }),
      type: 'APPOINTMENT_RESCHEDULED',
    });
    if (settings.appointmentRemindersEnabled) {
      await this.scheduleAppointmentReminder(
        tx,
        currentUser,
        appointment,
        business,
        settings.appointmentReminderLeadMinutes,
      );
    }
  }

  async appointmentCancelled(
    tx: Tx,
    currentUser: AuthenticatedUser,
    appointment: Parameters<
      CustomerCommunicationsService['appointmentCreated']
    >[2],
  ) {
    await this.cancelPending(tx, currentUser.businessId, {
      relatedAppointmentId: appointment.id,
      types: ['APPOINTMENT_REMINDER'],
    });
    const business = await this.getBusiness(currentUser.businessId, tx);
    await this.createOrSend(tx, {
      business,
      createdBy: currentUser.id,
      customer: appointment.job.customer,
      idempotencyKey: this.idempotencyKey(
        currentUser.businessId,
        'APPOINTMENT_CANCELLED',
        appointment.id,
      ),
      relatedAppointmentId: appointment.id,
      relatedJobId: appointment.jobId,
      template: appointmentCancelledTemplate({
        business,
        customer: appointment.job.customer,
        jobTitle: appointment.job.title,
      }),
      type: 'APPOINTMENT_CANCELLED',
    });
  }

  async appointmentCompleted(
    tx: Tx,
    currentUser: AuthenticatedUser,
    appointment: Parameters<
      CustomerCommunicationsService['appointmentCreated']
    >[2],
  ) {
    const business = await this.getBusiness(currentUser.businessId, tx);
    await this.createOrDraft(tx, {
      business,
      createdBy: currentUser.id,
      customer: appointment.job.customer,
      idempotencyKey: this.idempotencyKey(
        currentUser.businessId,
        'JOB_COMPLETED',
        appointment.jobId,
      ),
      relatedAppointmentId: appointment.id,
      relatedJobId: appointment.jobId,
      template: jobCompletedTemplate({
        business,
        customer: appointment.job.customer,
        jobTitle: appointment.job.title,
      }),
      type: 'JOB_COMPLETED',
    });
  }

  async quoteSent(input: {
    businessId: string;
    createdBy: string | null;
    publicUrl: string;
    quoteId: string;
  }) {
    const [business, settings, quote] = await Promise.all([
      this.getBusiness(input.businessId),
      this.getSettings(input.businessId),
      this.prisma.quote.findFirst({
        where: { businessId: input.businessId, id: input.quoteId },
        include: {
          customer: { include: { communicationPreference: true } },
        },
      }),
    ]);
    if (!quote) return;
    await this.createOrSend(this.prisma, {
      business,
      createdBy: input.createdBy,
      customer: quote.customer,
      idempotencyKey: this.idempotencyKey(
        input.businessId,
        'QUOTE_SENT',
        quote.id,
        String(quote.version),
      ),
      relatedQuoteId: quote.id,
      template: {
        message: `Quote ${quote.quoteNumber} from ${business.name} was sent. Review it here: ${input.publicUrl}`,
        subject: `Quote ${quote.quoteNumber} from ${business.name}`,
      },
      type: 'QUOTE_SENT',
    });
    if (settings.quoteFollowUpsEnabled && this.quoteCanBeFollowedUp(quote)) {
      await this.createOrSchedule(this.prisma, {
        business,
        createdBy: input.createdBy,
        customer: quote.customer,
        idempotencyKey: this.idempotencyKey(
          input.businessId,
          'QUOTE_FOLLOW_UP',
          quote.id,
          String(quote.version),
        ),
        relatedQuoteId: quote.id,
        scheduledFor: this.addBusinessLocalMinutes(
          quote.sentAt ?? new Date(),
          settings.quoteFollowUpDelayMinutes,
          business.timezone,
        ),
        template: quoteFollowUpTemplate({
          business,
          customer: quote.customer,
          expiryDate: quote.expiryDate,
          quoteNumber: quote.quoteNumber,
          quoteUrl: input.publicUrl,
          totalCents: quote.totalCents,
        }),
        type: 'QUOTE_FOLLOW_UP',
      });
    }
  }

  async quoteFinalised(businessId: string, quoteId: string) {
    await this.cancelPending(this.prisma, businessId, {
      relatedQuoteId: quoteId,
      types: ['QUOTE_FOLLOW_UP'],
    });
  }

  async invoiceSent(input: {
    businessId: string;
    createdBy: string | null;
    invoiceId: string;
    publicUrl: string;
  }) {
    const [business, settings, invoice] = await Promise.all([
      this.getBusiness(input.businessId),
      this.getSettings(input.businessId),
      this.prisma.invoice.findFirst({
        where: { businessId: input.businessId, id: input.invoiceId },
        include: {
          customer: { include: { communicationPreference: true } },
        },
      }),
    ]);
    if (!invoice) return;
    await this.createOrSend(this.prisma, {
      business,
      createdBy: input.createdBy,
      customer: invoice.customer,
      idempotencyKey: this.idempotencyKey(
        input.businessId,
        'INVOICE_SENT',
        invoice.id,
        String(invoice.version),
      ),
      relatedInvoiceId: invoice.id,
      template: invoiceSentTemplate({
        business,
        customer: invoice.customer,
        dueDate: invoice.dueDate,
        invoiceNumber: invoice.invoiceNumber,
        invoiceUrl: input.publicUrl,
        totalCents: invoice.totalCents,
      }),
      type: 'INVOICE_SENT',
    });
    if (this.invoiceCanBeReminded(invoice)) {
      if (settings.invoiceDueSoonRemindersEnabled) {
        const scheduledFor = this.clampPastSchedule(
          new Date(
            invoice.dueDate.getTime() -
              settings.invoiceDueSoonLeadMinutes * 60_000,
          ),
        );
        await this.createOrSchedule(this.prisma, {
          business,
          createdBy: input.createdBy,
          customer: invoice.customer,
          idempotencyKey: this.idempotencyKey(
            input.businessId,
            'INVOICE_DUE_SOON',
            invoice.id,
          ),
          relatedInvoiceId: invoice.id,
          scheduledFor,
          template: invoiceDueSoonTemplate({
            amountPaidCents: invoice.amountPaidCents,
            balanceDueCents: invoice.balanceDueCents,
            business,
            customer: invoice.customer,
            dueDate: invoice.dueDate,
            invoiceNumber: invoice.invoiceNumber,
            invoiceUrl: input.publicUrl,
            totalCents: invoice.totalCents,
          }),
          type: 'INVOICE_DUE_SOON',
        });
      }
      if (settings.invoiceOverdueRemindersEnabled) {
        const scheduledFor = this.clampPastSchedule(
          new Date(
            invoice.dueDate.getTime() +
              settings.invoiceOverdueDelayMinutes * 60_000,
          ),
        );
        await this.createOrSchedule(this.prisma, {
          business,
          createdBy: input.createdBy,
          customer: invoice.customer,
          idempotencyKey: this.idempotencyKey(
            input.businessId,
            'INVOICE_OVERDUE',
            invoice.id,
          ),
          relatedInvoiceId: invoice.id,
          scheduledFor,
          template: invoiceOverdueTemplate({
            amountPaidCents: invoice.amountPaidCents,
            balanceDueCents: invoice.balanceDueCents,
            business,
            customer: invoice.customer,
            dueDate: invoice.dueDate,
            invoiceNumber: invoice.invoiceNumber,
            invoiceUrl: input.publicUrl,
            totalCents: invoice.totalCents,
          }),
          type: 'INVOICE_OVERDUE',
        });
      }
    }
  }

  async paymentRecorded(input: {
    businessId: string;
    createdBy: string | null;
    invoiceId: string;
    paymentId: string;
  }) {
    const [business, settings, payment] = await Promise.all([
      this.getBusiness(input.businessId),
      this.getSettings(input.businessId),
      this.prisma.invoicePayment.findFirst({
        where: {
          businessId: input.businessId,
          id: input.paymentId,
          invoiceId: input.invoiceId,
        },
        include: {
          invoice: {
            include: {
              customer: { include: { communicationPreference: true } },
            },
          },
        },
      }),
    ]);
    if (!payment) return;
    if (settings.paymentConfirmationsEnabled) {
      await this.createOrSend(this.prisma, {
        business,
        createdBy: input.createdBy,
        customer: payment.invoice.customer,
        idempotencyKey: this.idempotencyKey(
          input.businessId,
          'PAYMENT_RECEIVED',
          payment.id,
        ),
        relatedInvoiceId: input.invoiceId,
        relatedPaymentId: payment.id,
        template: paymentReceivedTemplate({
          amountCents: payment.amountCents,
          balanceDueCents: payment.invoice.balanceDueCents,
          business,
          customer: payment.invoice.customer,
          invoiceNumber: payment.invoice.invoiceNumber,
          method: payment.method,
          receivedAt: payment.receivedAt,
          totalPaidCents: payment.invoice.amountPaidCents,
        }),
        type: 'PAYMENT_RECEIVED',
      });
    }
    if (
      payment.invoice.balanceDueCents <= 0 ||
      payment.invoice.status === 'PAID'
    ) {
      await this.cancelPending(this.prisma, input.businessId, {
        relatedInvoiceId: input.invoiceId,
        types: ['INVOICE_DUE_SOON', 'INVOICE_OVERDUE'],
      });
    } else {
      await this.refreshPendingInvoiceReminderMessages(
        input.businessId,
        input.invoiceId,
      );
    }
  }

  async invoiceClosed(businessId: string, invoiceId: string) {
    await this.cancelPending(this.prisma, businessId, {
      relatedInvoiceId: invoiceId,
      types: ['INVOICE_DUE_SOON', 'INVOICE_OVERDUE'],
    });
  }

  private async scheduleAppointmentReminder(
    tx: Tx,
    currentUser: AuthenticatedUser,
    appointment: Parameters<
      CustomerCommunicationsService['appointmentCreated']
    >[2],
    business: BusinessContact,
    leadMinutes: number,
  ) {
    await this.createOrSchedule(tx, {
      business,
      createdBy: currentUser.id,
      customer: appointment.job.customer,
      idempotencyKey: this.idempotencyKey(
        currentUser.businessId,
        'APPOINTMENT_REMINDER',
        appointment.id,
        appointment.scheduledStart.toISOString(),
      ),
      relatedAppointmentId: appointment.id,
      relatedJobId: appointment.jobId,
      scheduledFor: new Date(
        appointment.scheduledStart.getTime() - leadMinutes * 60_000,
      ),
      template: appointmentReminderTemplate({
        business,
        customer: appointment.job.customer,
        end: appointment.scheduledEnd,
        jobTitle: appointment.job.title,
        serviceAddress: this.serviceAddress(appointment),
        start: appointment.scheduledStart,
      }),
      type: 'APPOINTMENT_REMINDER',
    });
  }

  private async createOrDraft(tx: Tx, input: UpsertCommunicationInput) {
    return this.upsertRecord(tx, input, 'DRAFT');
  }

  private async createOrSchedule(tx: Tx, input: UpsertCommunicationInput) {
    return this.upsertRecord(tx, input, 'SCHEDULED');
  }

  private async createOrSend(tx: Tx, input: UpsertCommunicationInput) {
    const draft = await this.upsertRecord(tx, input, 'SENT');
    if (draft.status === 'SENT' && draft.sentAt) {
      return draft;
    }
    if (draft.status === 'FAILED') {
      return draft;
    }
    const delivery = await this.provider.send({
      businessId: draft.businessId,
      channel: draft.channel,
      communicationId: draft.id,
      entityReference: this.entityReference(draft),
      message: draft.message,
      recipient: draft.recipient,
      subject: draft.subject,
      type: draft.type,
    });
    if (delivery.status === 'SENT') {
      return tx.customerCommunication.update({
        where: { id: draft.id },
        data: {
          provider: delivery.provider ?? null,
          providerMessageId: delivery.providerMessageId ?? null,
          sentAt: new Date(),
          status: 'SENT',
        },
      });
    }
    return tx.customerCommunication.update({
      where: { id: draft.id },
      data: {
        failedAt: new Date(),
        failureReason: this.safeFailure(delivery.failureReason),
        provider: delivery.provider ?? null,
        providerMessageId: delivery.providerMessageId ?? null,
        status: 'FAILED',
      },
    });
  }

  private async upsertRecord(
    tx: Tx,
    input: UpsertCommunicationInput,
    status: 'DRAFT' | 'SCHEDULED' | 'SENT',
  ) {
    const businessId = this.businessIdFromKey(input.idempotencyKey);
    const channel = input.channel ?? this.preferredChannel(input.customer);
    const recipient = this.recipientFor(input.customer, channel);
    const failureReason = this.recipientFailure(input.customer, channel);
    const nextStatus: Prisma.CustomerCommunicationUncheckedCreateInput['status'] =
      failureReason ? 'FAILED' : status;
    const existing = await tx.customerCommunication.findUnique({
      where: {
        businessId_idempotencyKey: {
          businessId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing?.status === 'SENT' || existing?.status === 'CANCELLED') {
      return existing;
    }
    const data: Prisma.CustomerCommunicationUncheckedCreateInput = {
      businessId,
      cancelledAt: null,
      channel,
      createdBy: input.createdBy ?? null,
      customerId: input.customer.id,
      failedAt: failureReason ? new Date() : null,
      failureReason,
      idempotencyKey: input.idempotencyKey,
      message: input.template.message,
      preview: input.template.message.replace(/\s+/g, ' ').slice(0, 160),
      processingExpiresAt: null,
      processingStartedAt: null,
      provider: null,
      providerMessageId: null,
      recipient: recipient ?? 'missing-recipient',
      relatedAppointmentId: input.relatedAppointmentId ?? null,
      relatedInvoiceId: input.relatedInvoiceId ?? null,
      relatedJobId: input.relatedJobId ?? null,
      relatedPaymentId: input.relatedPaymentId ?? null,
      relatedQuoteId: input.relatedQuoteId ?? null,
      scheduledFor: nextStatus === 'SCHEDULED' ? input.scheduledFor : null,
      sentAt: null,
      status: nextStatus,
      subject: input.template.subject,
      type: input.type,
    };
    return tx.customerCommunication.upsert({
      create: data,
      update: {
        ...data,
        createdBy: undefined,
        customerId: undefined,
        idempotencyKey: undefined,
        provider: undefined,
        providerMessageId: undefined,
      },
      where: {
        businessId_idempotencyKey: {
          businessId: data.businessId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
  }

  private async cancelPending(
    tx: Tx,
    businessId: string,
    input: {
      relatedAppointmentId?: string;
      relatedInvoiceId?: string;
      relatedQuoteId?: string;
      types: CustomerCommunicationType[];
    },
  ) {
    await tx.customerCommunication.updateMany({
      where: {
        businessId,
        status: 'SCHEDULED',
        type: { in: input.types },
        ...(input.relatedAppointmentId
          ? { relatedAppointmentId: input.relatedAppointmentId }
          : {}),
        ...(input.relatedQuoteId
          ? { relatedQuoteId: input.relatedQuoteId }
          : {}),
        ...(input.relatedInvoiceId
          ? { relatedInvoiceId: input.relatedInvoiceId }
          : {}),
      },
      data: {
        cancelledAt: new Date(),
        status: 'CANCELLED',
      },
    });
  }

  private async findDueCommunications(limit: number) {
    const now = new Date();
    return this.prisma.customerCommunication.findMany({
      where: {
        OR: [
          {
            scheduledFor: { lte: now },
            status: 'SCHEDULED',
          },
          {
            processingExpiresAt: { lte: now },
            status: 'PROCESSING',
          },
        ],
      },
      orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'asc' }],
      take: limit,
    });
  }

  private async claimDueCommunication(record: ProcessableCommunicationRecord) {
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + DEFAULT_PROCESSING_LOCK_SECONDS * 1000,
    );
    const claimed = await this.prisma.customerCommunication.updateMany({
      where: {
        id: record.id,
        OR: [
          {
            scheduledFor: { lte: now },
            status: 'SCHEDULED',
          },
          {
            processingExpiresAt: { lte: now },
            status: 'PROCESSING',
          },
        ],
      },
      data: {
        processingExpiresAt: expiresAt,
        processingStartedAt: now,
        status: 'PROCESSING',
      },
    });
    if (claimed.count !== 1) return null;
    return this.prisma.customerCommunication.findUnique({
      where: { id: record.id },
    });
  }

  private async prepareScheduledCommunicationForDelivery(
    record: ProcessableCommunicationRecord,
  ) {
    if (record.type === 'APPOINTMENT_REMINDER') {
      return this.prepareAppointmentReminderForDelivery(record);
    }
    if (record.type === 'QUOTE_FOLLOW_UP') {
      return this.prepareQuoteFollowUpForDelivery(record);
    }
    if (this.isInvoiceReminderType(record.type)) {
      return this.prepareInvoiceReminderForDelivery(record);
    }
    return record;
  }

  private async prepareAppointmentReminderForDelivery(
    record: ProcessableCommunicationRecord,
  ) {
    if (!record.relatedAppointmentId) {
      return this.cancelClaimedCommunication(
        record.id,
        'COMMUNICATION_APPOINTMENT_MISSING',
      );
    }
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        businessId: record.businessId,
        id: record.relatedAppointmentId,
      },
      select: { scheduledStart: true, status: true },
    });
    if (
      !appointment ||
      !['SCHEDULED', 'CONFIRMED'].includes(appointment.status) ||
      appointment.scheduledStart.getTime() <= Date.now()
    ) {
      return this.cancelClaimedCommunication(
        record.id,
        'COMMUNICATION_APPOINTMENT_NOT_ELIGIBLE',
      );
    }
    return record;
  }

  private async prepareQuoteFollowUpForDelivery(
    record: ProcessableCommunicationRecord,
  ) {
    if (!record.relatedQuoteId) {
      return this.cancelClaimedCommunication(
        record.id,
        'COMMUNICATION_QUOTE_MISSING',
      );
    }
    const quote = await this.prisma.quote.findFirst({
      where: {
        businessId: record.businessId,
        id: record.relatedQuoteId,
      },
      select: {
        acceptedAt: true,
        archivedAt: true,
        cancelledAt: true,
        declinedAt: true,
        expiredAt: true,
        expiryDate: true,
        status: true,
      },
    });
    if (!quote || !this.quoteCanBeFollowedUp(quote)) {
      return this.cancelClaimedCommunication(
        record.id,
        'COMMUNICATION_QUOTE_NOT_ELIGIBLE',
      );
    }
    return record;
  }

  private async cancelClaimedCommunication(id: string, reason: string) {
    await this.prisma.customerCommunication.update({
      where: { id },
      data: {
        cancelledAt: new Date(),
        failureReason: reason,
        processingExpiresAt: null,
        processingStartedAt: null,
        status: 'CANCELLED',
      },
    });
    return null;
  }

  private isInvoiceReminderType(type: string): type is InvoiceReminderType {
    return type === 'INVOICE_DUE_SOON' || type === 'INVOICE_OVERDUE';
  }

  private async prepareInvoiceReminderForDelivery(record: {
    businessId: string;
    id: string;
    message: string;
    relatedInvoiceId: string | null;
    status: string;
    type: string;
  }) {
    if (!record.relatedInvoiceId || !this.isInvoiceReminderType(record.type)) {
      return record as never;
    }
    const refreshed = await this.invoiceReminderUpdate({
      ...record,
      type: record.type,
    });
    if (!refreshed) {
      return this.prisma.customerCommunication.update({
        where: { id: record.id },
        data: {
          cancelledAt: new Date(),
          failureReason: 'COMMUNICATION_INVOICE_NOT_ELIGIBLE',
          processingExpiresAt: null,
          processingStartedAt: null,
          status: 'CANCELLED',
        },
      });
    }
    const next =
      refreshed.status === 'SCHEDULED'
        ? ({
            ...refreshed,
            processingExpiresAt: undefined,
            processingStartedAt: undefined,
            status: 'PROCESSING',
          } as const)
        : ({
            ...refreshed,
            processingExpiresAt: null,
            processingStartedAt: null,
          } as const);
    return this.prisma.customerCommunication.update({
      where: { id: record.id },
      data: next,
    });
  }

  private async refreshPendingInvoiceReminderMessages(
    businessId: string,
    invoiceId: string,
  ) {
    const reminders = await this.prisma.customerCommunication.findMany({
      where: {
        businessId,
        relatedInvoiceId: invoiceId,
        status: 'SCHEDULED',
        type: { in: ['INVOICE_DUE_SOON', 'INVOICE_OVERDUE'] },
      },
    });
    for (const reminder of reminders) {
      if (!this.isInvoiceReminderType(reminder.type)) continue;
      const update = await this.invoiceReminderUpdate({
        ...reminder,
        type: reminder.type,
      });
      await this.prisma.customerCommunication.update({
        where: { id: reminder.id },
        data:
          update ??
          ({
            cancelledAt: new Date(),
            status: 'CANCELLED',
          } as const),
      });
    }
  }

  private async invoiceReminderUpdate(record: {
    businessId: string;
    id: string;
    message: string;
    relatedInvoiceId: string | null;
    type: InvoiceReminderType;
  }) {
    if (!record.relatedInvoiceId) return null;
    const [business, invoice] = await Promise.all([
      this.getBusiness(record.businessId),
      this.prisma.invoice.findFirst({
        where: { businessId: record.businessId, id: record.relatedInvoiceId },
        include: {
          customer: { include: { communicationPreference: true } },
        },
      }),
    ]);
    if (!invoice || !this.invoiceCanBeReminded(invoice)) return null;
    const settings = await this.getSettings(record.businessId);
    if (
      (record.type === 'INVOICE_DUE_SOON' &&
        !settings.invoiceDueSoonRemindersEnabled) ||
      (record.type === 'INVOICE_OVERDUE' &&
        !settings.invoiceOverdueRemindersEnabled)
    ) {
      return null;
    }
    const customer = invoice.customer;
    const channel = this.preferredChannel(customer);
    const recipient = this.recipientFor(customer, channel);
    const failureReason = this.recipientFailure(customer, channel);
    const invoiceUrl = this.invoiceUrlFromMessage(record.message);
    const template =
      record.type === 'INVOICE_DUE_SOON'
        ? invoiceDueSoonTemplate({
            amountPaidCents: invoice.amountPaidCents,
            balanceDueCents: invoice.balanceDueCents,
            business,
            customer,
            dueDate: invoice.dueDate,
            invoiceNumber: invoice.invoiceNumber,
            invoiceUrl,
            totalCents: invoice.totalCents,
          })
        : invoiceOverdueTemplate({
            amountPaidCents: invoice.amountPaidCents,
            balanceDueCents: invoice.balanceDueCents,
            business,
            customer,
            dueDate: invoice.dueDate,
            invoiceNumber: invoice.invoiceNumber,
            invoiceUrl,
            totalCents: invoice.totalCents,
          });
    return {
      channel,
      failedAt: failureReason ? new Date() : null,
      failureReason,
      message: template.message,
      preview: template.message.replace(/\s+/g, ' ').slice(0, 160),
      provider: null,
      providerMessageId: null,
      recipient: recipient ?? 'missing-recipient',
      status: failureReason ? 'FAILED' : 'SCHEDULED',
      subject: template.subject,
    } as const;
  }

  private invoiceUrlFromMessage(message: string) {
    return (
      message
        .split('\n')
        .find((line) => line.startsWith('View invoice: '))
        ?.replace('View invoice: ', '')
        .trim() ?? ''
    );
  }

  private clampPastSchedule(value: Date) {
    const now = new Date();
    return value.getTime() < now.getTime() ? now : value;
  }

  private async notifyCommunicationFailure(record: {
    businessId: string;
    id: string;
    type: string;
  }) {
    const members = await this.prisma.businessMember.findMany({
      where: {
        businessId: record.businessId,
        role: { in: ['OWNER', 'ADMIN', 'OFFICE_MANAGER'] },
        status: 'ACTIVE',
        userId: { not: null },
      },
      select: { userId: true },
    });
    await this.prisma.notification.createMany({
      data: members
        .filter((member): member is { userId: string } =>
          Boolean(member.userId),
        )
        .map((member) => ({
          body: `A ${record.type.replaceAll('_', ' ').toLowerCase()} communication could not be delivered.`,
          businessId: record.businessId,
          entityId: record.id,
          entityType: 'communication',
          metadata: {
            communicationId: record.id,
            communicationType: record.type,
          },
          title: 'Customer communication failed',
          type: 'COMMUNICATION_FAILED',
          userId: member.userId,
        })),
      skipDuplicates: true,
    });
  }

  private async getBusiness(businessId: string, tx: Tx = this.prisma) {
    const business = await tx.business.findUnique({
      where: { id: businessId },
      select: {
        email: true,
        name: true,
        phone: true,
        timezone: true,
      },
    });
    if (!business) {
      throw this.domainError(
        'BUSINESS_NOT_FOUND',
        'Business not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return business;
  }

  private async getCustomer(businessId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { businessId, id: customerId, isArchived: false },
      include: { communicationPreference: true },
    });
    if (!customer) {
      throw this.domainError(
        'CUSTOMER_NOT_FOUND',
        'Customer not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return customer;
  }

  private async assertCustomer(businessId: string, customerId: string) {
    await this.getCustomer(businessId, customerId);
  }

  private async getSettings(
    businessId: string,
    tx: Tx = this.prisma,
  ): Promise<CustomerCommunicationSettings> {
    const settings = await tx.businessCommunicationSettings.upsert({
      create: { businessId },
      update: {},
      where: { businessId },
    });
    return this.toSettings(settings);
  }

  private async getPreferences(
    businessId: string,
    customerId: string,
    tx: Tx = this.prisma,
  ) {
    return tx.customerCommunicationPreference.upsert({
      create: { businessId, customerId },
      update: {},
      where: {
        businessId_customerId: {
          businessId,
          customerId,
        },
      },
    });
  }

  private preferredChannel(customer: CustomerWithPreferences) {
    if (
      customer.email &&
      customer.communicationPreference?.emailEnabled !== false
    ) {
      return 'EMAIL';
    }
    return 'SMS';
  }

  private recipientFor(
    customer: CustomerWithPreferences,
    channel: CustomerCommunicationChannel,
  ) {
    return channel === 'EMAIL' ? customer.email : customer.phone;
  }

  private recipientFailure(
    customer: CustomerWithPreferences,
    channel: CustomerCommunicationChannel,
  ) {
    if (
      channel === 'EMAIL' &&
      customer.communicationPreference?.emailEnabled === false
    ) {
      return 'COMMUNICATION_EMAIL_DISABLED';
    }
    if (
      channel === 'SMS' &&
      customer.communicationPreference?.smsEnabled === false
    ) {
      return 'COMMUNICATION_SMS_DISABLED';
    }
    if (channel === 'EMAIL' && !customer.email) {
      return 'COMMUNICATION_RECIPIENT_MISSING';
    }
    if (channel === 'SMS' && !customer.phone) {
      return 'COMMUNICATION_RECIPIENT_MISSING';
    }
    return null;
  }

  private idempotencyKey(
    businessId: string,
    type: string,
    entityId: string,
    scheduledForOrVersion = 'now',
  ) {
    return [businessId, type, entityId, scheduledForOrVersion].join(':');
  }

  private businessIdFromKey(key: string) {
    return key.split(':')[0];
  }

  private serviceAddress(input: {
    addressLine1: string;
    addressLine2: string | null;
    postcode: string;
    state: string;
    suburb: string;
  }) {
    return [
      input.addressLine1,
      input.addressLine2,
      input.suburb,
      input.state,
      input.postcode,
    ]
      .filter(Boolean)
      .join(', ');
  }

  private quoteCanBeFollowedUp(quote: {
    acceptedAt: Date | null;
    archivedAt: Date | null;
    cancelledAt: Date | null;
    declinedAt: Date | null;
    expiredAt: Date | null;
    expiryDate: Date | null;
    status: string;
  }) {
    const active = ['SENT', 'VIEWED'].includes(quote.status);
    const notExpired =
      !quote.expiryDate || quote.expiryDate.getTime() > Date.now();
    return (
      active &&
      notExpired &&
      !quote.acceptedAt &&
      !quote.declinedAt &&
      !quote.cancelledAt &&
      !quote.expiredAt &&
      !quote.archivedAt
    );
  }

  private addBusinessLocalMinutes(
    value: Date,
    minutes: number,
    timezone?: string | null,
  ) {
    const parts = getBusinessDateParts(value, timezone ?? undefined);
    const shiftedLocal = new Date(
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute + minutes,
        parts.second,
      ),
    );
    const shiftedParts = {
      day: shiftedLocal.getUTCDate(),
      hour: shiftedLocal.getUTCHours(),
      minute: shiftedLocal.getUTCMinutes(),
      month: shiftedLocal.getUTCMonth() + 1,
      second: shiftedLocal.getUTCSeconds(),
      year: shiftedLocal.getUTCFullYear(),
    };
    return zonedTimeToUtc(shiftedParts, timezone ?? undefined);
  }

  private invoiceCanBeReminded(invoice: {
    balanceDueCents: number;
    status: string;
  }) {
    return (
      invoice.balanceDueCents > 0 &&
      ['SENT', 'VIEWED', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status)
    );
  }

  private safeFailure(reason: string | undefined) {
    return reason?.slice(0, 240) || 'COMMUNICATION_SEND_FAILED';
  }

  private entityReference(record: CommunicationEntityRefs) {
    return (
      record.relatedAppointmentId ??
      record.relatedQuoteId ??
      record.relatedInvoiceId ??
      record.relatedPaymentId ??
      record.relatedJobId ??
      'customer'
    );
  }

  private toSettings(settings: {
    appointmentConfirmationsEnabled: boolean;
    appointmentReminderLeadMinutes: number;
    appointmentRemindersEnabled: boolean;
    businessId: string;
    invoiceDueSoonLeadMinutes: number;
    invoiceDueSoonRemindersEnabled: boolean;
    invoiceOverdueDelayMinutes: number;
    invoiceOverdueRemindersEnabled: boolean;
    paymentConfirmationsEnabled: boolean;
    quoteFollowUpDelayMinutes: number;
    quoteFollowUpsEnabled: boolean;
  }): CustomerCommunicationSettings {
    return {
      appointmentConfirmationsEnabled: settings.appointmentConfirmationsEnabled,
      appointmentReminderLeadMinutes: settings.appointmentReminderLeadMinutes,
      appointmentRemindersEnabled: settings.appointmentRemindersEnabled,
      businessId: settings.businessId,
      invoiceDueSoonLeadMinutes: settings.invoiceDueSoonLeadMinutes,
      invoiceDueSoonRemindersEnabled: settings.invoiceDueSoonRemindersEnabled,
      invoiceOverdueDelayMinutes: settings.invoiceOverdueDelayMinutes,
      invoiceOverdueRemindersEnabled: settings.invoiceOverdueRemindersEnabled,
      paymentConfirmationsEnabled: settings.paymentConfirmationsEnabled,
      quoteFollowUpDelayMinutes: settings.quoteFollowUpDelayMinutes,
      quoteFollowUpsEnabled: settings.quoteFollowUpsEnabled,
    };
  }

  private toCommunication(record: {
    businessId: string;
    cancelledAt: Date | null;
    channel: CustomerCommunicationChannel;
    createdAt: Date;
    createdBy: string | null;
    customerId: string;
    failedAt: Date | null;
    failureReason: string | null;
    id: string;
    idempotencyKey: string;
    message: string;
    preview: string | null;
    processingExpiresAt: Date | null;
    processingStartedAt: Date | null;
    provider: string | null;
    providerMessageId: string | null;
    recipient: string;
    relatedAppointmentId: string | null;
    relatedInvoiceId: string | null;
    relatedJobId: string | null;
    relatedPaymentId: string | null;
    relatedQuoteId: string | null;
    scheduledFor: Date | null;
    sentAt: Date | null;
    status: CustomerCommunication['status'];
    subject: string | null;
    type: CustomerCommunicationType;
    updatedAt: Date;
  }): CustomerCommunication {
    return {
      ...record,
      cancelledAt: record.cancelledAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      failedAt: record.failedAt?.toISOString() ?? null,
      processingExpiresAt: record.processingExpiresAt?.toISOString() ?? null,
      processingStartedAt: record.processingStartedAt?.toISOString() ?? null,
      scheduledFor: record.scheduledFor?.toISOString() ?? null,
      sentAt: record.sentAt?.toISOString() ?? null,
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private assertRole(currentUser: AuthenticatedUser, allowedRoles: string[]) {
    if (!allowedRoles.includes(currentUser.role)) {
      throw this.domainError(
        'COMMUNICATION_ACCESS_DENIED',
        'You do not have permission to manage customer communications.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private domainError(
    code: string,
    message: string,
    status = HttpStatus.BAD_REQUEST,
    details?: Record<string, unknown>,
  ) {
    return new HttpException({ code, details, message }, status);
  }
}
