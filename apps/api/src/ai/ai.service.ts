import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ACCOUNTS_RECEIVABLE_VIEW_ROLES,
  APPOINTMENT_VIEW_ROLES,
  APPOINTMENT_WRITE_ROLES,
  COMMUNICATION_APPOINTMENT_SEND_ROLES,
  CUSTOMER_WRITE_ROLES,
  formatAudCents,
  formatBusinessDate,
  formatBusinessDateTime,
  formatBusinessTime,
  formatBusinessTimeRange,
  getBusinessDateParts,
  getBusinessDayRangeUtc,
  INVOICE_CREATE_ROLES,
  INVOICE_OPEN_STATUSES,
  INVOICE_VIEW_ROLES,
  JOB_WRITE_ROLES,
  JOB_VIEW_ROLES,
  QUOTE_CREATE_ROLES,
  QUOTE_VIEW_ROLES,
  calculateInvoiceTotals,
  calculateQuoteTotals,
  normaliseBusinessTimezone,
  roleCanConfirmToriAction,
  roleCanUseTori,
  zonedTimeToUtc,
  type AppointmentPayload,
  type AustralianState,
  type AuthenticatedUser,
  type BusinessRole,
  type CustomerCommunicationChannel,
  type CustomerPayload,
  type InvoicePayload,
  type JobPayload,
  type QuotePayload,
  type ToriActionConfirmResponse,
  type ToriActionDraft,
  type ToriActionPayload,
  type ToriChatRequest,
  type ToriChatResponse,
  type ToriContext,
  type ToriSnapshot,
} from '@tradieos/shared';
import { AppointmentsService } from '../appointments/appointments.service';
import { CustomerCommunicationsService } from '../communications/communications.service';
import { CustomersService } from '../customers/customers.service';
import { InvoicesService } from '../invoices/invoices.service';
import type { UpsertInvoiceDto } from '../invoices/dto/invoices.dto';
import type { Prisma } from '../generated/prisma/client';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuotesService } from '../quotes/quotes.service';
import type { UpsertQuoteDto } from '../quotes/dto/quotes.dto';
import { AiProvider } from './ai-provider';

const CLOSED_APPOINTMENT_STATUSES = [
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
] as const;

const ACTION_DRAFT_EXPIRY_MS = 15 * 60 * 1000;

type BusinessSummary = {
  id: string;
  name: string;
  timezone: string;
  gstRegistered: boolean;
};

type DraftPreparation = {
  content: string;
  actionDraft?: ToriActionDraft;
  context?: ToriContext;
};

type CustomerDraftSlots = Partial<CustomerPayload>;

type JobDraftSlots = {
  customerName?: string;
  customerId?: string;
  title?: string;
  description?: string;
  addressLine1?: string;
  suburb?: string;
  state?: AustralianState;
  postcode?: string;
};

type AppointmentDateTimeParts = {
  date?: string;
  time?: string;
};

type CustomerMatch = {
  id: string;
  displayName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  contactPreference: string;
  sites: Array<{
    id: string;
    label: string;
    addressLine1: string;
    addressLine2: string | null;
    suburb: string;
    state: string;
    postcode: string;
    accessInstructions: string | null;
    isPrimary: boolean;
  }>;
};

type AppointmentWithContext = Prisma.AppointmentGetPayload<{
  include: {
    assignedUser: true;
    job: { include: { customer: true } };
  };
}>;

@Injectable()
export class AiService {
  private readonly completedDraftIds = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: AiProvider,
    private readonly appointments: AppointmentsService,
    private readonly communications: CustomerCommunicationsService,
    private readonly customers: CustomersService,
    private readonly jobs: JobsService,
    private readonly quotes: QuotesService,
    private readonly invoices: InvoicesService,
  ) {}

  async summary(currentUser: AuthenticatedUser) {
    this.assertToriAccess(currentUser);
    const business = await this.business(currentUser.businessId);
    const snapshot = await this.snapshot(currentUser, business);
    return {
      provider: this.provider.status(),
      snapshot,
      suggestedPrompts: this.suggestedPrompts(currentUser.role),
    };
  }

  async chat(
    currentUser: AuthenticatedUser,
    request: ToriChatRequest,
  ): Promise<ToriChatResponse> {
    this.assertToriAccess(currentUser);
    const business = await this.business(currentUser.businessId);
    const snapshot = await this.snapshot(currentUser, business);
    const text = request.message.trim();
    const lower = text.toLowerCase();

    let content: string;
    let actionDraft: ToriActionDraft | undefined;
    let responseContext: ToriContext | undefined = request.context;

    if (!text) {
      content = 'Ask me about your work, money, quotes, or scheduling.';
    } else if (this.isCancelCommand(lower)) {
      content =
        'Okay, I cancelled that Tori workflow. No TradieOS data changed.';
      responseContext = this.clearPendingContext(request.context);
    } else if (
      this.isNegativeConfirmation(lower) &&
      request.context?.pendingQuestion?.intent === 'CREATE_APPOINTMENT_FOR_JOB'
    ) {
      content =
        'Okay. The customer and job remain created. No appointment was created.';
      responseContext = this.clearPendingContext(request.context);
    } else if (
      this.isPositiveConfirmation(lower) &&
      request.context?.pendingQuestion?.intent === 'CREATE_APPOINTMENT_FOR_JOB'
    ) {
      ({
        content,
        actionDraft,
        context: responseContext,
      } = await this.beginAppointmentFromContext(
        currentUser,
        text,
        request.context,
      ));
    } else if (request.context?.pendingAppointment) {
      ({
        content,
        actionDraft,
        context: responseContext,
      } = await this.continueAppointmentDraft(
        currentUser,
        business,
        text,
        request.context,
      ));
    } else if (this.looksLikeCustomerMessage(lower)) {
      ({ content, actionDraft } = await this.prepareMessageDraft(
        currentUser,
        business,
        text,
        request.context,
      ));
    } else if (this.looksLikeCreateAppointment(lower)) {
      ({
        content,
        actionDraft,
        context: responseContext,
      } = await this.prepareAppointmentDraft(
        currentUser,
        business,
        text,
        request.context,
      ));
    } else if (
      this.hasPendingWorkflow(request) &&
      this.looksLikeReadQuestion(lower)
    ) {
      content = await this.answerReadQuestion(currentUser, business, text);
      responseContext = this.clearPendingContext(request.context);
    } else if (this.looksLikeExplicitCreateCustomerAndJob(lower)) {
      ({
        content,
        actionDraft,
        context: responseContext,
      } = await this.prepareCustomerAndJobDraft(
        currentUser,
        business,
        text,
        request,
      ));
    } else if (this.looksLikeExplicitCreateCustomer(lower)) {
      ({
        content,
        actionDraft,
        context: responseContext,
      } = await this.prepareCustomerDraft(currentUser, text, request));
    } else if (this.looksLikeExplicitCreateJob(lower)) {
      ({
        content,
        actionDraft,
        context: responseContext,
      } = await this.prepareJobDraft(currentUser, business, text, request));
    } else if (request.context?.pendingCustomerAndJob) {
      if (this.isUnsupportedSlotInput(lower)) {
        content =
          "I can't use that as job or customer details. Would you like to continue or cancel?";
        responseContext = request.context;
      } else {
        ({
          content,
          actionDraft,
          context: responseContext,
        } = await this.prepareCustomerAndJobDraft(
          currentUser,
          business,
          text,
          request,
        ));
      }
    } else if (request.context?.pendingCustomer) {
      if (this.isUnsupportedSlotInput(lower)) {
        content =
          "I can't use that as customer details. Would you like to continue or cancel?";
        responseContext = request.context;
      } else {
        ({
          content,
          actionDraft,
          context: responseContext,
        } = await this.prepareCustomerDraft(currentUser, text, request));
      }
    } else if (this.looksLikePendingCustomerAndJob(request)) {
      if (this.isUnsupportedSlotInput(lower)) {
        content =
          "I can't help with ordering food. We were preparing a job. Would you like to continue or cancel?";
      } else {
        ({
          content,
          actionDraft,
          context: responseContext,
        } = await this.prepareCustomerAndJobDraft(
          currentUser,
          business,
          text,
          request,
        ));
      }
    } else if (this.looksLikePendingCustomer(request)) {
      if (this.isUnsupportedSlotInput(lower)) {
        content =
          "I can't use that as customer details. Would you like to continue the customer draft or cancel?";
      } else {
        ({
          content,
          actionDraft,
          context: responseContext,
        } = await this.prepareCustomerDraft(currentUser, text, request));
      }
    } else if (this.looksLikePendingJob(request)) {
      if (this.isUnsupportedSlotInput(lower)) {
        content =
          "I can't use that as job details. Would you like to continue the job draft or cancel?";
      } else {
        ({
          content,
          actionDraft,
          context: responseContext,
        } = await this.prepareJobDraft(currentUser, business, text, request));
      }
    } else if (this.looksLikeCreateCustomerAndJob(lower, request)) {
      ({
        content,
        actionDraft,
        context: responseContext,
      } = await this.prepareCustomerAndJobDraft(
        currentUser,
        business,
        text,
        request,
      ));
    } else if (this.looksLikeCreateCustomer(lower, request)) {
      ({
        content,
        actionDraft,
        context: responseContext,
      } = await this.prepareCustomerDraft(currentUser, text, request));
    } else if (this.looksLikeCreateJob(lower, request)) {
      ({
        content,
        actionDraft,
        context: responseContext,
      } = await this.prepareJobDraft(currentUser, business, text, request));
    } else if (this.looksLikeCreateQuote(lower)) {
      ({ content, actionDraft } = await this.prepareQuoteDraft(
        currentUser,
        business,
        text,
        request.context,
      ));
    } else if (this.looksLikeCreateInvoice(lower)) {
      ({ content, actionDraft } = await this.prepareInvoiceDraft(
        currentUser,
        business,
        text,
        request.context,
      ));
    } else if (this.looksLikeReassign(lower)) {
      ({ content, actionDraft } = await this.prepareReassignDraft(
        currentUser,
        business,
        text,
        request.context,
      ));
    } else if (this.looksLikeReschedule(lower)) {
      ({ content, actionDraft } = await this.prepareRescheduleDraft(
        currentUser,
        business,
        text,
        request.context,
      ));
    } else if (this.looksLikeReadQuestion(lower)) {
      content = await this.answerReadQuestion(currentUser, business, text);
      responseContext = this.clearPendingContext(request.context);
    } else {
      content = this.unsupportedIntentMessage();
    }

    return {
      message: {
        actionDraft,
        content,
        createdAt: new Date().toISOString(),
        id: randomUUID(),
        role: 'assistant',
      },
      provider: this.provider.status(),
      snapshot,
      suggestedPrompts: this.suggestedPrompts(currentUser.role),
      ...(responseContext ? { context: responseContext } : {}),
    };
  }

  async confirm(
    currentUser: AuthenticatedUser,
    draftId: string,
    draft: ToriActionDraft,
  ): Promise<ToriActionConfirmResponse> {
    this.assertToriAccess(currentUser);
    if (draft.id !== draftId) {
      throw this.domainError(
        'TORI_DRAFT_MISMATCH',
        'This Tori action draft could not be matched. Please ask Tori again.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (new Date(draft.expiresAt).getTime() < Date.now()) {
      throw this.domainError(
        'TORI_DRAFT_EXPIRED',
        'This Tori action draft expired. Please ask Tori to prepare it again.',
        HttpStatus.CONFLICT,
      );
    }
    if (!roleCanConfirmToriAction(currentUser.role, draft.type)) {
      throw new ForbiddenException(
        "You don't have permission to confirm this Tori action.",
      );
    }
    if (this.completedDraftIds.has(draftId)) {
      throw this.domainError(
        'TORI_DRAFT_ALREADY_CONFIRMED',
        'This Tori action draft has already been completed. Please ask Tori to prepare a new one if you need another action.',
        HttpStatus.CONFLICT,
      );
    }

    let result: ToriActionConfirmResponse;
    switch (draft.payload.type) {
      case 'RESCHEDULE_APPOINTMENT':
        result = await this.confirmReschedule(currentUser, draft.payload);
        break;
      case 'REASSIGN_TECHNICIAN':
        result = await this.confirmReassign(currentUser, draft.payload);
        break;
      case 'CANCEL_APPOINTMENT':
        result = await this.confirmCancelAppointment(
          currentUser,
          draft.payload,
        );
        break;
      case 'CREATE_APPOINTMENT':
        result = await this.confirmCreateAppointment(
          currentUser,
          draft.payload,
        );
        break;
      case 'CREATE_QUOTE':
        result = await this.confirmCreateQuote(currentUser, draft.payload);
        break;
      case 'CREATE_INVOICE':
        result = await this.confirmCreateInvoice(currentUser, draft.payload);
        break;
      case 'SEND_CUSTOMER_MESSAGE':
        result = await this.confirmSendMessage(currentUser, draft.payload);
        break;
      case 'CREATE_CUSTOMER':
        result = await this.confirmCreateCustomer(currentUser, draft.payload);
        break;
      case 'CREATE_JOB':
        result = await this.confirmCreateJob(currentUser, draft.payload);
        break;
      case 'CREATE_CUSTOMER_AND_JOB':
        result = await this.confirmCreateCustomerAndJob(
          currentUser,
          draft.payload,
        );
        break;
    }
    this.completedDraftIds.add(draftId);
    return result;
  }

  private async confirmReschedule(
    currentUser: AuthenticatedUser,
    payload: Extract<ToriActionPayload, { type: 'RESCHEDULE_APPOINTMENT' }>,
  ): Promise<ToriActionConfirmResponse> {
    await this.assertAppointmentFresh(
      currentUser,
      payload.appointmentId,
      payload.expectedUpdatedAt,
    );
    const result = await this.appointments.update(
      currentUser,
      payload.appointmentId,
      payload.appointmentPayload,
    );
    return {
      details: [
        { label: 'Appointment', value: result.appointment.appointmentNumber },
        {
          label: 'New time',
          value: formatBusinessDateTime(
            result.appointment.scheduledStart,
            await this.businessTimezone(currentUser.businessId),
          ),
        },
      ],
      entityId: result.appointment.id,
      entityType: 'APPOINTMENT',
      message: 'Appointment rescheduled.',
      status: 'COMPLETED',
    } satisfies ToriActionConfirmResponse;
  }

  private async confirmReassign(
    currentUser: AuthenticatedUser,
    payload: Extract<ToriActionPayload, { type: 'REASSIGN_TECHNICIAN' }>,
  ): Promise<ToriActionConfirmResponse> {
    await this.assertAppointmentFresh(
      currentUser,
      payload.appointmentId,
      payload.expectedUpdatedAt,
    );
    const result = await this.appointments.reassign(
      currentUser,
      payload.appointmentId,
      payload.reassignmentPayload,
    );
    return {
      details: [
        { label: 'Appointment', value: result.appointment.appointmentNumber },
        {
          label: 'Technician',
          value: this.userLabel(result.appointment.assignedUser),
        },
      ],
      entityId: result.appointment.id,
      entityType: 'APPOINTMENT',
      message: 'Appointment reassigned.',
      status: 'COMPLETED',
    };
  }

  private async confirmCancelAppointment(
    currentUser: AuthenticatedUser,
    payload: Extract<ToriActionPayload, { type: 'CANCEL_APPOINTMENT' }>,
  ): Promise<ToriActionConfirmResponse> {
    await this.assertAppointmentFresh(
      currentUser,
      payload.appointmentId,
      payload.expectedUpdatedAt,
    );
    const result = await this.appointments.transition(
      currentUser,
      payload.appointmentId,
      'CANCELLED',
    );
    return {
      details: [
        { label: 'Appointment', value: result.appointment.appointmentNumber },
        { label: 'Status', value: result.appointment.status },
      ],
      entityId: result.appointment.id,
      entityType: 'APPOINTMENT',
      message: 'Appointment cancelled.',
      status: 'COMPLETED',
    };
  }

  private async confirmCreateAppointment(
    currentUser: AuthenticatedUser,
    payload: Extract<ToriActionPayload, { type: 'CREATE_APPOINTMENT' }>,
  ): Promise<ToriActionConfirmResponse> {
    const result = await this.appointments.create(
      currentUser,
      payload.appointmentPayload,
    );
    return {
      details: [
        { label: 'Appointment', value: result.appointment.appointmentNumber },
        {
          label: 'Time',
          value: formatBusinessDateTime(
            result.appointment.scheduledStart,
            await this.businessTimezone(currentUser.businessId),
          ),
        },
      ],
      entityId: result.appointment.id,
      entityType: 'APPOINTMENT',
      message: 'Appointment created.',
      context: {
        appointmentId: result.appointment.id,
        jobId: result.appointment.jobId,
      },
      status: 'COMPLETED',
    };
  }

  private async confirmCreateQuote(
    currentUser: AuthenticatedUser,
    payload: Extract<ToriActionPayload, { type: 'CREATE_QUOTE' }>,
  ): Promise<ToriActionConfirmResponse> {
    const result = await this.quotes.create(
      currentUser,
      payload.quotePayload as UpsertQuoteDto,
    );
    return {
      details: [
        { label: 'Quote', value: result.quote.quoteNumber },
        { label: 'Status', value: result.quote.status },
        { label: 'Total', value: formatAudCents(result.quote.totalCents) },
      ],
      entityId: result.quote.id,
      entityType: 'QUOTE',
      message: 'Draft quote created. It has not been sent.',
      status: 'COMPLETED',
    };
  }

  private async confirmCreateInvoice(
    currentUser: AuthenticatedUser,
    payload: Extract<ToriActionPayload, { type: 'CREATE_INVOICE' }>,
  ): Promise<ToriActionConfirmResponse> {
    const result = await this.invoices.create(
      currentUser,
      payload.invoicePayload as UpsertInvoiceDto,
    );
    return {
      details: [
        { label: 'Invoice', value: result.invoice.invoiceNumber },
        { label: 'Status', value: result.invoice.status },
        { label: 'Total', value: formatAudCents(result.invoice.totalCents) },
      ],
      entityId: result.invoice.id,
      entityType: 'INVOICE',
      message: 'Draft invoice created. It has not been sent.',
      status: 'COMPLETED',
    };
  }

  private async confirmSendMessage(
    currentUser: AuthenticatedUser,
    payload: Extract<ToriActionPayload, { type: 'SEND_CUSTOMER_MESSAGE' }>,
  ): Promise<ToriActionConfirmResponse> {
    const result = await this.communications.sendManual(
      currentUser,
      payload.communicationPayload,
    );
    return {
      details: [
        { label: 'Channel', value: result.communication.channel },
        { label: 'Status', value: result.communication.status },
      ],
      entityId: result.communication.id,
      entityType: 'COMMUNICATION',
      message: 'Customer message recorded through communications.',
      status: 'COMPLETED',
    };
  }

  private async confirmCreateCustomer(
    currentUser: AuthenticatedUser,
    payload: Extract<ToriActionPayload, { type: 'CREATE_CUSTOMER' }>,
  ): Promise<ToriActionConfirmResponse> {
    const result = await this.customers.create(
      currentUser,
      payload.customerPayload,
    );
    return {
      details: [
        { label: 'Customer', value: result.customer.displayName },
        { label: 'Phone', value: result.customer.phone ?? 'Not provided' },
      ],
      entityId: result.customer.id,
      entityType: 'CUSTOMER',
      message: 'Customer created.',
      context: {
        customerId: result.customer.id,
        customerName: result.customer.displayName,
      },
      status: 'COMPLETED',
    };
  }

  private async confirmCreateJob(
    currentUser: AuthenticatedUser,
    payload: Extract<ToriActionPayload, { type: 'CREATE_JOB' }>,
  ): Promise<ToriActionConfirmResponse> {
    const result = await this.jobs.create(currentUser, payload.jobPayload);
    return {
      details: [
        { label: 'Job', value: result.job.jobNumber },
        { label: 'Customer', value: result.job.customer.displayName },
        { label: 'Title', value: result.job.title },
      ],
      entityId: result.job.id,
      entityType: 'JOB',
      message:
        'Job created. No appointment was created. Would you like me to prepare an appointment?',
      context: this.jobAppointmentOfferContext(result.job),
      status: 'COMPLETED',
    };
  }

  private async confirmCreateCustomerAndJob(
    currentUser: AuthenticatedUser,
    payload: Extract<ToriActionPayload, { type: 'CREATE_CUSTOMER_AND_JOB' }>,
  ): Promise<ToriActionConfirmResponse> {
    const result = await this.jobs.create(currentUser, payload.jobPayload);
    return {
      details: [
        { label: 'Customer', value: result.job.customer.displayName },
        { label: 'Job', value: result.job.jobNumber },
        { label: 'Title', value: result.job.title },
      ],
      entityId: result.job.id,
      entityType: 'JOB',
      message:
        'Customer and job created. No appointment was created. Would you like me to prepare an appointment?',
      context: this.jobAppointmentOfferContext(result.job),
      status: 'COMPLETED',
    };
  }

  private jobAppointmentOfferContext(job: {
    id: string;
    jobNumber?: string;
    title: string;
    customerId?: string;
    customer?: { id?: string; displayName?: string };
    addressLine1: string;
    suburb: string;
    state: string;
    postcode: string;
  }): ToriContext {
    return {
      customerId: job.customer?.id ?? job.customerId,
      customerName: job.customer?.displayName,
      jobId: job.id,
      jobNumber: job.jobNumber,
      jobTitle: job.title,
      pendingQuestion: {
        intent: 'CREATE_APPOINTMENT_FOR_JOB',
        type: 'YES_NO',
      },
      serviceLocation: {
        addressLine1: job.addressLine1,
        postcode: job.postcode,
        state: job.state,
        suburb: job.suburb,
      },
    };
  }

  private async answerReadQuestion(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    text: string,
  ) {
    const lower = text.toLowerCase();
    if (this.isFinancialQuestion(lower)) {
      this.assertRole(currentUser, ACCOUNTS_RECEIVABLE_VIEW_ROLES);
      return this.answerMoneyQuestion(currentUser, business, lower);
    }
    if (lower.includes('follow up') || lower.includes('follow-up')) {
      return this.answerFollowUps(currentUser, business);
    }
    if (lower.includes('quote')) {
      this.assertRole(currentUser, QUOTE_VIEW_ROLES);
      return this.answerQuoteQuestion(currentUser, business, lower);
    }
    if (lower.includes('job') && lower.includes('progress')) {
      this.assertRole(currentUser, JOB_VIEW_ROLES);
      return this.answerJobsInProgress(currentUser);
    }
    return this.answerScheduleQuestion(currentUser, business, lower);
  }

  private async answerScheduleQuestion(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    lower: string,
  ) {
    this.assertRole(currentUser, APPOINTMENT_VIEW_ROLES);
    const day = lower.includes('tomorrow') ? 1 : 0;
    const technician = await this.findTechnicianMention(
      currentUser.businessId,
      lower,
    );
    const range = this.dayRangeFromOffset(business.timezone, day);
    const where: Record<string, unknown> = {
      businessId: currentUser.businessId,
      scheduledStart: lower.includes('unassigned')
        ? this.unassignedAppointmentStartFilter(business)
        : { gte: range.start, lt: range.end },
      status: { notIn: [...CLOSED_APPOINTMENT_STATUSES] },
    };
    if (currentUser.role === 'TECHNICIAN')
      where.assignedUserId = currentUser.id;
    if (technician) where.assignedUserId = technician.id;
    if (lower.includes('unassigned')) where.assignedUserId = null;

    const appointments = await this.prisma.appointment.findMany({
      where,
      include: this.appointmentListInclude(),
      orderBy: { scheduledStart: 'asc' },
      take: 20,
    });

    if (!appointments.length) {
      if (lower.includes('unassigned')) {
        return "I couldn't find any unassigned appointments in that window.";
      }
      const who = technician ? `${this.userLabel(technician)} ` : '';
      return `I couldn't find ${who}appointments for ${day ? 'tomorrow' : 'today'}.`;
    }

    const heading = lower.includes('unassigned')
      ? 'Upcoming unassigned appointments'
      : technician
        ? `${this.userLabel(technician)} ${day ? 'tomorrow' : 'today'}`
        : `Appointments ${day ? 'tomorrow' : 'today'}`;
    return [
      `${heading}: ${appointments.length}.`,
      ...appointments
        .slice(0, 6)
        .map((appointment) =>
          [
            formatBusinessTimeRange(
              appointment.scheduledStart,
              appointment.scheduledEnd,
              business.timezone,
            ),
            appointment.job.customer.displayName,
            appointment.job.title,
            this.userLabel(appointment.assignedUser),
          ]
            .filter(Boolean)
            .join(' · '),
        ),
    ].join('\n');
  }

  private async answerMoneyQuestion(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    lower: string,
  ) {
    this.assertRole(currentUser, INVOICE_VIEW_ROLES);
    const todayStart = getBusinessDayRangeUtc(
      new Date(),
      business.timezone,
    ).start;
    const where = {
      balanceDueCents: { gt: 0 },
      businessId: currentUser.businessId,
      status: { in: [...INVOICE_OPEN_STATUSES] },
    };
    const [outstanding, overdue, invoices] = await Promise.all([
      this.prisma.invoice.aggregate({
        _count: { _all: true },
        _sum: { balanceDueCents: true },
        where,
      }),
      this.prisma.invoice.aggregate({
        _count: { _all: true },
        _sum: { balanceDueCents: true },
        where: { ...where, dueDate: { lt: todayStart } },
      }),
      this.prisma.invoice.findMany({
        where: lower.includes('overdue')
          ? { ...where, dueDate: { lt: todayStart } }
          : where,
        include: { customer: true },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        take: 5,
      }),
    ]);
    const total = outstanding._sum.balanceDueCents ?? 0;
    const overdueTotal = overdue._sum.balanceDueCents ?? 0;
    const lines = invoices.map(
      (invoice) =>
        `${invoice.invoiceNumber} · ${invoice.customer.displayName} · ${formatAudCents(invoice.balanceDueCents)} due ${formatBusinessDate(invoice.dueDate, business.timezone)}`,
    );
    return [
      `Outstanding invoices: ${formatAudCents(total)} across ${outstanding._count._all}.`,
      `Overdue: ${formatAudCents(overdueTotal)} across ${overdue._count._all}.`,
      ...lines,
    ].join('\n');
  }

  private async answerQuoteQuestion(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    lower: string,
  ) {
    const quotes = await this.prisma.quote.findMany({
      where: {
        businessId: currentUser.businessId,
        status: { in: ['SENT', 'VIEWED'] },
      },
      include: { customer: true },
      orderBy: [{ sentAt: 'asc' }, { updatedAt: 'asc' }],
      take: 8,
    });
    if (!quotes.length) {
      return "I couldn't find quotes currently waiting for customer response.";
    }
    const prefix = lower.includes('follow')
      ? 'Quotes to follow up'
      : 'Quotes waiting for customer response';
    return [
      `${prefix}: ${quotes.length}.`,
      ...quotes.map(
        (quote) =>
          `${quote.quoteNumber} · ${quote.customer.displayName} · ${formatAudCents(quote.totalCents)} · ${quote.status}`,
      ),
    ].join('\n');
  }

  private async answerJobsInProgress(currentUser: AuthenticatedUser) {
    const jobs = await this.prisma.job.findMany({
      where: {
        businessId: currentUser.businessId,
        isArchived: false,
        status: 'IN_PROGRESS',
        ...(currentUser.role === 'TECHNICIAN'
          ? { assignedToUserId: currentUser.id }
          : {}),
      },
      include: { customer: true, assignedTo: true },
      orderBy: { updatedAt: 'desc' },
      take: 8,
    });
    if (!jobs.length) return "I couldn't find any jobs currently in progress.";
    return [
      `Jobs in progress: ${jobs.length}.`,
      ...jobs.map(
        (job) =>
          `${job.jobNumber} · ${job.title} · ${job.customer.displayName} · ${this.userLabel(job.assignedTo)}`,
      ),
    ].join('\n');
  }

  private async answerFollowUps(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
  ) {
    const canSeeInvoices = INVOICE_VIEW_ROLES.includes(currentUser.role);
    const canSeeQuotes = QUOTE_VIEW_ROLES.includes(currentUser.role);
    const canSeeAppointments = APPOINTMENT_VIEW_ROLES.includes(
      currentUser.role,
    );
    const today = getBusinessDayRangeUtc(new Date(), business.timezone);
    const [unassigned, overdue, quotes] = await Promise.all([
      canSeeAppointments && currentUser.role !== 'TECHNICIAN'
        ? this.prisma.appointment.findMany({
            where: {
              assignedUserId: null,
              businessId: currentUser.businessId,
              scheduledStart: { gte: today.start },
              status: { notIn: [...CLOSED_APPOINTMENT_STATUSES] },
            },
            include: this.appointmentListInclude(),
            orderBy: { scheduledStart: 'asc' },
            take: 3,
          })
        : Promise.resolve([]),
      canSeeInvoices
        ? this.prisma.invoice.findMany({
            where: {
              balanceDueCents: { gt: 0 },
              businessId: currentUser.businessId,
              dueDate: { lt: today.start },
              status: { in: [...INVOICE_OPEN_STATUSES] },
            },
            include: { customer: true },
            orderBy: { dueDate: 'asc' },
            take: 3,
          })
        : Promise.resolve([]),
      canSeeQuotes
        ? this.prisma.quote.findMany({
            where: {
              businessId: currentUser.businessId,
              status: { in: ['SENT', 'VIEWED'] },
            },
            include: { customer: true },
            orderBy: [{ sentAt: 'asc' }, { updatedAt: 'asc' }],
            take: 3,
          })
        : Promise.resolve([]),
    ]);
    const lines = [
      ...unassigned.map(
        (appointment) =>
          `Assign ${appointment.appointmentNumber} · ${appointment.job.customer.displayName} · ${formatBusinessDateTime(appointment.scheduledStart, business.timezone)}`,
      ),
      ...overdue.map(
        (invoice) =>
          `Follow up ${invoice.invoiceNumber} · ${invoice.customer.displayName} · ${formatAudCents(invoice.balanceDueCents)} overdue`,
      ),
      ...quotes.map(
        (quote) =>
          `Follow up ${quote.quoteNumber} · ${quote.customer.displayName} · ${formatAudCents(quote.totalCents)} awaiting response`,
      ),
    ];
    if (!lines.length) {
      return "I couldn't find urgent follow-ups for your current role today.";
    }
    return [`Follow-ups for today: ${lines.length}.`, ...lines].join('\n');
  }

  private async prepareRescheduleDraft(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    text: string,
    context?: ToriContext,
  ) {
    this.assertRole(currentUser, APPOINTMENT_WRITE_ROLES);
    const appointment = await this.resolveAppointment(
      currentUser,
      business,
      text,
      context,
    );
    if (!appointment) {
      return {
        content:
          "I couldn't identify the appointment to reschedule. Which appointment should I move?",
      };
    }
    const targetTime = this.parseTargetDateTime(text, business.timezone);
    if (!targetTime) {
      return {
        content:
          'What date and time should I move this appointment to? For example: tomorrow at 4pm.',
      };
    }
    const duration =
      appointment.estimatedDurationMinutes ??
      Math.max(
        30,
        Math.round(
          (appointment.scheduledEnd.getTime() -
            appointment.scheduledStart.getTime()) /
            60_000,
        ),
      );
    const proposedEnd = new Date(targetTime.getTime() + duration * 60_000);
    const appointmentPayload = this.toAppointmentPayload(
      appointment,
      targetTime,
      proposedEnd,
    );
    const availability = appointment.assignedUserId
      ? await this.appointments.availability(currentUser, {
          assignedUserId: appointment.assignedUserId,
          excludeAppointmentId: appointment.id,
          scheduledEnd: proposedEnd.toISOString(),
          scheduledStart: targetTime.toISOString(),
        })
      : null;
    if (availability?.hasConflict && availability.canOverride) {
      appointmentPayload.allowConflictOverride = true;
    }
    const hasBlockingConflict = Boolean(
      availability?.hasConflict && !availability.canOverride,
    );
    const warnings =
      availability?.hasConflict && hasBlockingConflict
        ? [availability.reason]
        : availability?.hasConflict
          ? [`Conflict warning: ${availability.reason}`]
          : [];
    const draft = this.actionDraft({
      description: `Move ${appointment.job.customer.displayName}'s appointment to ${formatBusinessDateTime(targetTime, business.timezone)}.`,
      entityId: appointment.id,
      entityType: 'APPOINTMENT',
      payload: {
        appointmentId: appointment.id,
        appointmentPayload,
        expectedUpdatedAt: appointment.updatedAt.toISOString(),
        type: 'RESCHEDULE_APPOINTMENT',
      },
      proposedChanges: [
        {
          from: formatBusinessDateTime(
            appointment.scheduledStart,
            business.timezone,
          ),
          label: 'Time',
          to: `${formatBusinessDate(targetTime, business.timezone)} ${formatBusinessTimeRange(targetTime, proposedEnd, business.timezone)}`,
        },
      ],
      title: 'Reschedule appointment',
      validationState: hasBlockingConflict ? 'CONFLICT' : 'READY',
      warnings,
    });
    return {
      actionDraft: draft,
      content:
        'I prepared a reschedule draft. Nothing has changed yet—confirm it if this looks right.',
    };
  }

  private async prepareReassignDraft(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    text: string,
    context?: ToriContext,
  ) {
    this.assertRole(currentUser, APPOINTMENT_WRITE_ROLES);
    const appointment = await this.resolveAppointment(
      currentUser,
      business,
      text,
      context,
    );
    if (!appointment) {
      return {
        content:
          "I couldn't identify the appointment to reassign. Which appointment should I use?",
      };
    }
    const technician = await this.findTechnicianMention(
      currentUser.businessId,
      text.toLowerCase(),
    );
    if (!technician) {
      return {
        content: 'Which technician should I assign this appointment to?',
      };
    }
    const availability = await this.appointments.availability(currentUser, {
      assignedUserId: technician.id,
      excludeAppointmentId: appointment.id,
      scheduledEnd: appointment.scheduledEnd.toISOString(),
      scheduledStart: appointment.scheduledStart.toISOString(),
    });
    const warnings = availability.hasConflict ? [availability.reason] : [];
    const draft = this.actionDraft({
      description: `Assign ${appointment.job.customer.displayName}'s appointment to ${this.userLabel(technician)}.`,
      entityId: appointment.id,
      entityType: 'APPOINTMENT',
      payload: {
        appointmentId: appointment.id,
        expectedUpdatedAt: appointment.updatedAt.toISOString(),
        reassignmentPayload: {
          assignedUserId: technician.id,
          reason: 'Prepared by Tori',
        },
        type: 'REASSIGN_TECHNICIAN',
      },
      proposedChanges: [
        {
          from: this.userLabel(appointment.assignedUser),
          label: 'Technician',
          to: this.userLabel(technician),
        },
      ],
      title: 'Reassign technician',
      validationState: warnings.length ? 'CONFLICT' : 'READY',
      warnings,
    });
    return {
      actionDraft: draft,
      content:
        'I prepared a reassignment draft. Nothing has changed yet—confirm it if this looks right.',
    };
  }

  private async beginAppointmentFromContext(
    currentUser: AuthenticatedUser,
    _text: string,
    context: ToriContext,
  ): Promise<DraftPreparation> {
    this.assertRole(currentUser, APPOINTMENT_WRITE_ROLES);
    const pending = this.appointmentPendingFromContext(context);
    const job = await this.loadAppointmentJob(
      currentUser.businessId,
      pending.jobId,
    );
    if (!job) {
      return {
        content:
          'I could not find that job anymore. Please open the job and ask Tori to schedule it again.',
        context: this.clearPendingContext(context),
      };
    }
    return {
      content: `What date would you like the appointment for ${job.customer.displayName}'s "${job.title}" job?`,
      context: {
        ...this.clearPendingContext(context),
        customerId: job.customerId,
        customerName: job.customer.displayName,
        jobId: job.id,
        jobNumber: job.jobNumber,
        jobTitle: job.title,
        pendingAppointment: this.pendingAppointmentFromJob(job),
        pendingQuestion: {
          intent: 'CREATE_APPOINTMENT_FOR_JOB',
          type: 'APPOINTMENT_DATE',
        },
        serviceLocation: this.jobServiceLocation(job),
      },
    };
  }

  private async continueAppointmentDraft(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    text: string,
    context: ToriContext,
  ): Promise<DraftPreparation> {
    this.assertRole(currentUser, APPOINTMENT_WRITE_ROLES);
    const pending = context.pendingAppointment;
    if (!pending) {
      return { content: 'What appointment should I prepare?' };
    }
    const job = await this.loadAppointmentJob(
      currentUser.businessId,
      pending.jobId,
    );
    if (!job) {
      return {
        content:
          'I could not find that job anymore. Please open the job and ask Tori to schedule it again.',
        context: this.clearPendingContext(context),
      };
    }

    const questionType = context.pendingQuestion?.type;
    if (!pending.date || questionType === 'APPOINTMENT_DATE') {
      const dateTime = this.parseAppointmentDateTimeParts(
        text,
        business.timezone,
      );
      const date = dateTime.date;
      if (!date) {
        return {
          content:
            'I need a date for the appointment, for example today, tomorrow, or 18/08/2026.',
          context,
        };
      }
      if (dateTime.time) {
        const nextContext: ToriContext = {
          ...context,
          pendingAppointment: {
            ...pending,
            date,
            time: dateTime.time,
          },
          pendingQuestion: {
            intent: 'CREATE_APPOINTMENT_FOR_JOB',
            type: 'APPOINTMENT_DURATION',
          },
        };
        const start = this.pendingAppointmentStartDate(
          nextContext.pendingAppointment,
          business.timezone,
        );
        return {
          content: start
            ? `Got it — ${formatBusinessDate(start, business.timezone)} at ${formatBusinessTime(start, business.timezone)}. How long should I allow for the appointment?`
            : 'Got it. How long should I allow for the appointment?',
          context: nextContext,
        };
      }
      return {
        content: 'What start time should I use?',
        context: {
          ...context,
          pendingAppointment: { ...pending, date },
          pendingQuestion: {
            intent: 'CREATE_APPOINTMENT_FOR_JOB',
            type: 'APPOINTMENT_TIME',
          },
        },
      };
    }

    if (!pending.time || questionType === 'APPOINTMENT_TIME') {
      const time = this.parseTimeString(text);
      if (!time) {
        return {
          content: 'What start time should I use? For example 10am or 14:30.',
          context,
        };
      }
      return {
        content: 'How long should I allow?',
        context: {
          ...context,
          pendingAppointment: {
            ...pending,
            time,
          },
          pendingQuestion: {
            intent: 'CREATE_APPOINTMENT_FOR_JOB',
            type: 'APPOINTMENT_DURATION',
          },
        },
      };
    }

    const duration = this.parseDurationMinutes(text);
    if (!duration || duration < 15 || duration > 12 * 60) {
      return {
        content:
          'How long should I allow? For example 30 minutes, 60 mins, or 2 hours.',
        context,
      };
    }

    return this.appointmentDraftFromPending(currentUser, business, {
      ...context,
      pendingAppointment: { ...pending, durationMinutes: duration },
    });
  }

  private async prepareAppointmentDraft(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    text: string,
    context?: ToriContext,
  ) {
    this.assertRole(currentUser, APPOINTMENT_WRITE_ROLES);
    if (context?.pendingAppointment) {
      return this.continueAppointmentDraft(
        currentUser,
        business,
        text,
        context,
      );
    }
    if (context?.jobId && !this.parseTargetDateTime(text, business.timezone)) {
      return this.beginAppointmentFromContext(currentUser, text, {
        ...context,
        pendingQuestion: {
          intent: 'CREATE_APPOINTMENT_FOR_JOB',
          type: 'YES_NO',
        },
      });
    }
    const targetTime = this.parseTargetDateTime(text, business.timezone);
    if (!targetTime) {
      if (context?.customerId) {
        const job = await this.prisma.job.findFirst({
          where: {
            businessId: currentUser.businessId,
            customerId: context.customerId,
            isArchived: false,
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
          },
          orderBy: { updatedAt: 'desc' },
        });
        if (job) {
          return this.beginAppointmentFromContext(currentUser, text, {
            ...context,
            jobId: job.id,
            jobNumber: job.jobNumber,
            jobTitle: job.title,
            serviceLocation: this.jobServiceLocation(job),
          });
        }
        return {
          content:
            'I need an existing job before I can prepare an appointment draft. Which job should I use?',
          context,
        };
      }
      return {
        content: 'What date and time should I book the appointment for?',
      };
    }
    const customer = await this.resolveCustomer(
      currentUser.businessId,
      text,
      context?.customerId,
    );
    if (!customer.match) return { content: customer.message };
    const job = context?.jobId
      ? await this.prisma.job.findFirst({
          where: { businessId: currentUser.businessId, id: context.jobId },
        })
      : await this.prisma.job.findFirst({
          where: {
            businessId: currentUser.businessId,
            customerId: customer.match.id,
            isArchived: false,
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
          },
          orderBy: { updatedAt: 'desc' },
        });
    if (!job) {
      return {
        content:
          'I found the customer, but I need an existing job before I can prepare an appointment draft.',
      };
    }
    const technician = await this.findTechnicianMention(
      currentUser.businessId,
      text.toLowerCase(),
    );
    const duration = this.parseDurationMinutes(text) ?? 60;
    const end = new Date(targetTime.getTime() + duration * 60_000);
    const site = customer.match.sites.find((item) => item.isPrimary) ?? null;
    const draft = this.actionDraft({
      description: `Book ${customer.match.displayName} for ${formatBusinessDateTime(targetTime, business.timezone)}.`,
      entityId: null,
      entityType: 'APPOINTMENT',
      payload: {
        appointmentPayload: {
          accessInstructions: site?.accessInstructions ?? undefined,
          addressLine1: site?.addressLine1 ?? job.addressLine1,
          addressLine2: site?.addressLine2 ?? job.addressLine2 ?? undefined,
          appointmentType: 'INSPECTION',
          assignedUserId: technician?.id ?? null,
          customerSiteId: site?.id ?? null,
          estimatedDurationMinutes: duration,
          jobId: job.id,
          locationSource: site ? 'CUSTOMER_SITE' : 'CUSTOMER_DEFAULT',
          notes: 'Prepared by Tori. Review before saving.',
          postcode: site?.postcode ?? job.postcode,
          scheduledEnd: end.toISOString(),
          scheduledStart: targetTime.toISOString(),
          state: (site?.state ?? job.state) as AppointmentPayload['state'],
          suburb: site?.suburb ?? job.suburb,
        },
        type: 'CREATE_APPOINTMENT',
      },
      proposedChanges: [
        { label: 'Customer', to: customer.match.displayName },
        { label: 'Job', to: job.title },
        {
          label: 'Time',
          to: `${formatBusinessDate(targetTime, business.timezone)} ${formatBusinessTimeRange(targetTime, end, business.timezone)}`,
        },
        {
          label: 'Technician',
          to: technician ? this.userLabel(technician) : 'Unassigned',
        },
      ],
      title: 'Create appointment',
      validationState: 'READY',
      warnings: technician
        ? []
        : ['No technician was mentioned. The appointment will be unassigned.'],
    });
    return {
      actionDraft: draft,
      content:
        'I prepared an appointment draft. Nothing has been booked yet—confirm it if it looks right.',
    };
  }

  private async prepareCustomerDraft(
    currentUser: AuthenticatedUser,
    text: string,
    request: ToriChatRequest,
  ): Promise<DraftPreparation> {
    this.assertRole(currentUser, CUSTOMER_WRITE_ROLES);
    const slots = this.mergeExpectedCustomerSlots(
      request.context?.pendingCustomer ?? {},
      this.customerSlots(text, request),
      text,
      request,
      'CREATE_CUSTOMER',
    );
    if (!slots.firstName && !slots.companyName) {
      return {
        content: "Sure. What is the customer's name?",
        context: {
          ...this.clearPendingContext(request.context),
          pendingCustomer: slots,
          pendingQuestion: {
            intent: 'CREATE_CUSTOMER',
            type: 'CUSTOMER_NAME',
          },
        },
      };
    }
    if (!slots.phone && !slots.email) {
      return {
        content: this.isExpectedCustomerContact(request, 'CREATE_CUSTOMER')
          ? "That doesn't look like a valid phone number or email. Please enter a phone number or email."
          : 'I can prepare that customer. What phone number or email should I use?',
        context: {
          ...this.clearPendingContext(request.context),
          pendingCustomer: slots,
          pendingQuestion: {
            intent: 'CREATE_CUSTOMER',
            type: 'CUSTOMER_CONTACT',
          },
        },
      };
    }

    const duplicateWarnings = await this.customerDuplicateWarnings(
      currentUser.businessId,
      slots,
    );
    const customerPayload: CustomerPayload = {
      ...slots,
      contactPreference: slots.email && !slots.phone ? 'EMAIL' : 'PHONE',
      customerType: slots.customerType ?? 'RESIDENTIAL',
    };
    const displayName = this.customerDisplayName(customerPayload);
    const draft = this.actionDraft({
      description: `Create customer ${displayName}.`,
      entityId: null,
      entityType: 'CUSTOMER',
      payload: { customerPayload, type: 'CREATE_CUSTOMER' },
      proposedChanges: [
        { label: 'Customer', to: displayName },
        { label: 'Phone', to: customerPayload.phone ?? 'Not provided' },
        { label: 'Email', to: customerPayload.email ?? 'Not provided' },
        {
          label: 'Address',
          to: this.addressLabel(customerPayload) || 'Not provided',
        },
        { label: 'Customer type', to: customerPayload.customerType },
      ],
      title: 'Create customer',
      validationState: duplicateWarnings.length ? 'CONFLICT' : 'READY',
      warnings: duplicateWarnings,
    });
    return {
      actionDraft: draft,
      content:
        'I prepared a customer draft. Nothing has been created yet—confirm it if it looks right.',
    };
  }

  private async prepareJobDraft(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    text: string,
    request: ToriChatRequest,
  ): Promise<DraftPreparation> {
    this.assertRole(currentUser, JOB_WRITE_ROLES);
    const slots = this.jobSlots(text, request);
    const customer = await this.resolveCustomerForJob(
      currentUser.businessId,
      slots.customerName,
      request.context?.customerId,
    );
    if (!customer.match) return { content: customer.message };
    const site = customer.match.sites.find((item) => item.isPrimary) ?? null;
    const address = this.jobAddressFromSlotsOrCustomer(slots, customer.match);
    if (!address) {
      return {
        content:
          'I found the customer. What service address should I use for this job?',
      };
    }
    const title = slots.title ?? this.extractJobTitle(text) ?? '';
    if (!title) {
      return { content: 'What should I call this job?' };
    }
    const scheduledStart = this.defaultJobStart(business.timezone);
    const jobPayload: JobPayload = {
      ...address,
      customerId: customer.match.id,
      customerNotes: 'Prepared by Tori. Review before scheduling.',
      description: slots.description ?? title,
      estimatedDurationMinutes: null,
      priority: 'NORMAL',
      requiresInvoice: false,
      requiresQuote: false,
      scheduledEnd: null,
      scheduledStart,
      status: 'NEW',
      title,
      tradeType: this.extractTradeType(text),
    };
    const draft = this.actionDraft({
      description: `Create a job for ${customer.match.displayName}.`,
      entityId: null,
      entityType: 'JOB',
      payload: { jobPayload, type: 'CREATE_JOB' },
      proposedChanges: [
        { label: 'Customer', to: customer.match.displayName },
        { label: 'Job', to: title },
        { label: 'Service location', to: this.addressLabel(address) },
        { label: 'Priority', to: 'NORMAL' },
        {
          label: 'Appointment',
          to: 'Not created. Tori can prepare one after this is confirmed.',
        },
        ...(site ? [{ label: 'Service site', to: site.label }] : []),
      ],
      title: 'Create job',
      validationState: 'READY',
      warnings: ['This creates a job only. It will not create an appointment.'],
    });
    return {
      actionDraft: draft,
      content:
        'I prepared a job draft. Nothing has been created yet—confirm it if it looks right.',
    };
  }

  private async prepareCustomerAndJobDraft(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    text: string,
    request: ToriChatRequest,
  ): Promise<DraftPreparation> {
    this.assertRole(currentUser, JOB_WRITE_ROLES);
    const pending = request.context?.pendingCustomerAndJob ?? {
      customer: {},
      job: {},
    };
    const customer = this.mergeExpectedCustomerSlots(
      pending.customer,
      this.customerSlots(text, request),
      text,
      request,
      'CREATE_CUSTOMER_AND_JOB',
    );
    const pendingJob: JobDraftSlots = {
      ...pending.job,
      state:
        pending.job.state && this.isAustralianState(pending.job.state)
          ? pending.job.state
          : undefined,
    };
    const job: JobDraftSlots = {
      ...pendingJob,
      ...this.jobSlots(text, request),
    };
    if (!customer.firstName && !customer.companyName) {
      return {
        content:
          "Sure. I can prepare the customer and job. What is the customer's name?",
        context: {
          ...this.clearPendingContext(request.context),
          pendingCustomerAndJob: { customer, job },
          pendingQuestion: {
            intent: 'CREATE_CUSTOMER_AND_JOB',
            type: 'CUSTOMER_NAME',
          },
        },
      };
    }
    if (!customer.phone) {
      return {
        content: this.isExpectedCustomerContact(
          request,
          'CREATE_CUSTOMER_AND_JOB',
        )
          ? "That doesn't look like a valid phone number. Please enter a phone number for the customer."
          : 'What phone number should I use for the customer?',
        context: {
          ...this.clearPendingContext(request.context),
          pendingCustomerAndJob: { customer, job },
          pendingQuestion: {
            intent: 'CREATE_CUSTOMER_AND_JOB',
            type: 'CUSTOMER_CONTACT',
          },
        },
      };
    }
    const address = this.jobAddressFromSlots(job);
    if (!address) {
      return {
        content: 'What is the service address for this job?',
        context: {
          ...this.clearPendingContext(request.context),
          pendingCustomerAndJob: { customer, job },
          pendingQuestion: {
            intent: 'CREATE_CUSTOMER_AND_JOB',
            type: 'JOB_ADDRESS',
          },
        },
      };
    }
    const title = job.title ?? this.extractJobTitle(text) ?? 'Fix leak';
    const displayName = this.customerDisplayName(customer);
    const duplicateWarnings = await this.customerDuplicateWarnings(
      currentUser.businessId,
      customer,
    );
    const quickCustomer = {
      ...address,
      name: displayName,
      phone: customer.phone,
    };
    const jobPayload: JobPayload & {
      quickCustomer: NonNullable<JobPayload['quickCustomer']>;
    } = {
      ...address,
      customerNotes: 'Prepared by Tori. Review before scheduling.',
      description: job.description ?? title,
      estimatedDurationMinutes: null,
      priority: 'NORMAL',
      quickCustomer,
      requiresInvoice: false,
      requiresQuote: false,
      scheduledEnd: null,
      scheduledStart: this.defaultJobStart(business.timezone),
      status: 'NEW',
      title,
      tradeType: this.extractTradeType(text),
    };
    const draft = this.actionDraft({
      description: `Create customer ${displayName} and a job for ${title}.`,
      entityId: null,
      entityType: 'JOB',
      payload: { jobPayload, type: 'CREATE_CUSTOMER_AND_JOB' },
      proposedChanges: [
        { label: 'Create customer', to: displayName },
        { label: 'Phone', to: customer.phone },
        { label: 'Create job', to: title },
        { label: 'Service location', to: this.addressLabel(address) },
        {
          label: 'Appointment',
          to: 'Not created. Tori can prepare one after this is confirmed.',
        },
      ],
      title: 'Create customer and job',
      validationState: duplicateWarnings.length ? 'CONFLICT' : 'READY',
      warnings: [
        ...duplicateWarnings,
        'This creates a customer and job only. It will not create an appointment.',
      ],
    });
    return {
      actionDraft: draft,
      content:
        'I prepared a combined customer and job draft. Nothing has been created yet—confirm it if it looks right.',
    };
  }

  private async prepareQuoteDraft(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    text: string,
    context?: ToriContext,
  ) {
    this.assertRole(currentUser, QUOTE_CREATE_ROLES);
    const customer = await this.resolveCustomer(
      currentUser.businessId,
      text,
      context?.customerId,
    );
    if (!customer.match) return { content: customer.message };
    const lineItems = this.parseLineItems(text);
    if (!lineItems.length) {
      return {
        content:
          'Tell me the quote line items, for example: 2 hours labour at $120 and $80 materials.',
      };
    }
    const site = customer.match.sites.find((item) => item.isPrimary) ?? null;
    const quotePayload: QuotePayload = {
      customerId: customer.match.id,
      customerNotes: 'Draft prepared by Tori. Review before sending.',
      customerSiteId: site?.id ?? null,
      description: 'Prepared by Tori from your request.',
      discountType: 'NONE',
      discountValue: 0,
      gstRateBasisPoints: business.gstRegistered ? 1000 : 0,
      issueDate: new Date().toISOString(),
      lineItems,
      pricingMode: 'GST_EXCLUSIVE',
      title: `Quote for ${customer.match.displayName}`,
    };
    const totals = calculateQuoteTotals(quotePayload);
    const draft = this.actionDraft({
      description: `Create a draft quote for ${customer.match.displayName}.`,
      entityId: null,
      entityType: 'QUOTE',
      payload: { quotePayload, type: 'CREATE_QUOTE' },
      proposedChanges: [
        { label: 'Customer', to: customer.match.displayName },
        { label: 'Subtotal', to: formatAudCents(totals.subtotalCents) },
        { label: 'GST', to: formatAudCents(totals.gstCents) },
        { label: 'Total', to: formatAudCents(totals.totalCents) },
      ],
      title: 'Create draft quote',
      validationState: 'READY',
      warnings: ['This will create a DRAFT quote only. It will not be sent.'],
    });
    return {
      actionDraft: draft,
      content:
        'I prepared a quote draft with TradieOS GST/totals. Nothing has been created yet.',
    };
  }

  private async prepareInvoiceDraft(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    text: string,
    context?: ToriContext,
  ) {
    this.assertRole(currentUser, INVOICE_CREATE_ROLES);
    const sourceJobId = context?.jobId ?? null;
    const job = sourceJobId
      ? await this.prisma.job.findFirst({
          where: { businessId: currentUser.businessId, id: sourceJobId },
          include: {
            customer: { include: { sites: { where: { isArchived: false } } } },
            invoices: { where: { status: { not: 'VOID' } }, take: 1 },
            relatedQuotes: {
              where: { status: 'ACCEPTED' },
              include: { lineItems: true },
              orderBy: { acceptedAt: 'desc' },
              take: 1,
            },
            sourceQuote: { include: { lineItems: true } },
          },
        })
      : null;
    if (!job) {
      return {
        content:
          'Open a completed job and ask Tori to create an invoice from there, or tell me the customer and line items.',
      };
    }
    if (job.invoices.length) {
      return {
        content:
          'This job already has an invoice. I will not prepare a duplicate invoice from Tori.',
      };
    }
    const acceptedQuote =
      job.sourceQuote?.status === 'ACCEPTED'
        ? job.sourceQuote
        : (job.relatedQuotes[0] ?? null);
    const lineItems: InvoicePayload['lineItems'] =
      acceptedQuote?.lineItems
        .filter((item) => item.type !== 'DISCOUNT')
        .map((item) => ({
          description: item.description ?? undefined,
          name: item.name,
          quantity: String(item.quantity),
          taxable: item.taxable,
          type: item.type as InvoicePayload['lineItems'][number]['type'],
          unit: item.unit,
          unitPriceCents: item.unitPriceCents,
        })) ?? this.parseLineItems(text);
    if (!lineItems.length) {
      return {
        content:
          'I found the job, but I need invoice line items or an accepted quote to build the draft.',
      };
    }
    const site = job.customer.sites.find((item) => item.isPrimary) ?? null;
    const issue = new Date();
    const due = new Date(issue.getTime() + 7 * 86_400_000);
    const invoicePayload: InvoicePayload = {
      customerId: job.customerId,
      customerNotes: 'Draft prepared by Tori. Review before sending.',
      customerSiteId: site?.id ?? null,
      dueDate: due.toISOString(),
      gstRateBasisPoints: business.gstRegistered ? 1000 : 0,
      issueDate: issue.toISOString(),
      jobId: job.id,
      lineItems,
      paymentTerms: 'Due within 7 days.',
      pricingMode: 'GST_EXCLUSIVE',
      sourceQuoteId: acceptedQuote?.id ?? null,
      title: `Invoice for ${job.title}`,
    };
    const totals = calculateInvoiceTotals(invoicePayload);
    const draft = this.actionDraft({
      description: `Create a draft invoice for ${job.title}.`,
      entityId: null,
      entityType: 'INVOICE',
      payload: { invoicePayload, type: 'CREATE_INVOICE' },
      proposedChanges: [
        { label: 'Customer', to: job.customer.displayName },
        { label: 'Job', to: job.title },
        { label: 'Total', to: formatAudCents(totals.totalCents) },
      ],
      title: 'Create draft invoice',
      validationState: 'READY',
      warnings: ['This will create a DRAFT invoice only. It will not be sent.'],
    });
    return {
      actionDraft: draft,
      content:
        'I prepared an invoice draft. Nothing has been created or sent yet.',
    };
  }

  private async prepareMessageDraft(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    text: string,
    context?: ToriContext,
  ) {
    this.assertRole(currentUser, COMMUNICATION_APPOINTMENT_SEND_ROLES);
    const customer = await this.resolveCustomer(
      currentUser.businessId,
      text,
      context?.customerId,
    );
    if (!customer.match) return { content: customer.message };
    const channel = this.preferredChannel(customer.match);
    const message = this.customerSafeMessage(
      text,
      customer.match.displayName,
      business.name,
    );
    const draft = this.actionDraft({
      description: `${channel} to ${customer.match.displayName}.`,
      entityId: customer.match.id,
      entityType: 'COMMUNICATION',
      payload: {
        communicationPayload: {
          channel,
          customerId: customer.match.id,
          message,
          subject: channel === 'EMAIL' ? 'Update from TradieOS' : undefined,
        },
        type: 'SEND_CUSTOMER_MESSAGE',
      },
      proposedChanges: [
        { label: 'Recipient', to: customer.match.displayName },
        { label: 'Channel', to: channel },
        { label: 'Message', to: message },
      ],
      title: 'Send customer message',
      validationState: 'READY',
      warnings: ['Tori will only send/record this after you confirm.'],
    });
    return {
      actionDraft: draft,
      content:
        'I drafted a customer-safe message. It has not been sent or recorded yet.',
    };
  }

  private async resolveAppointment(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    text: string,
    context?: ToriContext,
  ) {
    if (context?.appointmentId) {
      const appointment = await this.prisma.appointment.findFirst({
        where: {
          businessId: currentUser.businessId,
          id: context.appointmentId,
          ...(currentUser.role === 'TECHNICIAN'
            ? { assignedUserId: currentUser.id }
            : {}),
        },
        include: this.appointmentListInclude(),
      });
      if (appointment) return appointment;
    }
    const lower = text.toLowerCase();
    const technician = await this.findTechnicianMention(
      currentUser.businessId,
      lower,
    );
    const date = lower.includes('tomorrow') ? 1 : 0;
    const range = this.dayRangeFromOffset(business.timezone, date);
    const time = this.parseTimeParts(lower);
    const appointments = await this.prisma.appointment.findMany({
      where: {
        businessId: currentUser.businessId,
        scheduledStart: { gte: range.start, lt: range.end },
        status: { notIn: [...CLOSED_APPOINTMENT_STATUSES] },
        ...(technician ? { assignedUserId: technician.id } : {}),
        ...(currentUser.role === 'TECHNICIAN'
          ? { assignedUserId: currentUser.id }
          : {}),
      },
      include: this.appointmentListInclude(),
      orderBy: { scheduledStart: 'asc' },
      take: 10,
    });
    if (time) {
      return (
        appointments.find((appointment) => {
          const parts = getBusinessDateParts(
            appointment.scheduledStart,
            business.timezone,
          );
          return parts.hour === time.hour && parts.minute === time.minute;
        }) ?? appointments[0]
      );
    }
    return appointments[0] ?? null;
  }

  private async resolveCustomer(
    businessId: string,
    text: string,
    contextCustomerId?: string,
  ): Promise<{ match: CustomerMatch | null; message: string }> {
    if (contextCustomerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { businessId, id: contextCustomerId, isArchived: false },
        include: { sites: { where: { isArchived: false } } },
      });
      if (customer) return { match: customer, message: '' };
    }
    const candidate = this.extractCustomerSearch(text);
    if (!candidate) {
      return {
        match: null,
        message: 'Which customer should I use?',
      };
    }
    const matches = await this.prisma.customer.findMany({
      where: {
        businessId,
        isArchived: false,
        OR: [
          { displayName: { contains: candidate, mode: 'insensitive' } },
          { companyName: { contains: candidate, mode: 'insensitive' } },
          { firstName: { contains: candidate, mode: 'insensitive' } },
          { lastName: { contains: candidate, mode: 'insensitive' } },
        ],
      },
      include: { sites: { where: { isArchived: false } } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });
    if (matches.length === 1) return { match: matches[0], message: '' };
    if (matches.length > 1) {
      return {
        match: null,
        message: `I found multiple customers matching "${candidate}". Which one should I use?`,
      };
    }
    return {
      match: null,
      message: `I couldn't find a customer matching "${candidate}".`,
    };
  }

  private async resolveCustomerForJob(
    businessId: string,
    customerName?: string,
    contextCustomerId?: string,
  ): Promise<{ match: CustomerMatch | null; message: string }> {
    if (contextCustomerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { businessId, id: contextCustomerId, isArchived: false },
        include: { sites: { where: { isArchived: false } } },
      });
      if (customer) return { match: customer, message: '' };
    }
    if (!customerName) {
      return { match: null, message: 'Which customer is this job for?' };
    }
    const matches = await this.prisma.customer.findMany({
      where: {
        businessId,
        isArchived: false,
        OR: [
          { displayName: { contains: customerName, mode: 'insensitive' } },
          { companyName: { contains: customerName, mode: 'insensitive' } },
          { firstName: { contains: customerName, mode: 'insensitive' } },
          { lastName: { contains: customerName, mode: 'insensitive' } },
        ],
      },
      include: { sites: { where: { isArchived: false } } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });
    if (matches.length === 1) return { match: matches[0], message: '' };
    if (matches.length > 1) {
      return {
        match: null,
        message: `I found ${matches.length} customers matching "${customerName}". Which one do you mean?`,
      };
    }
    return {
      match: null,
      message: `I couldn't find a customer matching "${customerName}". Create the customer first, then I can prepare the job.`,
    };
  }

  private async snapshot(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
  ): Promise<ToriSnapshot> {
    const today = getBusinessDayRangeUtc(new Date(), business.timezone);
    const unassignedWhere = this.unassignedAppointmentWhere(
      currentUser,
      business,
    );
    const todayAppointmentWhere = {
      businessId: currentUser.businessId,
      scheduledStart: { gte: today.start, lt: today.end },
      status: { notIn: [...CLOSED_APPOINTMENT_STATUSES] },
      ...(currentUser.role === 'TECHNICIAN'
        ? { assignedUserId: currentUser.id }
        : {}),
    };
    const financialVisible = INVOICE_VIEW_ROLES.includes(currentUser.role);
    const quoteVisible = QUOTE_VIEW_ROLES.includes(currentUser.role);
    const [
      todayAppointments,
      unassignedAppointments,
      quotes,
      outstanding,
      overdue,
    ] = await Promise.all([
      this.prisma.appointment.count({ where: todayAppointmentWhere }),
      currentUser.role === 'TECHNICIAN'
        ? Promise.resolve(0)
        : this.prisma.appointment.count({ where: unassignedWhere }),
      quoteVisible
        ? this.prisma.quote.count({
            where: {
              businessId: currentUser.businessId,
              status: { in: ['SENT', 'VIEWED'] },
            },
          })
        : Promise.resolve(0),
      financialVisible
        ? this.prisma.invoice.aggregate({
            _sum: { balanceDueCents: true },
            where: {
              balanceDueCents: { gt: 0 },
              businessId: currentUser.businessId,
              status: { in: [...INVOICE_OPEN_STATUSES] },
            },
          })
        : Promise.resolve({ _sum: { balanceDueCents: 0 } }),
      financialVisible
        ? this.prisma.invoice.aggregate({
            _sum: { balanceDueCents: true },
            where: {
              balanceDueCents: { gt: 0 },
              businessId: currentUser.businessId,
              dueDate: { lt: today.start },
              status: { in: [...INVOICE_OPEN_STATUSES] },
            },
          })
        : Promise.resolve({ _sum: { balanceDueCents: 0 } }),
    ]);
    return {
      outstandingInvoicesCents: outstanding._sum.balanceDueCents ?? 0,
      overdueInvoicesCents: overdue._sum.balanceDueCents ?? 0,
      quotesAwaitingResponse: quotes,
      todayAppointments,
      unassignedAppointments,
    };
  }

  private actionDraft(input: {
    title: string;
    description: string;
    entityType: ToriActionDraft['entityType'];
    entityId: string | null;
    proposedChanges: ToriActionDraft['proposedChanges'];
    validationState: ToriActionDraft['validationState'];
    warnings: string[];
    payload: ToriActionPayload;
  }): ToriActionDraft {
    const now = new Date();
    return {
      createdAt: now.toISOString(),
      description: input.description,
      entityId: input.entityId,
      entityType: input.entityType,
      expiresAt: new Date(now.getTime() + ACTION_DRAFT_EXPIRY_MS).toISOString(),
      id: randomUUID(),
      payload: input.payload,
      proposedChanges: input.proposedChanges,
      requiresConfirmation: true,
      status: 'AWAITING_CONFIRMATION',
      title: input.title,
      type: input.payload.type,
      validationState: input.validationState,
      warnings: input.warnings,
    };
  }

  private async loadAppointmentJob(businessId: string, jobId: string) {
    return this.prisma.job.findFirst({
      include: {
        customer: { include: { sites: { where: { isArchived: false } } } },
      },
      where: {
        businessId,
        id: jobId,
        isArchived: false,
      },
    });
  }

  private appointmentPendingFromContext(context: ToriContext) {
    const jobId = context.pendingAppointment?.jobId ?? context.jobId;
    if (!jobId) {
      throw this.domainError(
        'TORI_APPOINTMENT_JOB_REQUIRED',
        'I need a job before I can prepare an appointment.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return {
      customerId: context.customerId,
      customerName: context.customerName,
      jobId,
      jobNumber: context.jobNumber,
      jobTitle: context.jobTitle,
      serviceLocation: context.serviceLocation,
    };
  }

  private pendingAppointmentFromJob(
    job: NonNullable<Awaited<ReturnType<AiService['loadAppointmentJob']>>>,
  ): NonNullable<ToriContext['pendingAppointment']> {
    return {
      customerId: job.customerId,
      customerName: job.customer.displayName,
      jobId: job.id,
      jobNumber: job.jobNumber,
      jobTitle: job.title,
      serviceLocation: this.jobServiceLocation(job),
    };
  }

  private jobServiceLocation(job: {
    addressLine1: string;
    suburb: string;
    state: string;
    postcode: string;
  }) {
    return {
      addressLine1: job.addressLine1,
      postcode: job.postcode,
      state: job.state,
      suburb: job.suburb,
    };
  }

  private async appointmentDraftFromPending(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    context: ToriContext,
  ): Promise<DraftPreparation> {
    const pending = context.pendingAppointment;
    if (!pending?.date || !pending.time || !pending.durationMinutes) {
      return { content: 'I still need the date, start time and duration.' };
    }
    const job = await this.loadAppointmentJob(
      currentUser.businessId,
      pending.jobId,
    );
    if (!job) {
      return {
        content:
          'I could not find that job anymore. Please open the job and ask Tori to schedule it again.',
        context: this.clearPendingContext(context),
      };
    }
    const [year, month, day] = pending.date.split('-').map(Number);
    const [hour, minute] = pending.time.split(':').map(Number);
    const start = zonedTimeToUtc(
      { day, hour, minute, month, year },
      business.timezone,
    );
    const end = new Date(start.getTime() + pending.durationMinutes * 60_000);
    const site = job.customer.sites.find((item) => item.isPrimary) ?? null;
    const appointmentPayload: AppointmentPayload = {
      accessInstructions: site?.accessInstructions ?? undefined,
      addressLine1: site?.addressLine1 ?? job.addressLine1,
      addressLine2: site?.addressLine2 ?? job.addressLine2 ?? undefined,
      appointmentType: 'INSPECTION',
      assignedUserId: null,
      customerSiteId: site?.id ?? null,
      estimatedDurationMinutes: pending.durationMinutes,
      jobId: job.id,
      locationSource: site ? 'CUSTOMER_SITE' : 'CUSTOMER_DEFAULT',
      notes: 'Prepared by Tori. Review before saving.',
      postcode: site?.postcode ?? job.postcode,
      scheduledEnd: end.toISOString(),
      scheduledStart: start.toISOString(),
      state: (site?.state ?? job.state) as AppointmentPayload['state'],
      suburb: site?.suburb ?? job.suburb,
    };
    const draft = this.actionDraft({
      description: `Book ${job.customer.displayName} for ${formatBusinessDateTime(start, business.timezone)}.`,
      entityId: null,
      entityType: 'APPOINTMENT',
      payload: { appointmentPayload, type: 'CREATE_APPOINTMENT' },
      proposedChanges: [
        { label: 'Customer', to: job.customer.displayName },
        { label: 'Job', to: `${job.jobNumber} — ${job.title}` },
        {
          label: 'Location',
          to: this.addressLabel({
            addressLine1: site?.addressLine1 ?? job.addressLine1,
            postcode: site?.postcode ?? job.postcode,
            state: (site?.state ?? job.state) as AustralianState,
            suburb: site?.suburb ?? job.suburb,
          }),
        },
        {
          label: 'Time',
          to: `${formatBusinessDate(start, business.timezone)} ${formatBusinessTimeRange(start, end, business.timezone)}`,
        },
        { label: 'Duration', to: `${pending.durationMinutes} minutes` },
        { label: 'Technician', to: 'Unassigned' },
      ],
      title: 'Create appointment',
      validationState: 'READY',
      warnings: [
        'No technician was mentioned. The appointment will be unassigned.',
      ],
    });
    return {
      actionDraft: draft,
      content:
        'I prepared an appointment draft. Nothing has been booked yet—confirm it if it looks right.',
      context: this.clearPendingContext({
        ...context,
        appointmentId: undefined,
        customerId: job.customerId,
        customerName: job.customer.displayName,
        jobId: job.id,
        jobNumber: job.jobNumber,
        jobTitle: job.title,
        serviceLocation: this.jobServiceLocation(job),
      }),
    };
  }

  private unassignedAppointmentWhere(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
  ) {
    return {
      assignedUserId: null,
      businessId: currentUser.businessId,
      scheduledStart: this.unassignedAppointmentStartFilter(business),
      status: { notIn: [...CLOSED_APPOINTMENT_STATUSES] },
    };
  }

  private unassignedAppointmentStartFilter(business: BusinessSummary) {
    return {
      gte: getBusinessDayRangeUtc(new Date(), business.timezone).start,
    };
  }

  private toAppointmentPayload(
    appointment: AppointmentWithContext,
    scheduledStart = appointment.scheduledStart,
    scheduledEnd = appointment.scheduledEnd,
  ): AppointmentPayload {
    return {
      accessInstructions: appointment.accessInstructions ?? undefined,
      addressLine1: appointment.addressLine1,
      addressLine2: appointment.addressLine2 ?? undefined,
      appointmentType: appointment.appointmentType,
      assignedUserId: appointment.assignedUserId,
      customerSiteId: appointment.customerSiteId,
      estimatedDurationMinutes: appointment.estimatedDurationMinutes,
      jobId: appointment.jobId,
      locationSource: appointment.locationSource,
      notes: appointment.notes ?? undefined,
      postcode: appointment.postcode,
      scheduledEnd: scheduledEnd.toISOString(),
      scheduledStart: scheduledStart.toISOString(),
      state: appointment.state as AppointmentPayload['state'],
      status: appointment.status,
      suburb: appointment.suburb,
      travelDistanceKm: appointment.travelDistanceKm
        ? Number(appointment.travelDistanceKm)
        : null,
      travelDurationMinutes: appointment.travelDurationMinutes,
    };
  }

  private async assertAppointmentFresh(
    currentUser: AuthenticatedUser,
    appointmentId: string,
    expectedUpdatedAt: string,
  ) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { businessId: currentUser.businessId, id: appointmentId },
      select: { updatedAt: true },
    });
    if (!appointment) {
      throw this.domainError(
        'TORI_ENTITY_NOT_FOUND',
        'This appointment could not be found.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (appointment.updatedAt.toISOString() !== expectedUpdatedAt) {
      throw this.domainError(
        'TORI_DRAFT_STALE',
        'This appointment changed since Tori prepared the action. Review the latest details.',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async findTechnicianMention(businessId: string, lower: string) {
    const members = await this.prisma.businessMember.findMany({
      where: {
        businessId,
        role: { in: ['OWNER', 'ADMIN', 'TECHNICIAN'] },
        status: 'ACTIVE',
        userId: { not: null },
      },
      include: { user: true },
      take: 50,
    });
    return (
      members
        .map((member) => member.user)
        .filter((user): user is NonNullable<typeof user> => Boolean(user))
        .find((user) => {
          const name = this.userLabel(user).toLowerCase();
          return (
            lower.includes(name) ||
            lower.includes(user.firstName.toLowerCase()) ||
            lower.includes(user.email.toLowerCase().split('@')[0])
          );
        }) ?? null
    );
  }

  private parseTargetDateTime(text: string, timezone: string) {
    const time = this.parseTimeParts(text);
    if (!time) return null;
    const date = this.parseAppointmentDate(text, timezone);
    if (date) {
      const [year, month, day] = date.split('-').map(Number);
      return zonedTimeToUtc(
        {
          day,
          hour: time.hour,
          minute: time.minute,
          month,
          year,
        },
        timezone,
      );
    }
    const parts = getBusinessDateParts(new Date(), timezone);
    return zonedTimeToUtc(
      {
        day: parts.day,
        hour: time.hour,
        minute: time.minute,
        month: parts.month,
        year: parts.year,
      },
      timezone,
    );
  }

  private parseAppointmentDateTimeParts(
    text: string,
    timezone: string,
  ): AppointmentDateTimeParts {
    const date = this.parseAppointmentDate(text, timezone) ?? undefined;
    const time = this.parseTimeString(text) ?? undefined;
    return { date, time };
  }

  private parseAppointmentDate(text: string, timezone: string) {
    const lower = text.toLowerCase();
    const parts = getBusinessDateParts(new Date(), timezone);
    let offset: number | null = null;
    if (/\btoday\b/.test(lower)) offset = 0;
    if (/\btomorrow\b/.test(lower)) offset = 1;
    const weekdayOffset = this.weekdayOffset(
      lower,
      this.weekdayFromBusinessDate(parts),
    );
    if (weekdayOffset !== null) offset = weekdayOffset;
    if (offset !== null) {
      const date = zonedTimeToUtc(
        {
          day: parts.day + offset,
          hour: 0,
          minute: 0,
          month: parts.month,
          year: parts.year,
        },
        timezone,
      );
      const local = getBusinessDateParts(date, timezone);
      return `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
    }
    const au = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
    if (au) {
      return this.businessDateStringFromParts(
        Number(au[1]),
        Number(au[2]),
        au[3] ? Number(au[3]) : undefined,
        timezone,
      );
    }
    const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) {
      return this.businessDateStringFromParts(
        Number(iso[3]),
        Number(iso[2]),
        Number(iso[1]),
        timezone,
      );
    }
    const monthName = this.monthNamePattern();
    const monthFirst = text.match(
      new RegExp(
        `\\b(${monthName})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
        'i',
      ),
    );
    if (monthFirst) {
      return this.businessDateStringFromParts(
        Number(monthFirst[2]),
        this.monthNumber(monthFirst[1]),
        monthFirst[3] ? Number(monthFirst[3]) : undefined,
        timezone,
      );
    }
    const dayFirst = text.match(
      new RegExp(
        `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthName})\\.?(?:\\s+(\\d{4}))?\\b`,
        'i',
      ),
    );
    if (dayFirst) {
      return this.businessDateStringFromParts(
        Number(dayFirst[1]),
        this.monthNumber(dayFirst[2]),
        dayFirst[3] ? Number(dayFirst[3]) : undefined,
        timezone,
      );
    }
    return null;
  }

  private parseTimeString(text: string) {
    const time = this.parseTimeParts(text);
    if (!time) return null;
    return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
  }

  private parseTimeParts(text: string) {
    const meridiemMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    if (meridiemMatch) return this.toTimeParts(meridiemMatch);
    const colonMatch = text.match(/\b(\d{1,2}):(\d{2})\b/);
    if (colonMatch) return this.toTimeParts(colonMatch);
    const standalone = text.match(/^\s*(?:at\s*)?(\d{1,2})\s*$/i);
    return standalone ? this.toTimeParts(standalone) : null;
  }

  private toTimeParts(match: RegExpMatchArray) {
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2] ?? 0);
    const meridiem = match[3]?.toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (!meridiem && hour >= 1 && hour <= 6) hour += 12;
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  }

  private weekdayOffset(lower: string, todayWeekday: number) {
    const weekdays = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];
    const target = weekdays.findIndex((day) =>
      new RegExp(`\\b${day}\\b`).test(lower),
    );
    if (target < 0) return null;
    const offset = (target - todayWeekday + 7) % 7;
    return offset === 0 ? 7 : offset;
  }

  private weekdayFromBusinessDate(parts: {
    day: number;
    month: number;
    year: number;
  }) {
    return new Date(
      Date.UTC(parts.year, parts.month - 1, parts.day),
    ).getUTCDay();
  }

  private monthNamePattern() {
    return [
      'jan(?:uary)?',
      'feb(?:ruary)?',
      'mar(?:ch)?',
      'apr(?:il)?',
      'may',
      'jun(?:e)?',
      'jul(?:y)?',
      'aug(?:ust)?',
      'sep(?:t(?:ember)?)?',
      'oct(?:ober)?',
      'nov(?:ember)?',
      'dec(?:ember)?',
    ].join('|');
  }

  private monthNumber(value: string) {
    const lower = value.toLowerCase().replace('.', '');
    const prefixes = [
      'jan',
      'feb',
      'mar',
      'apr',
      'may',
      'jun',
      'jul',
      'aug',
      'sep',
      'oct',
      'nov',
      'dec',
    ];
    const index = prefixes.findIndex((prefix) => lower.startsWith(prefix));
    return index >= 0 ? index + 1 : NaN;
  }

  private businessDateStringFromParts(
    day: number,
    month: number,
    explicitYear: number | undefined,
    timezone: string,
  ) {
    if (!Number.isInteger(day) || !Number.isInteger(month)) return null;
    const today = getBusinessDateParts(new Date(), timezone);
    let year = explicitYear ?? today.year;
    let candidate = this.validBusinessDateString(day, month, year, timezone);
    if (!candidate || explicitYear) return candidate;
    const isPast =
      month < today.month || (month === today.month && day < today.day);
    if (isPast) {
      year += 1;
      candidate = this.validBusinessDateString(day, month, year, timezone);
    }
    return candidate;
  }

  private validBusinessDateString(
    day: number,
    month: number,
    year: number,
    timezone: string,
  ) {
    if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) {
      return null;
    }
    const utc = zonedTimeToUtc(
      { day, hour: 0, minute: 0, month, year },
      timezone,
    );
    const local = getBusinessDateParts(utc, timezone);
    if (local.year !== year || local.month !== month || local.day !== day) {
      return null;
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  private pendingAppointmentStartDate(
    pending: NonNullable<ToriContext['pendingAppointment']> | undefined,
    timezone: string,
  ) {
    if (!pending?.date || !pending.time) return null;
    const [year, month, day] = pending.date.split('-').map(Number);
    const [hour, minute] = pending.time.split(':').map(Number);
    return zonedTimeToUtc({ day, hour, minute, month, year }, timezone);
  }

  private parseDurationMinutes(text: string) {
    const hourMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)\b/i);
    if (hourMatch) return Math.round(Number(hourMatch[1]) * 60);
    const minuteMatch = text.match(/\b(\d+)\s*(minutes?|mins?|m)\b/i);
    return minuteMatch ? Number(minuteMatch[1]) : null;
  }

  private parseLineItems(text: string): QuotePayload['lineItems'] {
    const items: QuotePayload['lineItems'] = [];
    const labour = text.match(
      /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s+(?:labou?r|work).*?\$?(\d+(?:\.\d{1,2})?)/i,
    );
    if (labour) {
      items.push({
        name: 'Labour',
        quantity: labour[1],
        taxable: true,
        type: 'LABOUR',
        unit: 'hour',
        unitPriceCents: this.moneyToCents(labour[2]),
      });
    }
    const materials = text.match(
      /\$?(\d+(?:\.\d{1,2})?)\s*(?:materials?|parts?|supplies)/i,
    );
    if (materials) {
      items.push({
        name: 'Materials',
        quantity: '1',
        taxable: true,
        type: 'MATERIAL',
        unit: 'item',
        unitPriceCents: this.moneyToCents(materials[1]),
      });
    }
    if (!items.length) {
      const amount = text.match(/\$?(\d+(?:\.\d{1,2})?)/);
      if (amount) {
        items.push({
          name: 'Service',
          quantity: '1',
          taxable: true,
          type: 'SERVICE',
          unit: 'item',
          unitPriceCents: this.moneyToCents(amount[1]),
        });
      }
    }
    return items;
  }

  private customerSafeMessage(
    text: string,
    customerName: string,
    businessName: string,
  ) {
    const late = text.match(/(\d+)\s*(?:minutes?|mins?)\s*late/i);
    if (late) {
      return `Hi ${customerName}, ${businessName} is running approximately ${late[1]} minutes late. Sorry for the delay.`;
    }
    const cleaned = text
      .replace(/^(tell|message|sms|email)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    return `Hi ${customerName}, ${cleaned}`;
  }

  private customerSlots(
    text: string,
    request: ToriChatRequest,
  ): CustomerDraftSlots {
    const combined = this.conversationText(text, request);
    const name = this.extractNewCustomerName(combined, text, request);
    const email = combined.match(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    )?.[0];
    const phone = this.extractAustralianPhone(combined);
    const address = this.extractAustralianAddress(combined);
    const [firstName, ...lastName] = name?.split(/\s+/) ?? [];
    return {
      ...(address ?? {}),
      ...(email ? { email } : {}),
      ...(firstName ? { firstName } : {}),
      ...(lastName.length ? { lastName: lastName.join(' ') } : {}),
      ...(phone ? { phone } : {}),
      contactPreference: phone ? 'PHONE' : 'EMAIL',
      customerType: 'RESIDENTIAL',
    };
  }

  private jobSlots(text: string, request: ToriChatRequest): JobDraftSlots {
    const combined = this.conversationText(text, request);
    return {
      ...(this.extractAustralianAddress(combined) ?? {}),
      customerName: this.extractJobCustomerName(combined),
      description: this.extractJobTitle(combined) ?? undefined,
      title: this.extractJobTitle(combined) ?? undefined,
    };
  }

  private conversationText(text: string, request: ToriChatRequest) {
    const recentUserText =
      request.recentMessages
        ?.filter((message) => message.role === 'user')
        .map((message) => message.content)
        .join(' ') ?? '';
    return `${recentUserText} ${text}`.replace(/\s+/g, ' ').trim();
  }

  private extractNewCustomerName(
    combined: string,
    currentText: string,
    request: ToriChatRequest,
  ) {
    const lastAssistant =
      request.recentMessages
        ?.filter((message) => message.role === 'assistant')
        .at(-1)
        ?.content.toLowerCase() ?? '';
    if (
      /\bcustomer\s+(?:and|&|with)\s+(?:a\s+)?(?:job|hob)\b/i.test(combined) &&
      !lastAssistant.includes("customer's name")
    ) {
      const nameBeforePhone = combined.match(
        /\b([A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+){0,2})\s+(?:\+?61|0)4[\d\s-]{8,12}\b/,
      )?.[1];
      if (nameBeforePhone) return this.cleanExtractedName(nameBeforePhone);
      return '';
    }
    const explicit =
      combined.match(
        /\b(?:create|add)\s+(?:a\s+|new\s+)?customer\s+([A-Za-z][A-Za-z\s'-]{1,80}?)(?:\s+(?:phone|email|at|on|for|and|to)\b|$)/i,
      )?.[1] ??
      combined.match(
        /\badd\s+([A-Za-z][A-Za-z\s'-]{1,80}?)\s+as\s+(?:a\s+)?customer\b/i,
      )?.[1];
    if (explicit) return this.cleanExtractedName(explicit);
    if (
      lastAssistant.includes("customer's name") &&
      /^[A-Za-z][A-Za-z\s'-]{1,80}$/.test(currentText.trim())
    ) {
      return this.cleanExtractedName(currentText);
    }
    return '';
  }

  private extractJobCustomerName(text: string) {
    const match = text.match(
      /\b(?:create|add|prepare)\s+(?:a\s+)?(?:plumbing\s+|electrical\s+|cleaning\s+)?job\s+for\s+([A-Za-z][A-Za-z\s'-]{1,80}?)(?:\s+to\b|\s+for\b|$)/i,
    );
    return this.cleanExtractedName(match?.[1] ?? '');
  }

  private extractJobTitle(text: string) {
    const match =
      text.match(
        /\bto\s+((?:fix|repair|inspect|install|replace|clean)\b[^.?!,]*)/i,
      ) ??
      text.match(
        /\b(?:job|work)\s+(?:for\s+[A-Za-z\s'-]+)?\s*to\s+([^.?!,]*)/i,
      );
    const raw = match?.[1]?.trim();
    if (!raw) {
      if (/\bleak|leaking|leaky\b/i.test(text)) return 'Fix leak';
      return '';
    }
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  private extractTradeType(text: string) {
    if (/\bplumb|pipe|leak|tap|toilet|sink\b/i.test(text)) return 'Plumbing';
    if (/\belectric|power|light|switch\b/i.test(text)) return 'Electrical';
    if (/\bclean|cleaning\b/i.test(text)) return 'Cleaning';
    return undefined;
  }

  private extractAustralianAddress(text: string): {
    addressLine1: string;
    suburb: string;
    state: AustralianState;
    postcode: string;
  } | null {
    const match = text.match(
      /\b(\d+\s+[A-Za-z][A-Za-z0-9\s'-]*(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Lane|Ln|Way|Place|Pl))[,]?\s+([A-Za-z][A-Za-z\s'-]+?)\s+(VIC|NSW|QLD|SA|WA|TAS|ACT|NT)\s+(\d{4})\b/i,
    );
    if (!match) return null;
    return {
      addressLine1: match[1].trim(),
      postcode: match[4],
      state: match[3].toUpperCase() as AustralianState,
      suburb: this.cleanExtractedName(match[2]),
    };
  }

  private isAustralianState(value: string): value is AustralianState {
    return ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'].includes(
      value,
    );
  }

  private mergeExpectedCustomerSlots(
    existing: Partial<CustomerPayload>,
    extracted: CustomerDraftSlots,
    currentText: string,
    request: ToriChatRequest,
    intent: NonNullable<ToriContext['pendingQuestion']>['intent'],
  ): CustomerDraftSlots {
    const expected = request.context?.pendingQuestion;
    const merged: CustomerDraftSlots = {
      ...existing,
      ...extracted,
      contactPreference:
        extracted.contactPreference ??
        existing.contactPreference ??
        (existing.email && !existing.phone ? 'EMAIL' : 'PHONE'),
      customerType:
        extracted.customerType ?? existing.customerType ?? 'RESIDENTIAL',
    };
    if (expected?.intent !== intent) return merged;

    if (expected.type === 'CUSTOMER_NAME') {
      const name = this.extractNameSlot(currentText);
      if (name) {
        const [firstName, ...lastName] = name.split(/\s+/);
        return {
          ...merged,
          firstName,
          ...(lastName.length ? { lastName: lastName.join(' ') } : {}),
        };
      }
    }
    if (expected.type === 'CUSTOMER_CONTACT') {
      const contact = this.extractContactSlot(currentText);
      return {
        ...merged,
        ...(contact.email ? { email: contact.email } : {}),
        ...(contact.phone ? { phone: contact.phone } : {}),
        contactPreference:
          contact.email && !contact.phone ? 'EMAIL' : merged.contactPreference,
      };
    }
    return merged;
  }

  private extractNameSlot(text: string) {
    const trimmed = text.trim();
    if (this.isUnsupportedSlotInput(trimmed.toLowerCase())) return '';
    if (!/^[A-Za-z][A-Za-z\s'-]{1,80}$/.test(trimmed)) return '';
    return this.cleanExtractedName(trimmed);
  }

  private extractContactSlot(text: string) {
    const email = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0];
    const phone = this.extractAustralianPhone(text);
    return {
      email,
      phone,
    };
  }

  private extractAustralianPhone(text: string) {
    const patterns = [
      /\+?\s*61[\s\-()]?4[\s\-()]?\d{2}[\s\-()]?\d{3}[\s\-()]?\d{3}\b/g,
      /\b04[\s\-()]?\d{2}[\s\-()]?\d{3}[\s\-()]?\d{3}\b/g,
      /\b04\d{7,8}\b/g,
    ];
    const candidates = patterns.flatMap((pattern) => text.match(pattern) ?? []);
    return (
      candidates
        .map((candidate) => this.normalisePhone(candidate))
        .find((candidate) => this.isAustralianPhone(candidate)) ?? null
    );
  }

  private jobAddressFromSlots(slots: JobDraftSlots) {
    if (slots.addressLine1 && slots.suburb && slots.state && slots.postcode) {
      return {
        addressLine1: slots.addressLine1,
        postcode: slots.postcode,
        state: slots.state,
        suburb: slots.suburb,
      };
    }
    return null;
  }

  private jobAddressFromSlotsOrCustomer(
    slots: JobDraftSlots,
    customer: CustomerMatch,
  ) {
    const fromSlots = this.jobAddressFromSlots(slots);
    if (fromSlots) return fromSlots;
    const site =
      customer.sites.find((item) => item.isPrimary) ?? customer.sites[0];
    if (site) {
      return {
        addressLine1: site.addressLine1,
        postcode: site.postcode,
        state: site.state as AustralianState,
        suburb: site.suburb,
      };
    }
    return null;
  }

  private async customerDuplicateWarnings(
    businessId: string,
    slots: CustomerDraftSlots,
  ) {
    const email = slots.email?.trim().toLowerCase();
    const phone = slots.phone ? this.normalisePhone(slots.phone) : null;
    if (!email && !phone) return [];
    const matches = await this.prisma.customer.findMany({
      where: {
        businessId,
        isArchived: false,
        OR: [
          ...(email ? [{ emailNormalised: email }] : []),
          ...(phone ? [{ phoneNormalised: phone }] : []),
        ],
      },
      select: { displayName: true, email: true, id: true, phone: true },
      take: 3,
    });
    const warnings = new Map<string, string>();
    for (const match of matches) {
      const identity =
        match.id ??
        `${match.displayName}:${match.phone ?? ''}:${match.email ?? ''}`;
      warnings.set(
        identity,
        `Possible duplicate: ${match.displayName} (${match.phone ?? match.email ?? 'matching contact'}).`,
      );
    }
    return [...warnings.values()];
  }

  private customerDisplayName(customer: Partial<CustomerPayload>) {
    return (
      [customer.firstName, customer.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() ||
      customer.companyName ||
      'Customer'
    );
  }

  private addressLabel(
    address: Partial<
      Pick<CustomerPayload, 'addressLine1' | 'suburb' | 'state' | 'postcode'>
    >,
  ) {
    return [
      address.addressLine1,
      address.suburb,
      address.state,
      address.postcode,
    ]
      .filter(Boolean)
      .join(', ');
  }

  private defaultJobStart(timezone: string) {
    const parts = getBusinessDateParts(new Date(), timezone);
    return zonedTimeToUtc(
      {
        day: parts.day,
        hour: 8,
        minute: 0,
        month: parts.month,
        year: parts.year,
      },
      timezone,
    ).toISOString();
  }

  private cleanExtractedName(value: string) {
    return value
      .replace(/\b(?:phone|email|mobile|number|address)\b.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalisePhone(value: string) {
    const digits = value.trim().replace(/\D/g, '');
    if (digits.startsWith('614')) return `0${digits.slice(2)}`;
    if (digits.startsWith('61') && digits.length === 11) {
      return `0${digits.slice(2)}`;
    }
    return digits;
  }

  private isAustralianPhone(value: string) {
    const normalised = this.normalisePhone(value);
    return /^04\d{7,8}$/.test(normalised) || /^0[2378]\d{8}$/.test(normalised);
  }

  private isExpectedCustomerContact(
    request: ToriChatRequest,
    intent: NonNullable<ToriContext['pendingQuestion']>['intent'],
  ) {
    return (
      request.context?.pendingQuestion?.intent === intent &&
      request.context.pendingQuestion.type === 'CUSTOMER_CONTACT'
    );
  }

  private extractCustomerSearch(text: string) {
    const match =
      text.match(
        /\bfor\s+([A-Za-z][A-Za-z\s'-]{1,80}?)(?:\s+for\s+|\s+tomorrow|\s+at\s+|\s+we're|\s+were|\s*$)/i,
      ) ??
      text.match(
        /\btell\s+([A-Za-z][A-Za-z\s'-]{1,80}?)(?:\s+we|\s+that|\s*$)/i,
      ) ??
      text.match(
        /\bbook\s+([A-Za-z][A-Za-z\s'-]{1,80}?)(?:\s+for|\s+tomorrow|\s+at\s+|\s*$)/i,
      );
    return match?.[1]?.trim().replace(/\s+/g, ' ') ?? '';
  }

  private preferredChannel(
    customer: CustomerMatch,
  ): CustomerCommunicationChannel {
    if (
      customer.contactPreference === 'SMS' ||
      (customer.phone && customer.contactPreference !== 'EMAIL')
    ) {
      return 'SMS';
    }
    return 'EMAIL';
  }

  private moneyToCents(value: string) {
    return Math.round(Number(value) * 100);
  }

  private dayRangeFromOffset(timezone: string, offset: number) {
    const nowParts = getBusinessDateParts(new Date(), timezone);
    const start = zonedTimeToUtc(
      {
        day: nowParts.day + offset,
        month: nowParts.month,
        year: nowParts.year,
      },
      timezone,
    );
    const end = zonedTimeToUtc(
      {
        day: nowParts.day + offset + 1,
        month: nowParts.month,
        year: nowParts.year,
      },
      timezone,
    );
    return { end, start };
  }

  private appointmentListInclude() {
    return {
      assignedUser: true,
      job: { include: { customer: true } },
    } as const;
  }

  private async business(businessId: string): Promise<BusinessSummary> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: {
        gstRegistered: true,
        id: true,
        name: true,
        timezone: true,
      },
    });
    if (!business) {
      throw this.domainError(
        'TORI_BUSINESS_NOT_FOUND',
        'Business workspace could not be found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      ...business,
      timezone: normaliseBusinessTimezone(business.timezone),
    };
  }

  private async businessTimezone(businessId: string) {
    return (await this.business(businessId)).timezone;
  }

  private userLabel(
    user?: {
      firstName?: string | null;
      lastName?: string | null;
      email?: string | null;
    } | null,
  ) {
    if (!user) return 'Unassigned';
    return (
      [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
      user.email ||
      'Unassigned'
    );
  }

  private suggestedPrompts(role: BusinessRole) {
    if (role === 'TECHNICIAN') {
      return [
        "What's happening today?",
        "What's happening tomorrow?",
        'What jobs are currently in progress?',
      ];
    }
    if (role === 'ACCOUNTANT') {
      return [
        'How much is outstanding?',
        'Which invoices are overdue?',
        'What needs my attention?',
      ];
    }
    return [
      "What's happening today?",
      'Show unassigned appointments.',
      'How much is outstanding?',
      'What quotes are waiting for customer response?',
      'What do I need to follow up today?',
    ];
  }

  private assertToriAccess(currentUser: AuthenticatedUser) {
    if (!roleCanUseTori(currentUser.role)) {
      throw new ForbiddenException("You don't have permission to use Tori.");
    }
  }

  private assertRole(currentUser: AuthenticatedUser, roles: BusinessRole[]) {
    if (!roles.includes(currentUser.role)) {
      throw new ForbiddenException(
        "Tori can't perform that action with your current role.",
      );
    }
  }

  private domainError(code: string, message: string, status: HttpStatus) {
    return new HttpException({ code, message }, status);
  }

  private looksLikeReschedule(lower: string) {
    return /\b(move|reschedule|shift)\b/.test(lower);
  }

  private looksLikeReassign(lower: string) {
    return (
      /\b(reassign|assign|give)\b/.test(lower) &&
      /\b(alex|mia|john|technician|to)\b/.test(lower)
    );
  }

  private looksLikeCreateAppointment(lower: string) {
    return (
      /\b(book|schedule)\b.*\bappointment\b/.test(lower) ||
      /\bcrea(?:te|n)\b.*\bappointment\b/.test(lower) ||
      /\bcreate appointment\b/.test(lower)
    );
  }

  private looksLikeExplicitCreateCustomerAndJob(lower: string) {
    return (
      (/\b(creat|create|add)\b/.test(lower) &&
        /\bcustomer\b/.test(lower) &&
        /\b(job|hob)\b/.test(lower)) ||
      (/\bcustomer\b/.test(lower) &&
        /(?:&|\band\b|\bwith\b)/.test(lower) &&
        /\b(job|hob)\b/.test(lower))
    );
  }

  private looksLikeExplicitCreateCustomer(lower: string) {
    return (
      /\b(create|add)\b.*\bcustomer\b/.test(lower) ||
      /\badd\s+[a-z][a-z\s'-]{1,80}\s+as\s+(?:a\s+)?customer\b/i.test(lower)
    );
  }

  private looksLikeExplicitCreateJob(lower: string) {
    return /\b(create|add|prepare)\b.*\bjob\b/.test(lower);
  }

  private looksLikeCreateCustomerAndJob(
    lower: string,
    request: ToriChatRequest,
  ) {
    return (
      (/\b(create|add)\b/.test(lower) &&
        /\bcustomer\b/.test(lower) &&
        /\bjob\b/.test(lower)) ||
      this.isPendingClarification(request, [
        'customer and job',
        'phone number should i use for the customer',
        'service address for this job',
      ])
    );
  }

  private looksLikeCreateCustomer(lower: string, request: ToriChatRequest) {
    return (
      /\b(create|add)\b.*\bcustomer\b/.test(lower) ||
      /\badd\s+[a-z][a-z\s'-]{1,80}\s+as\s+(?:a\s+)?customer\b/i.test(lower) ||
      this.isPendingClarification(request, [
        "customer's name",
        'phone number or email',
      ])
    );
  }

  private looksLikeCreateJob(lower: string, request: ToriChatRequest) {
    return (
      /\b(create|add|prepare)\b.*\bjob\b/.test(lower) ||
      this.isPendingClarification(request, [
        'which customer is this job for',
        'what service address should i use for this job',
        'what should i call this job',
      ])
    );
  }

  private looksLikeCreateQuote(lower: string) {
    return (
      /\b(quote|estimate)\b/.test(lower) &&
      /\b(prepare|create|draft)\b/.test(lower)
    );
  }

  private looksLikeCreateInvoice(lower: string) {
    return (
      /\binvoice\b/.test(lower) && /\b(create|draft|prepare)\b/.test(lower)
    );
  }

  private looksLikeCustomerMessage(lower: string) {
    return /\b(tell|message|sms|email)\b/.test(lower);
  }

  private looksLikeReadQuestion(lower: string) {
    return (
      this.isFinancialQuestion(lower) ||
      lower.includes('follow up') ||
      lower.includes('follow-up') ||
      lower.includes('quote') ||
      (lower.includes('job') && lower.includes('progress')) ||
      lower.includes('appointment') ||
      lower.includes('schedule') ||
      lower.includes('unassigned') ||
      lower.includes('today') ||
      lower.includes('tomorrow') ||
      lower.includes("what's happening") ||
      lower.includes('what is happening')
    );
  }

  private isPendingClarification(request: ToriChatRequest, markers: string[]) {
    const lastAssistant =
      request.recentMessages
        ?.filter((message) => message.role === 'assistant')
        .at(-1)
        ?.content.toLowerCase() ?? '';
    return markers.some((marker) => lastAssistant.includes(marker));
  }

  private looksLikePendingCustomerAndJob(request: ToriChatRequest) {
    return this.isPendingClarification(request, [
      'customer and job',
      'phone number should i use for the customer',
      'service address for this job',
    ]);
  }

  private looksLikePendingCustomer(request: ToriChatRequest) {
    return this.isPendingClarification(request, [
      "customer's name",
      'phone number or email',
    ]);
  }

  private looksLikePendingJob(request: ToriChatRequest) {
    return this.isPendingClarification(request, [
      'which customer is this job for',
      'what service address should i use for this job',
      'what should i call this job',
    ]);
  }

  private hasPendingWorkflow(request: ToriChatRequest) {
    return Boolean(
      request.context?.pendingAppointment ||
      request.context?.pendingCustomer ||
      request.context?.pendingCustomerAndJob ||
      request.context?.pendingQuestion ||
      this.looksLikePendingCustomerAndJob(request) ||
      this.looksLikePendingCustomer(request) ||
      this.looksLikePendingJob(request),
    );
  }

  private isCancelCommand(lower: string) {
    return /^(cancel|stop|never mind|nevermind|forget it)$/i.test(lower.trim());
  }

  private isPositiveConfirmation(lower: string) {
    return /^(yes|yes please|yep|yeah|sure|okay|ok|do it)$/i.test(lower.trim());
  }

  private isNegativeConfirmation(lower: string) {
    return /^(no|no thanks|not now|nope)$/i.test(lower.trim());
  }

  private isUnsupportedSlotInput(lower: string) {
    return /\b(order|pizza|burger|lunch|dinner|food)\b/.test(lower);
  }

  private clearPendingContext(context?: ToriContext): ToriContext | undefined {
    if (!context) return undefined;
    const {
      pendingAppointment,
      pendingCustomer,
      pendingCustomerAndJob,
      pendingQuestion,
      ...rest
    } = context;
    void pendingAppointment;
    void pendingCustomer;
    void pendingCustomerAndJob;
    void pendingQuestion;
    return rest;
  }

  private unsupportedIntentMessage() {
    return "I can't prepare that action yet. I can currently help with appointments, scheduling, quotes, invoices, customer messages and operational questions.";
  }

  private isFinancialQuestion(lower: string) {
    return (
      lower.includes('outstanding') ||
      lower.includes('overdue') ||
      lower.includes("hasn't paid") ||
      lower.includes('unpaid') ||
      lower.includes('money')
    );
  }
}
