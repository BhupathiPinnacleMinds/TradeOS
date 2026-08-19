import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ACCOUNTS_RECEIVABLE_VIEW_ROLES,
  APPOINTMENT_ASSIGNABLE_TECHNICIAN_ROLES,
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
  parseQuoteMoneyInput,
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

type AustralianAddressSlots = {
  addressLine1: string;
  suburb: string;
  state: AustralianState;
  postcode: string;
};

type AustralianAddressParseResult =
  | {
      address: AustralianAddressSlots;
      status: 'VALID';
    }
  | {
      message: string;
      status: 'STATE_POSTCODE_CONFLICT';
    }
  | {
      status: 'INVALID';
    };

type PendingDispatch = NonNullable<ToriContext['pendingDispatch']>;

type DispatchAvailabilityRecommendation = {
  technicianId: string;
  technicianName: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  reason: string;
} | null;

type AppointmentDateTimeParts = {
  date?: string;
  time?: string;
};

type ToriParsedRequest = {
  intents: Array<
    | 'READ_TODAY'
    | 'READ_APPOINTMENTS'
    | 'READ_AVAILABILITY'
    | 'READ_UNASSIGNED'
    | 'READ_OUTSTANDING'
    | 'READ_QUOTES_WAITING'
    | 'READ_FOLLOWUPS'
    | 'CREATE_CUSTOMER'
    | 'CREATE_JOB'
    | 'CREATE_APPOINTMENT'
    | 'DISPATCH_JOB'
    | 'ASSIGN_TECHNICIAN'
    | 'REASSIGN_TECHNICIAN'
    | 'RESCHEDULE_APPOINTMENT'
    | 'CANCEL_APPOINTMENT'
    | 'CREATE_QUOTE'
    | 'CREATE_INVOICE'
    | 'SEND_CUSTOMER_MESSAGE'
    | 'CONFIRM'
    | 'DECLINE'
    | 'UNKNOWN'
  >;
  customer?: {
    email?: string;
    name?: string;
    phone?: string;
    pronounReference?: boolean;
    referenceType?: 'EXPLICIT' | 'THIS_CUSTOMER' | 'RECENT';
    impliesNew?: boolean;
  };
  job?: {
    issueText?: string;
    jobNumber?: string;
    title?: string;
  };
  location?: {
    addressLine1?: string;
    postcode?: string;
    state?: AustralianState;
    suburb?: string;
  };
  scheduling?: {
    date?: string;
    daypart?: 'MORNING' | 'AFTERNOON';
    durationMinutes?: number;
    time?: string;
  };
  technician?: {
    name?: string;
    requestAvailable?: boolean;
    requestBest?: boolean;
  };
  references?: {
    previous?: boolean;
    thisAppointment?: boolean;
    thisCustomer?: boolean;
    thisJob?: boolean;
  };
  confirmation?: 'YES' | 'NO' | 'UNKNOWN';
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  action: {
    assignTechnician?: boolean;
    createAppointment?: boolean;
    createCustomer?: boolean;
    createJob?: boolean;
    createInvoice?: boolean;
    createQuote?: boolean;
    dispatch?: boolean;
  };
};

type ToriWorkflowBoundary = {
  contextInherited: boolean;
  newRoot: boolean;
  previousCustomer?: string;
  reason: string;
};

type CustomerMatch = {
  id: string;
  displayName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  contactPreference: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
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

type ToriAppointmentLocation = {
  accessInstructions?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  customerSiteId: string | null;
  locationSource: AppointmentPayload['locationSource'];
  postcode: string;
  state: AppointmentPayload['state'];
  suburb: string;
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
    const parsed = this.understandCurrentTurn(text, business.timezone);
    const boundary = this.detectWorkflowBoundary(parsed, request.context);
    this.logToriDecision(parsed, boundary, request.context, lower);

    let content: string;
    let actionDraft: ToriActionDraft | undefined;
    let responseContext: ToriContext | undefined = request.context;

    if (!text) {
      content = 'Ask me about your work, money, quotes, or scheduling.';
    } else if (this.isCancelCommand(lower)) {
      if (request.context?.pendingDispatch) {
        content = this.cancelDispatchMessage(request.context.pendingDispatch);
        responseContext = this.clearPendingContext(request.context);
      } else {
        content =
          'Okay, I cancelled that Tori workflow. No TradieOS data changed.';
        responseContext = this.clearPendingContext(request.context);
      }
    } else if (
      this.shouldRouteStrongMutatingRootCommandBeforePendingWorkflow(
        parsed,
        lower,
        request.context,
      )
    ) {
      ({
        content,
        actionDraft,
        context: responseContext,
      } = await this.routeStrongMutatingRootCommand(
        currentUser,
        business,
        text,
        parsed,
        {
          ...request,
          context: this.clearPendingContext(request.context),
        },
      ));
    } else if (
      request.context?.pendingDispatch &&
      this.looksLikeExplicitCreateCustomer(lower)
    ) {
      ({
        content,
        actionDraft,
        context: responseContext,
      } = await this.prepareCustomerDraft(currentUser, text, {
        ...request,
        context: this.clearPendingContext(request.context),
      }));
    } else if (
      boundary.newRoot &&
      request.context?.pendingDispatch &&
      this.isDispatchCreateObjective(parsed)
    ) {
      ({
        content,
        actionDraft,
        context: responseContext,
      } = await this.startDispatchWorkflow(
        currentUser,
        business,
        text,
        parsed,
      ));
    } else if (
      !boundary.newRoot &&
      request.context?.pendingQuestion?.intent === 'DISPATCH_JOB'
    ) {
      ({
        content,
        actionDraft,
        context: responseContext,
      } = await this.answerDispatchPendingQuestion(
        currentUser,
        business,
        text,
        request.context,
      ));
    } else if (
      !boundary.newRoot &&
      !this.looksLikeCreateQuote(lower) &&
      !this.isStrongMutatingRootCommand(parsed, lower) &&
      request.context &&
      this.isExpectedQuoteLineItems(request.context)
    ) {
      ({
        content,
        actionDraft,
        context: responseContext,
      } = await this.answerQuoteLineItemsQuestion(
        currentUser,
        business,
        text,
        request.context,
      ));
    } else if (
      request.context?.pendingDispatch &&
      this.looksLikeReadQuestion(lower) &&
      !this.isNoAvailabilityRetryTurn(
        parsed,
        lower,
        request.context.pendingDispatch,
      ) &&
      !this.isActionableCurrentTurn(parsed) &&
      !this.parseDurationMinutes(text)
    ) {
      content = await this.answerReadQuestion(currentUser, business, text);
      responseContext = request.context;
    } else if (request.context?.pendingDispatch) {
      ({
        content,
        actionDraft,
        context: responseContext,
      } = await this.continueDispatchWorkflow(
        currentUser,
        business,
        text,
        request.context.pendingDispatch,
      ));
    } else if (
      this.isNegativeConfirmation(lower) &&
      request.context?.pendingQuestion?.intent ===
        'CREATE_APPOINTMENT_FOR_JOB' &&
      (request.context.pendingQuestion.type === 'YES_NO' ||
        request.context.pendingQuestion.type === 'APPOINTMENT_JOB')
    ) {
      content =
        request.context.pendingQuestion.type === 'APPOINTMENT_JOB'
          ? 'Okay. No job or appointment was created.'
          : 'Okay. The customer and job remain created. No appointment was created.';
      responseContext = this.clearPendingContext(request.context);
    } else if (
      this.isPositiveConfirmation(lower) &&
      request.context?.pendingQuestion?.intent ===
        'CREATE_APPOINTMENT_FOR_JOB' &&
      request.context.pendingQuestion.type === 'YES_NO'
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
    } else if (
      this.isNegativeConfirmation(lower) &&
      request.context?.pendingQuestion?.intent === 'CREATE_JOB'
    ) {
      content =
        'Okay. I cancelled that job draft workflow. No TradieOS data changed.';
      responseContext = this.clearPendingContext(request.context);
    } else if (
      request.context?.pendingQuestion?.intent === 'CREATE_JOB' &&
      this.looksLikeReadQuestion(lower) &&
      !this.isActionableCurrentTurn(parsed)
    ) {
      content = await this.answerReadQuestion(currentUser, business, text);
      responseContext = request.context;
    } else if (
      request.context?.pendingQuestion?.intent === 'CREATE_JOB' ||
      (request.context?.pendingQuestion?.intent ===
        'CREATE_APPOINTMENT_FOR_JOB' &&
        request.context.pendingQuestion.type === 'APPOINTMENT_JOB' &&
        (this.isPositiveConfirmation(lower) ||
          this.looksLikeCreateJob(lower, request) ||
          this.looksLikeExplicitCreateJob(lower)))
    ) {
      ({
        content,
        actionDraft,
        context: responseContext,
      } = await this.prepareJobDraft(currentUser, business, text, request));
    } else if (boundary.newRoot && request.context?.pendingAppointment) {
      ({
        content,
        actionDraft,
        context: responseContext,
      } = await this.startDispatchWorkflow(
        currentUser,
        business,
        text,
        parsed,
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
    } else if (this.isDispatchCreateObjective(parsed)) {
      ({
        content,
        actionDraft,
        context: responseContext,
      } = await this.startDispatchWorkflow(
        currentUser,
        business,
        text,
        parsed,
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
    } else if (this.looksLikeCreateQuote(lower)) {
      ({
        content,
        actionDraft,
        context: responseContext,
      } = await this.prepareQuoteDraft(
        currentUser,
        business,
        text,
        request.context,
      ));
    } else if (
      this.hasPendingWorkflow(request) &&
      this.looksLikeReadQuestion(lower) &&
      !this.isActionableCurrentTurn(parsed)
    ) {
      content = await this.answerReadQuestion(currentUser, business, text);
      responseContext = this.clearPendingContext(request.context);
    } else if (this.looksLikeCreateJobForReferencedCustomer(lower)) {
      ({
        content,
        actionDraft,
        context: responseContext,
      } = await this.prepareJobDraft(currentUser, business, text, request));
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
    } else if (this.looksLikeCreateInvoice(lower)) {
      ({ content, actionDraft } = await this.prepareInvoiceDraft(
        currentUser,
        business,
        text,
        request.context,
      ));
    } else if (this.looksLikeTechnicianRecommendation(lower)) {
      content = await this.answerTechnicianRecommendation(
        currentUser,
        business,
        text,
        request.context,
      );
    } else if (this.looksLikeTechnicianAssignment(lower)) {
      ({ content, actionDraft } = await this.prepareSmartReassignDraft(
        currentUser,
        business,
        text,
        request.context,
      ));
    } else if (this.looksLikeReassign(lower)) {
      ({ content, actionDraft } = await this.prepareSmartReassignDraft(
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
    } else if (
      this.looksLikeReadQuestion(lower) &&
      !this.isActionableCurrentTurn(parsed)
    ) {
      content = await this.answerReadQuestion(currentUser, business, text);
      responseContext = this.clearPendingContext(request.context);
    } else {
      content = this.unsupportedIntentMessage();
    }

    return {
      message: this.assistantMessage(content, actionDraft),
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
    const dispatchContext = this.dispatchContextFromPayload(draft.payload);
    if (dispatchContext) {
      result = await this.withDispatchResume(
        currentUser,
        draft.payload.type,
        result,
        dispatchContext,
      );
    }
    this.completedDraftIds.add(draftId);
    return result;
  }

  private dispatchContextFromPayload(payload: ToriActionPayload) {
    if (
      payload.type === 'CREATE_CUSTOMER' ||
      payload.type === 'CREATE_JOB' ||
      payload.type === 'CREATE_APPOINTMENT'
    ) {
      return payload.dispatchContext;
    }
    return undefined;
  }

  private async withDispatchResume(
    currentUser: AuthenticatedUser,
    actionType: ToriActionPayload['type'],
    result: ToriActionConfirmResponse,
    dispatch: PendingDispatch,
  ): Promise<ToriActionConfirmResponse> {
    const updated = this.mergeDispatchConfirmation(
      actionType,
      result,
      dispatch,
    );
    if (actionType === 'CREATE_APPOINTMENT') {
      return {
        ...result,
        context: {
          ...result.context,
          pendingDispatch: undefined,
          recentAppointment: result.context?.recentAppointment,
        },
        message: `${result.message} Dispatch booking is complete.`,
      };
    }
    const business = await this.business(currentUser.businessId);
    const next = await this.continueDispatchWorkflow(
      currentUser,
      business,
      '',
      updated,
    );
    const continuationMessage =
      actionType === 'CREATE_JOB'
        ? `Job created. I'll check technician availability for ${this.dispatchRequestedLabel(updated, business.timezone)}.`
        : result.message;
    return {
      ...result,
      context: next.context ?? { pendingDispatch: updated },
      message: continuationMessage,
      nextMessage: this.assistantMessage(next.content, next.actionDraft),
    };
  }

  private mergeDispatchConfirmation(
    actionType: ToriActionPayload['type'],
    result: ToriActionConfirmResponse,
    dispatch: PendingDispatch,
  ): PendingDispatch {
    const next: PendingDispatch = {
      ...dispatch,
      customer: { ...dispatch.customer },
      job: { ...dispatch.job },
      scheduling: { ...dispatch.scheduling },
      technician: dispatch.technician ? { ...dispatch.technician } : undefined,
    };
    if (actionType === 'CREATE_CUSTOMER') {
      next.customer.customerId = result.entityId;
      next.customer.name =
        result.details.find((detail) => detail.label === 'Customer')?.value ??
        next.customer.name;
      next.stage = 'AWAITING_JOB_CONFIRMATION';
    }
    if (actionType === 'CREATE_JOB') {
      next.job.jobId = result.entityId;
      next.job.jobNumber =
        result.details.find((detail) => detail.label === 'Job')?.value ??
        next.job.jobNumber;
      next.job.title =
        result.details.find((detail) => detail.label === 'Title')?.value ??
        next.job.title;
      next.stage = 'AWAITING_APPOINTMENT_CONFIRMATION';
    }
    return next;
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
      context: this.appointmentContext(result.appointment),
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
      context: {
        ...this.appointmentContext(result.appointment),
        recentTechnician: result.appointment.assignedUser
          ? {
              id: result.appointment.assignedUser.id,
              name: this.userLabel(result.appointment.assignedUser),
            }
          : undefined,
      },
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
      context: this.appointmentContext(result.appointment),
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
      context: this.appointmentContext(result.appointment),
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
    const customerName = result.quote.customer?.displayName ?? 'Customer';
    const jobId = result.quote.relatedJobId ?? result.quote.jobId ?? undefined;
    return {
      details: [
        { label: 'Quote', value: result.quote.quoteNumber },
        { label: 'Status', value: result.quote.status },
        { label: 'Total', value: formatAudCents(result.quote.totalCents) },
      ],
      entityId: result.quote.id,
      entityType: 'QUOTE',
      message: 'Draft quote created. It has not been sent.',
      context: {
        customerId: result.quote.customerId,
        customerName,
        jobId,
        quoteId: result.quote.id,
        workflow: {
          customerId: result.quote.customerId,
          customerName,
          jobId,
          rootIntent: 'CREATE_QUOTE',
          state: 'COMPLETED',
          status: 'COMPLETED',
          workflowId: `quote:${result.quote.id}`,
        },
      },
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
    const customerName = result.invoice.customer?.displayName ?? 'Customer';
    return {
      details: [
        { label: 'Invoice', value: result.invoice.invoiceNumber },
        { label: 'Status', value: result.invoice.status },
        { label: 'Total', value: formatAudCents(result.invoice.totalCents) },
      ],
      entityId: result.invoice.id,
      entityType: 'INVOICE',
      message: 'Draft invoice created. It has not been sent.',
      context: {
        customerId: result.invoice.customerId,
        customerName,
        invoiceId: result.invoice.id,
        jobId: result.invoice.jobId ?? undefined,
        quoteId: result.invoice.sourceQuoteId ?? undefined,
        workflow: {
          customerId: result.invoice.customerId,
          customerName,
          jobId: result.invoice.jobId ?? undefined,
          rootIntent: 'CREATE_INVOICE',
          state: 'COMPLETED',
          status: 'COMPLETED',
          workflowId: `invoice:${result.invoice.id}`,
        },
      },
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
        customerEmail: result.customer.email ?? null,
        customerName: result.customer.displayName,
        customerPhone: result.customer.phone ?? null,
        recentCustomer: {
          displayName: result.customer.displayName,
          email: result.customer.email ?? null,
          id: result.customer.id,
          phone: result.customer.phone ?? null,
        },
      },
      status: 'COMPLETED',
    };
  }

  private async confirmCreateJob(
    currentUser: AuthenticatedUser,
    payload: Extract<ToriActionPayload, { type: 'CREATE_JOB' }>,
  ): Promise<ToriActionConfirmResponse> {
    const result = await this.jobs.create(currentUser, payload.jobPayload);
    if (payload.dispatchContext) {
      await this.ensureCustomerSiteFromDispatch(
        currentUser,
        payload.dispatchContext,
      );
    }
    if (payload.resumeAppointment) {
      const context = this.appointmentResumeContextFromCreatedJob(result.job);
      return {
        details: [
          { label: 'Job', value: result.job.jobNumber },
          { label: 'Customer', value: result.job.customer.displayName },
          { label: 'Title', value: result.job.title },
        ],
        entityId: result.job.id,
        entityType: 'JOB',
        message: `Job ${result.job.jobNumber} created for ${result.job.customer.displayName}. Now let's finish the appointment. What date and time should I book it for?`,
        context,
        status: 'COMPLETED',
      };
    }
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

  private async ensureCustomerSiteFromDispatch(
    currentUser: AuthenticatedUser,
    dispatch: PendingDispatch,
  ) {
    const customerId = dispatch.customer.customerId;
    const address = this.dispatchAddress(dispatch.job);
    if (!customerId || !address) return;
    const existingSites = await this.customers.listSites(
      currentUser,
      customerId,
    );
    const alreadyExists = existingSites.some((site) =>
      this.addressesMatch(site, address),
    );
    if (alreadyExists) return;
    await this.customers.createSite(currentUser, customerId, {
      addressLine1: address.addressLine1,
      isPrimary: existingSites.length === 0,
      label: 'Service address',
      postcode: address.postcode,
      state: address.state,
      suburb: address.suburb,
    });
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
    const customerId = job.customer?.id ?? job.customerId;
    const customerName = job.customer?.displayName;
    return {
      customerId,
      customerName,
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
      recentCustomer: customerId
        ? {
            displayName: customerName ?? 'Customer',
            id: customerId,
          }
        : undefined,
      recentJob: {
        customerId,
        customerName,
        id: job.id,
        jobNumber: job.jobNumber,
        title: job.title,
      },
    };
  }

  private appointmentContext(appointment: {
    id: string;
    appointmentNumber?: string;
    jobId?: string | null;
  }): ToriContext {
    return {
      appointmentId: appointment.id,
      jobId: appointment.jobId ?? undefined,
      recentAppointment: {
        appointmentNumber: appointment.appointmentNumber,
        id: appointment.id,
        jobId: appointment.jobId,
      },
    };
  }

  private parseCurrentTurn(text: string, timezone: string): ToriParsedRequest {
    const lower = text.toLowerCase();
    const customer = this.extractCurrentTurnCustomer(text);
    const jobTitle = this.extractCurrentTurnJobTitle(text);
    const location = this.extractAustralianAddressSlot(text);
    const dateTime = this.parseAppointmentDateTimeParts(text, timezone);
    const durationMinutes = this.parseDurationMinutes(text) ?? undefined;
    const daypart = /\bafternoon\b/i.test(text)
      ? 'AFTERNOON'
      : /\bmorning\b/i.test(text)
        ? 'MORNING'
        : undefined;
    const requestAvailable =
      /\bwho\b.*\b(available|free)\b/.test(lower) ||
      /\bavailable\b.*\b(technician|someone|tradie)\b/.test(lower);
    const requestBest = /\b(best|least busy|recommended)\b/.test(lower);
    const createAppointment =
      /\b(create|crea|crete|make|set up|organise|organize|arrange|book(?:ing)?|schedule|scheduling|schedual|send(?:ing)?|assign|get)\b.*\b(appoin?t?ment|appointement|apointment|someone|somone|somebody|technician|tradie|out)\b/.test(
        lower,
      ) ||
      /\bbook(?:ing)?\s+[A-Za-z][A-Za-z\s'-]{1,80}\b/i.test(text) ||
      /\b[A-Za-z][A-Za-z\s'-]{1,80}?\s+needs\s+(?:someone|somone|somebody)\b/i.test(
        text,
      ) ||
      /\bschedule\s+[A-Za-z][A-Za-z\s'-]{1,80}\b/i.test(text) ||
      /\bschedule\s+[A-Za-z][A-Za-z\s'-]{1,80}?'s\b/i.test(text);
    const createCustomer =
      /\b(create|crete|add|new)\b.*\bcustomer\b/.test(lower) ||
      /\bnew customer\b/.test(lower);
    const createJob =
      /\b(create|add|prepare|new)\b.*\b(job|work)\b/.test(lower) ||
      /\bnew job\b/.test(lower);
    const createQuote = this.looksLikeCreateQuote(lower);
    const createInvoice = this.looksLikeCreateInvoice(lower);
    const assignTechnician =
      /\b(assign|send(?:ing)?|book(?:ing)?|schedule|scheduling|schedual|organise|organize|arrange|get)\b.*\b(someone|somone|somebody|technician|tradie|available|best|out)\b/.test(
        lower,
      ) && !requestAvailable;
    const dispatch =
      !requestAvailable &&
      (createAppointment || assignTechnician) &&
      Boolean(customer?.name || customer?.phone || customer?.email) &&
      Boolean(jobTitle || location || dateTime.date || daypart);
    const intents: ToriParsedRequest['intents'] = [];
    if (requestAvailable) intents.push('READ_AVAILABILITY');
    if (/\b(appointment|appointments|schedule|calendar)\b/.test(lower)) {
      intents.push('READ_APPOINTMENTS');
    }
    if (createCustomer) intents.push('CREATE_CUSTOMER');
    if (createJob || jobTitle) intents.push('CREATE_JOB');
    if (createAppointment) intents.push('CREATE_APPOINTMENT');
    if (assignTechnician) intents.push('ASSIGN_TECHNICIAN');
    if (dispatch) intents.push('DISPATCH_JOB');
    if (createQuote) intents.push('CREATE_QUOTE');
    if (createInvoice) intents.push('CREATE_INVOICE');

    return {
      action: {
        assignTechnician,
        createAppointment,
        createCustomer,
        createJob: createJob || Boolean(jobTitle),
        createInvoice,
        createQuote,
        dispatch,
      },
      customer,
      intents: [...new Set(intents)],
      job:
        jobTitle || this.extractJobNumber(text)
          ? {
              issueText: jobTitle,
              jobNumber: this.extractJobNumber(text),
              title: jobTitle,
            }
          : undefined,
      location: location ?? undefined,
      scheduling:
        dateTime.date || dateTime.time || daypart || durationMinutes
          ? {
              date: dateTime.date,
              daypart,
              durationMinutes,
              time: dateTime.time,
            }
          : undefined,
      technician:
        requestAvailable || requestBest
          ? { requestAvailable, requestBest }
          : undefined,
      references: {
        previous: /\b(previous|last|recent)\b/i.test(text),
        thisAppointment: /\b(this|that)\s+appointment\b/i.test(text),
        thisCustomer: /\b(this|that)\s+customer\b/i.test(text),
        thisJob: /\b(this|that)\s+job\b/i.test(text),
      },
      confirmation: this.isPositiveConfirmation(lower)
        ? 'YES'
        : this.isNegativeConfirmation(lower)
          ? 'NO'
          : 'UNKNOWN',
      confidence: customer?.referenceType === 'EXPLICIT' ? 'HIGH' : 'MEDIUM',
    };
  }

  private understandCurrentTurn(
    text: string,
    timezone: string,
  ): ToriParsedRequest {
    return this.parseCurrentTurn(text, timezone);
  }

  private detectWorkflowBoundary(
    parsed: ToriParsedRequest,
    context?: ToriContext,
  ): ToriWorkflowBoundary {
    const previousCustomer =
      context?.pendingDispatch?.customer.name ??
      context?.pendingAppointment?.customerName ??
      context?.pendingJob?.customerName ??
      context?.pendingCustomer?.firstName ??
      context?.customerName ??
      context?.recentCustomer?.displayName;
    const explicitCustomer = parsed.customer?.referenceType === 'EXPLICIT';
    const rootAction = Boolean(
      parsed.action.dispatch ||
      parsed.action.createAppointment ||
      parsed.action.assignTechnician ||
      parsed.action.createCustomer ||
      parsed.action.createJob ||
      parsed.action.createQuote ||
      parsed.action.createInvoice,
    );
    const incompatibleCustomer =
      explicitCustomer &&
      previousCustomer &&
      parsed.customer?.name &&
      !this.namesEquivalent(parsed.customer.name, previousCustomer);
    const newRoot = Boolean(
      rootAction &&
      !parsed.technician?.requestAvailable &&
      (incompatibleCustomer ||
        !this.isPureSlotAnswer(parsed) ||
        context?.workflow?.status === 'COMPLETED'),
    );
    return {
      contextInherited: !newRoot,
      newRoot,
      previousCustomer,
      reason: newRoot
        ? incompatibleCustomer
          ? 'EXPLICIT_CUSTOMER_SWITCH'
          : 'EXPLICIT_ROOT_REQUEST'
        : 'COMPATIBLE_OR_SLOT_TURN',
    };
  }

  private isPureSlotAnswer(parsed: ToriParsedRequest) {
    return Boolean(
      !parsed.customer?.name &&
      !parsed.customer?.phone &&
      !parsed.customer?.email &&
      !parsed.job?.title &&
      !parsed.location &&
      !parsed.action.createAppointment &&
      !parsed.action.dispatch &&
      (parsed.scheduling?.date ||
        parsed.scheduling?.time ||
        parsed.scheduling?.durationMinutes ||
        parsed.scheduling?.daypart),
    );
  }

  private namesEquivalent(a: string, b: string) {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }

  private selectPendingQuestionOption(
    text: string,
    options?: NonNullable<ToriContext['pendingQuestion']>['options'],
  ) {
    if (!options?.length) return null;
    const lower = text.trim().toLowerCase();
    const numeric = lower.match(/\b(\d+)\b/)?.[1];
    const ordinalIndex =
      numeric !== undefined
        ? Number(numeric) - 1
        : /\b(second|two)\b/.test(lower)
          ? 1
          : /\b(third|three)\b/.test(lower)
            ? 2
            : /\b(fourth|four)\b/.test(lower)
              ? 3
              : /\b(first|one)\b/.test(lower)
                ? 0
                : null;
    if (ordinalIndex === null) return null;
    return options[ordinalIndex] ?? null;
  }

  private logToriDecision(
    parsed: ToriParsedRequest,
    boundary: ToriWorkflowBoundary,
    context?: ToriContext,
    lower = '',
  ) {
    if (process.env.TORI_DEBUG !== '1') return;
    const previousExpectedSlot =
      context?.pendingQuestion?.type ?? context?.workflow?.awaitingSlot ?? null;
    const strongRootCommand = this.isStrongRootCommand(parsed, lower);
    const strongMutatingRootCommand = this.isStrongMutatingRootCommand(
      parsed,
      lower,
    );
    console.info('[Tori]', {
      contextInherited: boundary.contextInherited,
      customer: parsed.customer?.name ?? parsed.customer?.phone ?? null,
      currentStep:
        context?.pendingQuestion?.type ??
        context?.workflow?.awaitingSlot ??
        context?.pendingDispatch?.stage ??
        null,
      currentTurnIntent: parsed.intents[0] ?? 'UNKNOWN',
      decision: strongMutatingRootCommand
        ? 'START_NEW_MUTATING_ROOT'
        : strongRootCommand
          ? 'HANDLE_ROOT_OR_READ_INTERRUPTION'
          : boundary.newRoot
            ? 'START_NEW_ROOT'
            : 'CONTINUE_CONTEXT',
      intent: parsed.intents.join(',') || 'UNKNOWN',
      newRoot: boundary.newRoot,
      pendingQuestion: context?.pendingQuestion?.type ?? null,
      previousExpectedSlot,
      previousCustomer: boundary.previousCustomer ?? null,
      previousWorkflow: context?.workflow?.rootIntent ?? null,
      reason: boundary.reason,
      rootIntent: context?.workflow?.rootIntent ?? null,
      slotsMissing: {
        customer: !parsed.customer?.name && !parsed.customer?.phone,
        duration: !parsed.scheduling?.durationMinutes,
        issue: !parsed.job?.title,
        scheduling: !parsed.scheduling?.date,
      },
      strongMutatingRootCommand,
      strongRootCommand,
      workflowId: context?.workflow?.workflowId ?? null,
    });
  }

  private isNewCurrentTurnObjective(parsed: ToriParsedRequest) {
    return Boolean(
      parsed.action.dispatch ||
      (parsed.action.createAppointment &&
        parsed.customer?.referenceType === 'EXPLICIT' &&
        (parsed.job?.title || parsed.scheduling?.date || parsed.customer.name)),
    );
  }

  private isDispatchCreateObjective(parsed: ToriParsedRequest) {
    return Boolean(
      parsed.action.dispatch ||
      (parsed.action.createAppointment &&
        parsed.customer?.referenceType === 'EXPLICIT' &&
        (parsed.job?.title ||
          parsed.location ||
          parsed.scheduling?.date ||
          parsed.customer.name) &&
        !parsed.technician?.requestAvailable),
    );
  }

  private isActionableCurrentTurn(parsed: ToriParsedRequest) {
    return Boolean(
      this.isDispatchCreateObjective(parsed) ||
      parsed.action.createAppointment ||
      parsed.action.createCustomer ||
      parsed.action.createJob ||
      parsed.action.createQuote ||
      parsed.action.createInvoice ||
      parsed.action.assignTechnician,
    );
  }

  private isStrongRootCommand(parsed: ToriParsedRequest, lower: string) {
    return Boolean(
      this.isStrongMutatingRootCommand(parsed, lower) ||
      parsed.technician?.requestAvailable ||
      this.isFinancialQuestion(lower) ||
      /\b(show|list|what|who|how much)\b.*\b(customers?|appointments?|jobs?|quotes?|invoices?|outstanding|available)\b/.test(
        lower,
      ),
    );
  }

  private isStrongMutatingRootCommand(
    parsed: ToriParsedRequest,
    lower: string,
  ) {
    return Boolean(
      this.hasWorkflowSwitchLanguage(lower) ||
      this.isDispatchCreateObjective(parsed) ||
      parsed.action.createAppointment ||
      parsed.action.createCustomer ||
      parsed.action.createJob ||
      parsed.action.createQuote ||
      parsed.action.createInvoice ||
      this.looksLikeExplicitCreateCustomerAndJob(lower) ||
      this.looksLikeCustomerMessage(lower),
    );
  }

  private hasWorkflowSwitchLanguage(lower: string) {
    return /\b(forget that|forget it|cancel this|never mind|nevermind|instead|start over)\b/.test(
      lower,
    );
  }

  private shouldRouteStrongMutatingRootCommandBeforePendingWorkflow(
    parsed: ToriParsedRequest,
    lower: string,
    context?: ToriContext,
  ) {
    if (!this.isStrongMutatingRootCommand(parsed, lower)) return false;
    if (this.hasWorkflowSwitchLanguage(lower)) return true;
    if (context?.workflow?.status === 'COMPLETED') return true;
    if (context?.pendingAppointment) {
      return Boolean(parsed.action.createQuote || parsed.action.createInvoice);
    }
    if (context?.pendingJob) {
      return Boolean(
        parsed.action.createAppointment ||
        parsed.action.createCustomer ||
        parsed.action.createQuote ||
        parsed.action.createInvoice ||
        this.looksLikeExplicitCreateCustomerAndJob(lower),
      );
    }
    return Boolean(
      context?.pendingDispatch ||
      context?.pendingCustomer ||
      context?.pendingCustomerAndJob ||
      context?.pendingQuestion,
    );
  }

  private async routeStrongMutatingRootCommand(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    text: string,
    parsed: ToriParsedRequest,
    request: ToriChatRequest,
  ): Promise<DraftPreparation> {
    const lower = text.toLowerCase();
    if (this.isDispatchCreateObjective(parsed)) {
      return this.startDispatchWorkflow(currentUser, business, text, parsed);
    }
    if (this.looksLikeCustomerMessage(lower)) {
      return this.prepareMessageDraft(
        currentUser,
        business,
        text,
        request.context,
      );
    }
    if (parsed.action.createQuote) {
      return this.prepareQuoteDraft(
        currentUser,
        business,
        text,
        request.context,
      );
    }
    if (parsed.action.createInvoice) {
      const draft = await this.prepareInvoiceDraft(
        currentUser,
        business,
        text,
        request.context,
      );
      return { ...draft, context: request.context };
    }
    if (parsed.action.createAppointment) {
      return this.prepareAppointmentDraft(
        currentUser,
        business,
        text,
        request.context,
      );
    }
    if (this.looksLikeExplicitCreateCustomerAndJob(lower)) {
      return this.prepareCustomerAndJobDraft(
        currentUser,
        business,
        text,
        request,
      );
    }
    if (parsed.action.createCustomer) {
      return this.prepareCustomerDraft(currentUser, text, request);
    }
    if (parsed.action.createJob) {
      return this.prepareJobDraft(currentUser, business, text, request);
    }
    return {
      content: this.unsupportedIntentMessage(),
      context: request.context,
    };
  }

  private isNoAvailabilityRetryTurn(
    parsed: ToriParsedRequest,
    lower: string,
    pending: PendingDispatch,
  ) {
    if (pending.stage !== 'NO_AVAILABILITY') {
      return false;
    }
    return Boolean(
      parsed.scheduling?.date ||
      parsed.scheduling?.daypart ||
      parsed.scheduling?.time ||
      /\b(any time|another time|later|try|afternoon|morning)\b/.test(lower) ||
      /\bwho\b.*\b(available|free)\b/.test(lower),
    );
  }

  private async startDispatchWorkflow(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    text: string,
    parsed = this.parseCurrentTurn(text, business.timezone),
  ): Promise<DraftPreparation> {
    this.assertRole(currentUser, APPOINTMENT_WRITE_ROLES);
    const dispatch = this.dispatchFromParsedRequest(
      text,
      business.timezone,
      parsed,
    );
    return this.continueDispatchWorkflow(currentUser, business, text, dispatch);
  }

  private async answerDispatchPendingQuestion(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    text: string,
    context: ToriContext,
  ): Promise<DraftPreparation> {
    const consumed = await this.consumeDispatchExpectedSlot(
      currentUser,
      business,
      text,
      context,
    );
    if (consumed) return consumed;
    return context.pendingDispatch
      ? this.continueDispatchWorkflow(
          currentUser,
          business,
          text,
          context.pendingDispatch,
        )
      : { content: this.unsupportedIntentMessage(), context };
  }

  private async consumeDispatchExpectedSlot(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    text: string,
    context: ToriContext,
  ): Promise<DraftPreparation | null> {
    const pending = context.pendingDispatch;
    const question = context.pendingQuestion;
    if (!pending || !question || question.intent !== 'DISPATCH_JOB') {
      return null;
    }

    const lower = text.toLowerCase().trim();
    const parsed = this.parseCurrentTurn(text, business.timezone);
    const isSchedulingSlot = [
      'APPOINTMENT_DATE',
      'APPOINTMENT_TIME',
      'APPOINTMENT_DURATION',
    ].includes(question.type);
    if (
      !isSchedulingSlot &&
      question.type !== 'JOB_ADDRESS' &&
      this.looksLikeReadQuestion(lower) &&
      !this.isActionableCurrentTurn(parsed) &&
      !this.parseDurationMinutes(text)
    ) {
      this.logToriSlotConsumption('INTERRUPTION', context, text);
      return {
        content: await this.answerReadQuestion(currentUser, business, text),
        context,
      };
    }

    if (question.type === 'CREATE_MISSING_CUSTOMER') {
      if (this.isPositiveConfirmation(lower)) {
        const dispatch = this.cloneDispatch(pending);
        dispatch.customer.name = question.customerName ?? pending.customer.name;
        this.logToriSlotConsumption('CONSUMED', context, text);
        return this.dispatchAsk(
          dispatch,
          `Sure. I'll prepare ${this.dispatchCustomerName(dispatch)} as a new customer.\nWhat phone number or email should I use?`,
          this.dispatchPendingQuestion(dispatch, 'CUSTOMER_CONTACT', {
            promptPurpose:
              'Collect contact details for a new dispatch customer',
          }),
        );
      }
      if (this.isNegativeConfirmation(lower)) {
        this.logToriSlotConsumption('CONSUMED', context, text);
        return {
          content:
            'Okay. I will not create that customer. No TradieOS data changed.',
          context: this.clearPendingContext(context),
        };
      }
      this.logToriSlotConsumption('INVALID', context, text);
      return this.dispatchAsk(
        pending,
        `Would you like me to create ${question.customerName ?? pending.customer.name} as a customer?`,
        question,
      );
    }

    if (question.type === 'CUSTOMER_CONTACT') {
      const phone = this.extractAustralianPhone(text) ?? undefined;
      const email = text.match(
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
      )?.[0];
      if (!phone && !email) {
        this.logToriSlotConsumption('INVALID', context, text);
        return this.dispatchAsk(
          pending,
          "That doesn't look like a valid phone number or email. Please enter a phone number or email.",
          question,
        );
      }
      const dispatch = this.cloneDispatch(pending);
      dispatch.customer = {
        ...dispatch.customer,
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
      };
      dispatch.stage = 'AWAITING_CUSTOMER_CONFIRMATION';
      this.logToriSlotConsumption('CONSUMED', context, text);
      return this.dispatchCustomerDraft(dispatch);
    }

    if (question.type === 'JOB_TITLE') {
      const title = this.cleanJobTitleSlot(text);
      if (!title) {
        this.logToriSlotConsumption('INVALID', context, text);
        return this.dispatchAsk(
          pending,
          'That does not look like a job description I can use. What is the job for?',
          question,
        );
      }
      const dispatch = this.cloneDispatch(pending);
      dispatch.job = { ...dispatch.job, description: title, title };
      this.logToriSlotConsumption('CONSUMED', context, text);
      return this.continueDispatchWorkflow(currentUser, business, '', dispatch);
    }

    if (question.type === 'JOB_ADDRESS') {
      if (pending.job.proposedAddress && this.isPositiveConfirmation(lower)) {
        const dispatch = this.cloneDispatch(pending);
        dispatch.job = {
          ...dispatch.job,
          addressLine1: pending.job.proposedAddress.addressLine1,
          postcode: pending.job.proposedAddress.postcode,
          proposedAddress: undefined,
          state: pending.job.proposedAddress.state,
          suburb: pending.job.proposedAddress.suburb,
        };
        this.logToriSlotConsumption('CONSUMED', context, text);
        return this.continueDispatchWorkflow(
          currentUser,
          business,
          '',
          dispatch,
        );
      }
      const addressResult = this.parseAustralianAddressSlot(text);
      if (addressResult.status === 'STATE_POSTCODE_CONFLICT') {
        this.logToriSlotConsumption('INVALID', context, text);
        return this.dispatchAsk(pending, addressResult.message, question);
      }
      if (addressResult.status === 'INVALID') {
        this.logToriSlotConsumption('INVALID', context, text);
        return this.dispatchAsk(
          pending,
          'That does not look like a service address. Please send the street, suburb, state if known, and postcode.',
          question,
        );
      }
      const dispatch = this.cloneDispatch(pending);
      dispatch.job = { ...dispatch.job, ...addressResult.address };
      this.logToriSlotConsumption('CONSUMED', context, text);
      return this.continueDispatchWorkflow(currentUser, business, '', dispatch);
    }

    if (question.type === 'APPOINTMENT_DATE') {
      if (!parsed.scheduling?.date && !parsed.scheduling?.daypart) {
        this.logToriSlotConsumption('INVALID', context, text);
        return this.dispatchAsk(
          pending,
          'When should I book this job? For example tomorrow morning or 20 August at 2pm.',
          question,
        );
      }
      const dispatch = this.cloneDispatch(pending);
      dispatch.scheduling = {
        ...dispatch.scheduling,
        ...this.dispatchSchedulingUpdateFromCurrent(
          parsed,
          dispatch.scheduling,
          business.timezone,
        ),
      };
      this.logToriSlotConsumption('CONSUMED', context, text);
      return this.continueDispatchWorkflow(currentUser, business, '', dispatch);
    }

    if (question.type === 'APPOINTMENT_TIME') {
      const time =
        this.parseTimeString(text) ??
        this.parseWordTimeString(text) ??
        undefined;
      if (!time) {
        this.logToriSlotConsumption('INVALID', context, text);
        return this.dispatchAsk(
          pending,
          'What start time should I use? For example 10am, 2pm or around two.',
          question,
        );
      }
      const dispatch = this.cloneDispatch(pending);
      dispatch.scheduling = {
        ...this.dispatchSchedulingUpdateFromCurrent(
          { ...parsed, scheduling: { ...parsed.scheduling, time } },
          dispatch.scheduling,
          business.timezone,
        ),
      };
      this.logToriSlotConsumption('CONSUMED', context, text);
      return this.continueDispatchWorkflow(currentUser, business, '', dispatch);
    }

    if (question.type === 'APPOINTMENT_DURATION') {
      const duration = this.parseDurationMinutes(text);
      if (!duration || duration < 15 || duration > 12 * 60) {
        this.logToriSlotConsumption('INVALID', context, text);
        return this.dispatchAsk(
          pending,
          'How long should I allow for the job? For example 45 mins, about an hour, or 90 minutes.',
          question,
        );
      }
      const dispatch = this.cloneDispatch(pending);
      dispatch.scheduling = {
        ...dispatch.scheduling,
        durationMinutes: duration,
      };
      this.logToriSlotConsumption('CONSUMED', context, text);
      return this.continueDispatchWorkflow(currentUser, business, '', dispatch);
    }

    if (question.type === 'JOB_SELECTION') {
      const selected = this.selectPendingQuestionOption(text, question.options);
      if (!selected?.value || typeof selected.value !== 'object') {
        this.logToriSlotConsumption('INVALID', context, text);
        return this.dispatchAsk(
          pending,
          'Which job should I book? Reply with the number, such as 1 or 2.',
          question,
        );
      }
      const value = selected.value as {
        addressLine1?: string | null;
        id?: string;
        jobNumber?: string;
        postcode?: string | null;
        state?: string | null;
        suburb?: string | null;
        title?: string;
      };
      const dispatch = this.cloneDispatch(pending);
      dispatch.job = {
        ...dispatch.job,
        addressLine1: value.addressLine1 ?? undefined,
        description: value.title,
        jobId: value.id,
        jobNumber: value.jobNumber,
        postcode: value.postcode ?? undefined,
        state:
          value.state && this.isAustralianState(value.state)
            ? value.state
            : undefined,
        suburb: value.suburb ?? undefined,
        title: value.title,
      };
      this.logToriSlotConsumption('CONSUMED', context, text);
      return this.continueDispatchWorkflow(currentUser, business, '', dispatch);
    }

    return null;
  }

  private async continueDispatchWorkflow(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    text: string,
    pending: PendingDispatch,
  ): Promise<DraftPreparation> {
    const duration = this.parseDurationMinutes(text);
    const dispatch: PendingDispatch = {
      ...pending,
      customer: { ...pending.customer },
      job: { ...pending.job },
      scheduling: {
        ...pending.scheduling,
        ...(duration ? { durationMinutes: duration } : {}),
      },
      technician: pending.technician ? { ...pending.technician } : undefined,
    };

    const current = this.parseCurrentTurn(text, business.timezone);
    if (
      dispatch.stage === 'NO_AVAILABILITY' &&
      current.confirmation === 'YES' &&
      !current.scheduling?.date &&
      !current.scheduling?.daypart &&
      !current.scheduling?.time
    ) {
      return {
        content:
          'Sure. Would you like me to check tomorrow afternoon, another time tomorrow, or another date?',
        context: {
          pendingChoice: {
            options: [
              'TOMORROW_AFTERNOON',
              'ANOTHER_TIME_TOMORROW',
              'ANOTHER_DATE',
            ],
            type: 'ALTERNATIVE_AVAILABILITY',
          },
          pendingDispatch: dispatch,
          workflow: this.dispatchWorkflowContext(dispatch),
        },
      };
    }
    if (
      this.isPositiveConfirmation(text.toLowerCase()) &&
      dispatch.job.proposedAddress
    ) {
      dispatch.job = {
        ...dispatch.job,
        addressLine1: dispatch.job.proposedAddress.addressLine1,
        postcode: dispatch.job.proposedAddress.postcode,
        proposedAddress: undefined,
        state: dispatch.job.proposedAddress.state,
        suburb: dispatch.job.proposedAddress.suburb,
      };
    }
    const currentAddress =
      current.location ?? this.extractAustralianAddressSlot(text);
    if (currentAddress) {
      dispatch.job = { ...dispatch.job, ...currentAddress };
    }
    if (current.customer?.name) {
      dispatch.customer = {
        ...dispatch.customer,
        name: current.customer.name,
      };
    }
    if (current.customer?.phone || current.customer?.email) {
      dispatch.customer = {
        ...dispatch.customer,
        ...(current.customer.email ? { email: current.customer.email } : {}),
        ...(current.customer.phone ? { phone: current.customer.phone } : {}),
      };
    }
    if (current.job?.title) {
      dispatch.job = {
        ...dispatch.job,
        description: current.job.issueText ?? current.job.title,
        title: current.job.title,
      };
    }
    if (
      current.scheduling?.date ||
      current.scheduling?.daypart ||
      current.scheduling?.time
    ) {
      dispatch.scheduling = {
        ...dispatch.scheduling,
        ...this.dispatchSchedulingUpdateFromCurrent(
          current,
          dispatch.scheduling,
          business.timezone,
        ),
      };
    }

    if (!dispatch.customer.name && !dispatch.customer.customerId) {
      return this.dispatchAsk(
        dispatch,
        'Who is the customer for this dispatch?',
      );
    }
    const customerResolution = await this.resolveDispatchCustomer(
      currentUser.businessId,
      dispatch,
    );
    if (customerResolution.ambiguous) {
      return this.dispatchAsk(dispatch, customerResolution.message);
    }
    if (customerResolution.customer) {
      dispatch.customer.customerId = customerResolution.customer.id;
      dispatch.customer.name = customerResolution.customer.displayName;
    } else if (
      dispatch.customer.name &&
      !dispatch.customer.phone &&
      !dispatch.customer.email
    ) {
      return this.dispatchAsk(
        dispatch,
        `I couldn't find a customer named ${dispatch.customer.name}. Would you like me to create the customer?`,
        {
          customerName: dispatch.customer.name,
          intent: 'DISPATCH_JOB',
          promptPurpose:
            'Confirm whether to create a missing dispatch customer',
          subjectName: dispatch.customer.name,
          type: 'CREATE_MISSING_CUSTOMER',
          workflowId: this.dispatchWorkflowContext(dispatch).workflowId,
        },
      );
    }
    const filledDispatch = await this.fillDispatchFromCustomerAndJob(
      currentUser.businessId,
      dispatch,
    );
    dispatch.customer = filledDispatch.customer;
    dispatch.job = filledDispatch.job;
    dispatch.scheduling = filledDispatch.scheduling;
    dispatch.technician = filledDispatch.technician;
    if (
      !dispatch.customer.phone &&
      !dispatch.customer.email &&
      !dispatch.customer.customerId
    ) {
      return this.dispatchAsk(
        dispatch,
        'What phone number or email should I use for the customer?',
        {
          customerName: dispatch.customer.name,
          intent: 'DISPATCH_JOB',
          promptPurpose: 'Collect contact details for a new dispatch customer',
          subjectName: dispatch.customer.name,
          type: 'CUSTOMER_CONTACT',
          workflowId: this.dispatchWorkflowContext(dispatch).workflowId,
        },
      );
    }
    if (
      !dispatch.customer.customerId &&
      (dispatch.customer.phone || dispatch.customer.email) &&
      !dispatch.job.title &&
      !this.dispatchAddress(dispatch.job) &&
      !dispatch.scheduling.date &&
      !dispatch.scheduling.windowStart
    ) {
      dispatch.stage = 'AWAITING_CUSTOMER_CONFIRMATION';
      return this.dispatchCustomerDraft(dispatch);
    }
    if (!dispatch.job.title && dispatch.customer.customerId) {
      const activeJobs = await this.activeJobsForDispatchCustomer(
        currentUser.businessId,
        dispatch.customer.customerId,
      );
      if (activeJobs.length === 1) {
        const [job] = activeJobs;
        dispatch.job = {
          ...dispatch.job,
          addressLine1: job.addressLine1,
          description: job.title,
          jobId: job.id,
          jobNumber: job.jobNumber,
          postcode: job.postcode,
          state: job.state,
          suburb: job.suburb,
          title: job.title,
        };
      } else if (activeJobs.length > 1) {
        const choices = activeJobs
          .map((job, index) => `${index + 1}. ${job.jobNumber} — ${job.title}`)
          .join('\n');
        return this.dispatchAsk(
          dispatch,
          `I found ${dispatch.customer.name}, and they have multiple active jobs:\n${choices}\n\nWhich job should I book?`,
          {
            intent: 'DISPATCH_JOB',
            options: activeJobs.map((job, index) => ({
              id: job.id,
              label: `${index + 1}. ${job.jobNumber} — ${job.title}`,
              value: {
                addressLine1: job.addressLine1,
                id: job.id,
                jobNumber: job.jobNumber,
                postcode: job.postcode,
                state: job.state,
                suburb: job.suburb,
                title: job.title,
              },
            })),
            promptPurpose: 'Choose which active job to schedule',
            subjectId: dispatch.customer.customerId,
            subjectName: dispatch.customer.name,
            type: 'JOB_SELECTION',
            workflowId: this.dispatchWorkflowContext(dispatch).workflowId,
          },
        );
      }
    }
    if (!dispatch.job.title) {
      return this.dispatchAsk(
        dispatch,
        'What is the job for?',
        this.dispatchPendingQuestion(dispatch, 'JOB_TITLE', {
          promptPurpose: 'Collect the dispatch job description',
        }),
      );
    }
    const address = this.dispatchAddress(dispatch.job);
    if (!address) {
      const customerLocationQuestion =
        await this.dispatchCustomerLocationQuestion(
          currentUser.businessId,
          dispatch,
        );
      return this.dispatchAsk(
        dispatch,
        customerLocationQuestion ??
          'What is the full service address for this job, including suburb and postcode?',
        this.dispatchPendingQuestion(dispatch, 'JOB_ADDRESS', {
          promptPurpose: 'Collect the dispatch service location',
        }),
      );
    }
    if (!dispatch.scheduling.date || !dispatch.scheduling.windowStart) {
      return this.dispatchAsk(
        dispatch,
        'When should I book this job?',
        this.dispatchPendingQuestion(dispatch, 'APPOINTMENT_DATE', {
          promptPurpose: 'Collect the dispatch appointment date or time window',
        }),
      );
    }
    const shouldCreateJobBeforeSchedulingDetails = Boolean(
      dispatch.customer.customerId && !dispatch.job.jobId && dispatch.job.title,
    );
    const needsSpecificTime = Boolean(
      dispatch.scheduling.date &&
      !dispatch.scheduling.daypart &&
      !dispatch.scheduling.preferredStart &&
      dispatch.stage !== 'NO_AVAILABILITY',
    );
    if (needsSpecificTime && dispatch.job.jobId) {
      dispatch.stage = 'AWAITING_DURATION';
      const [year, month, day] = dispatch.scheduling.date
        .split('-')
        .map(Number);
      const date = zonedTimeToUtc(
        { day, hour: 0, minute: 0, month, year },
        business.timezone,
      );
      return this.dispatchAsk(
        dispatch,
        `What time on ${formatBusinessDate(date, business.timezone)}?`,
        this.dispatchPendingQuestion(dispatch, 'APPOINTMENT_TIME', {
          promptPurpose: 'Collect the dispatch appointment start time',
        }),
      );
    }
    if (!dispatch.scheduling.durationMinutes) {
      dispatch.stage = 'AWAITING_DURATION';
      if (!shouldCreateJobBeforeSchedulingDetails) {
        return this.dispatchAsk(
          dispatch,
          [
            'I can prepare that dispatch.',
            '',
            `Customer: ${dispatch.customer.name}`,
            dispatch.customer.phone
              ? `Phone: ${dispatch.customer.phone}`
              : null,
            `Job: ${dispatch.job.title}`,
            `Location: ${this.dispatchAddressLabel(dispatch.job)}`,
            `Requested: ${this.dispatchRequestedLabel(dispatch, business.timezone)}`,
            '',
            'How long should I allow for the job?',
          ]
            .filter((line): line is string => line !== null)
            .join('\n'),
          this.dispatchPendingQuestion(dispatch, 'APPOINTMENT_DURATION', {
            promptPurpose: 'Collect the dispatch appointment duration',
          }),
        );
      }
    }

    this.ensureDispatchPreferredTimeWindow(dispatch, business.timezone);

    if (!dispatch.customer.customerId) {
      dispatch.stage = 'AWAITING_CUSTOMER_CONFIRMATION';
      return this.dispatchCustomerDraft(dispatch);
    }

    if (!dispatch.job.jobId) {
      dispatch.stage = 'AWAITING_JOB_CONFIRMATION';
      const jobPayload = this.dispatchJobPayload(dispatch, business.timezone);
      const draft = this.actionDraft({
        description: `Create a job for ${this.dispatchCustomerName(dispatch)}.`,
        entityId: null,
        entityType: 'JOB',
        payload: {
          dispatchContext: dispatch,
          jobPayload,
          type: 'CREATE_JOB',
        },
        proposedChanges: [
          { label: 'Customer', to: this.dispatchCustomerName(dispatch) },
          { label: 'Job', to: dispatch.job.title ?? 'Job' },
          { label: 'Service location', to: this.addressLabel(address) },
          {
            label: 'Requested',
            to: this.dispatchRequestedLabel(dispatch, business.timezone),
          },
        ],
        title: 'Create job',
        validationState: 'READY',
        warnings: [
          'This creates a job only. It will not create an appointment yet.',
        ],
      });
      return {
        actionDraft: draft,
        content:
          'I prepared the job draft for this dispatch. Confirm it and I’ll check technician availability.',
        context: this.dispatchContext(dispatch),
      };
    }

    const recommendation = await this.recommendDispatchAppointment(
      currentUser,
      business,
      dispatch,
    );
    if (!recommendation) {
      dispatch.stage = 'NO_AVAILABILITY';
      return {
        content: [
          `No technician can fit a ${dispatch.scheduling.durationMinutes}-minute appointment ${this.dispatchRequestedLabel(dispatch, business.timezone)}.`,
          '',
          'I can check:',
          '• tomorrow afternoon',
          '• another time tomorrow',
          '• another date',
        ].join('\n'),
        context: {
          ...this.dispatchContext(dispatch),
          pendingChoice: {
            options: [
              'TOMORROW_AFTERNOON',
              'ANOTHER_TIME_TOMORROW',
              'ANOTHER_DATE',
            ],
            type: 'ALTERNATIVE_AVAILABILITY',
          },
        },
      };
    }

    dispatch.stage = 'AWAITING_APPOINTMENT_CONFIRMATION';
    dispatch.technician = {
      reason: recommendation.reason,
      recommendedEnd: recommendation.scheduledEnd.toISOString(),
      recommendedStart: recommendation.scheduledStart.toISOString(),
      technicianId: recommendation.technicianId,
      technicianName: recommendation.technicianName,
    };
    const appointmentPayload = this.dispatchAppointmentPayload(
      dispatch,
      recommendation,
    );
    const draft = this.actionDraft({
      description: `Book ${dispatch.job.title} for ${this.dispatchCustomerName(dispatch)} with ${recommendation.technicianName}.`,
      entityId: null,
      entityType: 'APPOINTMENT',
      payload: {
        appointmentPayload,
        dispatchContext: dispatch,
        type: 'CREATE_APPOINTMENT',
      },
      proposedChanges: [
        { label: 'Customer', to: this.dispatchCustomerName(dispatch) },
        { label: 'Job', to: dispatch.job.title ?? 'Job' },
        {
          label: 'Time',
          to: formatBusinessTimeRange(
            recommendation.scheduledStart,
            recommendation.scheduledEnd,
            business.timezone,
          ),
        },
        { label: 'Technician', to: recommendation.technicianName },
        { label: 'Reason', to: recommendation.reason },
      ],
      title: 'Book dispatch appointment',
      validationState: 'READY',
      warnings: [],
    });
    return {
      actionDraft: draft,
      content: `${recommendation.technicianName} is available from ${formatBusinessTimeRange(
        recommendation.scheduledStart,
        recommendation.scheduledEnd,
        business.timezone,
      )} and has no conflict. Confirm this draft to book and assign ${recommendation.technicianName}.`,
      context: this.dispatchContext(dispatch),
    };
  }

  private dispatchAsk(
    dispatch: PendingDispatch,
    content: string,
    pendingQuestion?: ToriContext['pendingQuestion'],
  ): DraftPreparation {
    return {
      content,
      context: {
        ...this.dispatchContext(dispatch),
        ...(pendingQuestion ? { pendingQuestion } : {}),
      },
    };
  }

  private dispatchPendingQuestion(
    dispatch: PendingDispatch,
    type: NonNullable<ToriContext['pendingQuestion']>['type'],
    overrides: Partial<NonNullable<ToriContext['pendingQuestion']>> = {},
  ): NonNullable<ToriContext['pendingQuestion']> {
    return {
      customerName: dispatch.customer.name,
      intent: 'DISPATCH_JOB',
      subjectId: dispatch.customer.customerId ?? dispatch.job.jobId,
      subjectName:
        dispatch.job.title ?? dispatch.customer.name ?? 'Dispatch workflow',
      type,
      workflowId: this.dispatchWorkflowContext(dispatch).workflowId,
      ...overrides,
    };
  }

  private cloneDispatch(dispatch: PendingDispatch): PendingDispatch {
    return {
      ...dispatch,
      customer: { ...dispatch.customer },
      job: {
        ...dispatch.job,
        proposedAddress: dispatch.job.proposedAddress
          ? { ...dispatch.job.proposedAddress }
          : undefined,
      },
      scheduling: { ...dispatch.scheduling },
      technician: dispatch.technician ? { ...dispatch.technician } : undefined,
    };
  }

  private logToriSlotConsumption(
    result: 'CONSUMED' | 'INTERRUPTION' | 'INVALID',
    context: ToriContext,
    text: string,
  ) {
    if (process.env.TORI_DEBUG !== '1') return;
    console.info('[Tori slot]', {
      awaitingSlot: context.workflow?.awaitingSlot ?? null,
      currentStep:
        context.pendingQuestion?.type ??
        context.workflow?.awaitingSlot ??
        context.pendingDispatch?.stage ??
        null,
      customerId: context.pendingDispatch?.customer.customerId ?? null,
      jobId: context.pendingDispatch?.job.jobId ?? null,
      pendingQuestion: context.pendingQuestion?.type ?? null,
      requestedDate: context.pendingDispatch?.scheduling.date ?? null,
      requestedDuration:
        context.pendingDispatch?.scheduling.durationMinutes ?? null,
      requestedTime: context.pendingDispatch?.scheduling.preferredStart ?? null,
      result,
      rootIntent: context.workflow?.rootIntent ?? null,
      textLength: text.length,
      workflowId: context.workflow?.workflowId ?? null,
    });
  }

  private dispatchCustomerDraft(dispatch: PendingDispatch): DraftPreparation {
    const customerPayload = this.dispatchCustomerPayload(dispatch);
    const draft = this.actionDraft({
      description: `Create customer ${customerPayload.firstName ?? customerPayload.companyName}.`,
      entityId: null,
      entityType: 'CUSTOMER',
      payload: {
        customerPayload,
        dispatchContext: dispatch,
        type: 'CREATE_CUSTOMER',
      },
      proposedChanges: [
        { label: 'Customer', to: this.dispatchCustomerName(dispatch) },
        ...(dispatch.customer.phone
          ? [{ label: 'Phone', to: dispatch.customer.phone }]
          : []),
        ...(dispatch.customer.email
          ? [{ label: 'Email', to: dispatch.customer.email }]
          : []),
      ],
      title: 'Create customer',
      validationState: 'READY',
      warnings: [],
    });
    return {
      actionDraft: draft,
      content:
        'I prepared the customer draft for this dispatch. Confirm it and I’ll continue with the job.',
      context: this.dispatchContext(dispatch),
    };
  }

  private dispatchContext(dispatch: PendingDispatch): ToriContext {
    return {
      pendingDispatch: dispatch,
      workflow: this.dispatchWorkflowContext(dispatch),
    };
  }

  private dispatchWorkflowContext(
    dispatch: PendingDispatch,
  ): NonNullable<ToriContext['workflow']> {
    return {
      awaitingSlot: this.dispatchAwaitingSlot(dispatch),
      customerId: dispatch.customer.customerId,
      customerName: dispatch.customer.name,
      jobId: dispatch.job.jobId,
      rootIntent: 'DISPATCH_JOB',
      state: dispatch.stage,
      status: 'ACTIVE',
      workflowId: [
        'dispatch',
        dispatch.customer.customerId ??
          dispatch.customer.name ??
          'unknown-customer',
        dispatch.job.jobId ?? dispatch.job.title ?? 'unknown-job',
      ]
        .join(':')
        .toLowerCase()
        .replace(/[^a-z0-9:-]+/g, '-'),
    };
  }

  private dispatchAwaitingSlot(dispatch: PendingDispatch) {
    if (!dispatch.customer.name && !dispatch.customer.customerId)
      return 'CUSTOMER';
    if (!dispatch.job.title) return 'JOB';
    if (!this.dispatchAddress(dispatch.job)) return 'SERVICE_LOCATION';
    if (!dispatch.scheduling.date || !dispatch.scheduling.windowStart) {
      return 'DATE';
    }
    if (!dispatch.scheduling.durationMinutes) return 'DURATION';
    if (dispatch.stage === 'NO_AVAILABILITY') return 'ALTERNATIVE_AVAILABILITY';
    if (dispatch.stage === 'AWAITING_JOB_CONFIRMATION')
      return 'JOB_CONFIRMATION';
    if (dispatch.stage === 'AWAITING_APPOINTMENT_CONFIRMATION') {
      return 'APPOINTMENT_CONFIRMATION';
    }
    return undefined;
  }

  private dispatchFromParsedRequest(
    text: string,
    timezone: string,
    parsed = this.parseCurrentTurn(text, timezone),
  ): PendingDispatch {
    const phone =
      parsed.customer?.phone ?? this.extractAustralianPhone(text) ?? undefined;
    const email =
      parsed.customer?.email ??
      text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0];
    const address =
      parsed.location ?? this.extractDispatchAddress(text) ?? undefined;
    const scheduling = this.dispatchSchedulingFromParsed(parsed, timezone);
    const title =
      parsed.job?.title ?? this.extractDispatchJobTitle(text, parsed) ?? '';
    return {
      customer: {
        email,
        name: parsed.customer?.name ?? this.extractDispatchCustomerName(text),
        phone,
      },
      job: {
        ...(address ?? {}),
        description: parsed.job?.issueText ?? title,
        title,
      },
      scheduling,
      stage: 'AWAITING_DURATION',
    };
  }

  private dispatchCustomerPayload(dispatch: PendingDispatch): CustomerPayload {
    const name = this.dispatchCustomerName(dispatch);
    const [firstName, ...lastName] = name.split(/\s+/);
    return {
      ...(dispatch.customer.email ? { email: dispatch.customer.email } : {}),
      ...(firstName ? { firstName } : {}),
      ...(lastName.length ? { lastName: lastName.join(' ') } : {}),
      ...(dispatch.customer.phone ? { phone: dispatch.customer.phone } : {}),
      contactPreference: dispatch.customer.phone ? 'PHONE' : 'EMAIL',
      customerType: 'RESIDENTIAL',
    };
  }

  private dispatchJobPayload(
    dispatch: PendingDispatch,
    timezone: string,
  ): JobPayload {
    const address = this.dispatchAddress(dispatch.job);
    if (!address || !dispatch.customer.customerId) {
      throw this.domainError(
        'TORI_DISPATCH_INCOMPLETE',
        'This dispatch is missing customer or address details.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return {
      ...address,
      customerId: dispatch.customer.customerId,
      customerNotes: 'Prepared by Tori dispatch. Review before scheduling.',
      description:
        dispatch.job.description ?? dispatch.job.title ?? 'Service job',
      estimatedDurationMinutes: null,
      priority: 'NORMAL',
      requiresInvoice: false,
      requiresQuote: false,
      scheduledEnd: null,
      scheduledStart: this.defaultJobStart(timezone),
      status: 'NEW',
      title: dispatch.job.title ?? 'Service job',
      tradeType: this.extractTradeType(dispatch.job.title ?? ''),
    };
  }

  private dispatchAppointmentPayload(
    dispatch: PendingDispatch,
    recommendation: NonNullable<DispatchAvailabilityRecommendation>,
  ): AppointmentPayload {
    const address = this.dispatchAddress(dispatch.job);
    if (!address || !dispatch.job.jobId) {
      throw this.domainError(
        'TORI_DISPATCH_INCOMPLETE',
        'This dispatch is missing job or address details.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return {
      ...address,
      appointmentType: 'MAINTENANCE',
      assignedUserId: recommendation.technicianId,
      customerSiteId: null,
      estimatedDurationMinutes: dispatch.scheduling.durationMinutes ?? 60,
      jobId: dispatch.job.jobId,
      locationSource: 'MANUAL',
      scheduledEnd: recommendation.scheduledEnd.toISOString(),
      scheduledStart: recommendation.scheduledStart.toISOString(),
    };
  }

  private async resolveDispatchCustomer(
    businessId: string,
    dispatch: PendingDispatch,
  ): Promise<{
    ambiguous: boolean;
    customer: CustomerMatch | null;
    message: string;
  }> {
    if (dispatch.customer.customerId) {
      const resolved = await this.resolveCustomerForJob(
        businessId,
        dispatch.customer.name,
        dispatch.customer.customerId,
      );
      return {
        ambiguous: false,
        customer: resolved.match,
        message: resolved.message,
      };
    }
    const phone = dispatch.customer.phone
      ? this.normalisePhone(dispatch.customer.phone)
      : null;
    const email = dispatch.customer.email?.trim().toLowerCase();
    if (!phone && !email) {
      if (!dispatch.customer.name) {
        return { ambiguous: false, customer: null, message: '' };
      }
      const byName = await this.resolveCustomerForJob(
        businessId,
        dispatch.customer.name,
      );
      return {
        ambiguous: byName.message.startsWith('I found '),
        customer: byName.match,
        message: byName.message,
      };
    }
    const matches = await this.prisma.customer.findMany({
      where: {
        businessId,
        isArchived: false,
        OR: [
          ...(phone ? [{ phoneNormalised: phone }] : []),
          ...(email ? [{ emailNormalised: email }] : []),
        ],
      },
      include: { sites: { where: { isArchived: false } } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });
    if (matches.length === 1) {
      return { ambiguous: false, customer: matches[0], message: '' };
    }
    if (matches.length > 1) {
      return {
        ambiguous: true,
        customer: null,
        message:
          'I found multiple customers with that contact detail. Which customer should I use?',
      };
    }
    return { ambiguous: false, customer: null, message: '' };
  }

  private async fillDispatchFromCustomerAndJob(
    businessId: string,
    dispatch: PendingDispatch,
  ) {
    if (!dispatch.customer.customerId) return dispatch;
    const customer = await this.resolveCustomerForJob(
      businessId,
      dispatch.customer.name,
      dispatch.customer.customerId,
    );
    const next: PendingDispatch = {
      ...dispatch,
      customer: { ...dispatch.customer },
      job: { ...dispatch.job },
      scheduling: { ...dispatch.scheduling },
      technician: dispatch.technician ? { ...dispatch.technician } : undefined,
    };
    if (customer.match) {
      next.customer.name = customer.match.displayName;
      const site = this.singleUsableSite(customer.match.sites);
      if (
        site &&
        !next.job.addressLine1 &&
        site.addressLine1 &&
        site.suburb &&
        this.isAustralianState(site.state) &&
        site.postcode
      ) {
        next.job.addressLine1 = site.addressLine1;
        next.job.suburb = site.suburb;
        next.job.state = site.state;
        next.job.postcode = site.postcode;
      }
      if (
        !site &&
        !next.job.addressLine1 &&
        this.hasCompleteAddress(customer.match)
      ) {
        next.job.addressLine1 = customer.match.addressLine1;
        next.job.suburb = customer.match.suburb;
        next.job.state = customer.match.state;
        next.job.postcode = customer.match.postcode;
      }
      if (!next.job.addressLine1 && !next.job.proposedAddress) {
        const historicalAddress = await this.uniqueHistoricalJobAddress(
          businessId,
          customer.match.id,
        );
        if (historicalAddress.kind === 'single') {
          next.job.proposedAddress = {
            ...historicalAddress.address,
            source: 'HISTORICAL_JOB',
          };
        }
      }
    }
    if (!next.job.jobId && next.job.title) {
      const matchingJob = await this.findMatchingActiveJobForDispatch(
        businessId,
        next.customer.customerId,
        next.job.title,
      );
      if (matchingJob) {
        next.job.jobId = matchingJob.id;
        next.job.jobNumber = matchingJob.jobNumber;
        next.job.title = matchingJob.title;
        next.job.description = matchingJob.title;
        if (!next.job.addressLine1) {
          next.job.addressLine1 = matchingJob.addressLine1;
          next.job.suburb = matchingJob.suburb;
          next.job.state = matchingJob.state;
          next.job.postcode = matchingJob.postcode;
        }
      }
    }
    return next;
  }

  private async activeJobsForDispatchCustomer(
    businessId: string,
    customerId: string,
  ) {
    return this.prisma.job.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 5,
      where: {
        businessId,
        customerId,
        isArchived: false,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
    });
  }

  private async dispatchCustomerLocationQuestion(
    businessId: string,
    dispatch: PendingDispatch,
  ) {
    if (!dispatch.customer.customerId) return null;
    const customer = await this.resolveCustomerForJob(
      businessId,
      dispatch.customer.name,
      dispatch.customer.customerId,
    );
    if (!customer.match) return null;
    if (this.singleUsableSite(customer.match.sites)) return null;
    if (this.hasCompleteAddress(customer.match)) return null;
    if (dispatch.job.proposedAddress) {
      return `I found ${this.addressLabel(dispatch.job.proposedAddress)} from ${customer.match.displayName}'s previous job. Use this address?`;
    }
    if (customer.match.sites.length > 1) {
      const choices = customer.match.sites
        .map(
          (site, index) =>
            `${index + 1}. ${this.addressLabel({
              addressLine1: site.addressLine1,
              postcode: site.postcode,
              state: site.state as AustralianState,
              suburb: site.suburb,
            })}`,
        )
        .join('\n');
      return `${customer.match.displayName} has multiple service locations:\n${choices}\n\nWhich location is this job for?`;
    }
    const historicalAddress = await this.uniqueHistoricalJobAddress(
      businessId,
      customer.match.id,
    );
    if (historicalAddress.kind === 'multiple') {
      const choices = historicalAddress.addresses
        .map(
          (address, index) =>
            `${index + 1}. ${this.addressLabel({
              addressLine1: address.addressLine1,
              postcode: address.postcode,
              state: address.state,
              suburb: address.suburb,
            })}`,
        )
        .join('\n');
      return `I found multiple previous job addresses for ${customer.match.displayName}:\n${choices}\n\nWhich location is this job for?`;
    }
    return null;
  }

  private async uniqueHistoricalJobAddress(
    businessId: string,
    customerId: string,
  ): Promise<
    | { kind: 'none' }
    | {
        kind: 'single';
        address: {
          addressLine1: string;
          suburb: string;
          state: AustralianState;
          postcode: string;
        };
      }
    | {
        kind: 'multiple';
        addresses: Array<{
          addressLine1: string;
          suburb: string;
          state: AustralianState;
          postcode: string;
        }>;
      }
  > {
    const jobs = await this.prisma.job.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        addressLine1: true,
        postcode: true,
        state: true,
        suburb: true,
      },
      take: 10,
      where: {
        businessId,
        customerId,
        isArchived: false,
      },
    });
    const unique = new Map<
      string,
      {
        addressLine1: string;
        suburb: string;
        state: AustralianState;
        postcode: string;
      }
    >();
    for (const job of jobs) {
      if (!this.hasCompleteAddress(job) || !this.isAustralianState(job.state)) {
        continue;
      }
      const state = job.state;
      const address = {
        addressLine1: job.addressLine1,
        postcode: job.postcode,
        state,
        suburb: job.suburb,
      };
      unique.set(this.addressKey(address), address);
    }
    const addresses = [...unique.values()];
    if (addresses.length === 1)
      return { address: addresses[0], kind: 'single' };
    if (addresses.length > 1) return { addresses, kind: 'multiple' };
    return { kind: 'none' };
  }

  private async findMatchingActiveJobForDispatch(
    businessId: string,
    customerId: string | undefined,
    title: string,
  ) {
    if (!customerId) return null;
    const tokens = this.normalisedIntentTokens(title);
    const jobs = await this.prisma.job.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 5,
      where: {
        businessId,
        customerId,
        isArchived: false,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
    });
    return (
      jobs.find((job) => {
        const haystack = this.normalisedIntentTokens(job.title ?? '').join(' ');
        return tokens.every((token) => haystack.includes(token));
      }) ?? null
    );
  }

  private async recommendDispatchAppointment(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    dispatch: PendingDispatch,
  ): Promise<DispatchAvailabilityRecommendation> {
    const windowStart = dispatch.scheduling.windowStart
      ? new Date(dispatch.scheduling.windowStart)
      : null;
    const windowEnd = dispatch.scheduling.windowEnd
      ? new Date(dispatch.scheduling.windowEnd)
      : null;
    const duration = dispatch.scheduling.durationMinutes;
    if (!windowStart || !windowEnd || !duration) return null;

    const members = await this.prisma.businessMember.findMany({
      where: {
        businessId: currentUser.businessId,
        role: { in: [...APPOINTMENT_ASSIGNABLE_TECHNICIAN_ROLES] },
        status: 'ACTIVE',
        user: { isActive: true },
        userId: { not: null },
      },
      include: {
        user: {
          select: { email: true, firstName: true, id: true, lastName: true },
        },
      },
      orderBy: [{ joinedAt: 'asc' }],
    });
    const technicians = members
      .map((member) => member.user)
      .filter((user): user is NonNullable<typeof user> => Boolean(user));
    const stepMinutes = 30;
    const options: Array<NonNullable<DispatchAvailabilityRecommendation>> = [];
    for (const technician of technicians) {
      for (
        let startMs = windowStart.getTime();
        startMs + duration * 60_000 <= windowEnd.getTime();
        startMs += stepMinutes * 60_000
      ) {
        const scheduledStart = new Date(startMs);
        const scheduledEnd = new Date(startMs + duration * 60_000);
        const availability = await this.appointments.availability(currentUser, {
          assignedUserId: technician.id,
          scheduledEnd: scheduledEnd.toISOString(),
          scheduledStart: scheduledStart.toISOString(),
        });
        if (!availability.hasConflict) {
          options.push({
            reason: `${this.userLabel(technician)} has no overlapping appointment in the requested window.`,
            scheduledEnd,
            scheduledStart,
            technicianId: technician.id,
            technicianName: this.userLabel(technician),
          });
          break;
        }
      }
    }
    return (
      options.sort(
        (left, right) =>
          left.scheduledStart.getTime() - right.scheduledStart.getTime() ||
          left.technicianName.localeCompare(right.technicianName) ||
          left.technicianId.localeCompare(right.technicianId),
      )[0] ?? null
    );
  }

  private dispatchSchedulingFromText(
    text: string,
    timezone: string,
  ): PendingDispatch['scheduling'] {
    return this.dispatchSchedulingFromParsed(
      this.parseCurrentTurn(text, timezone),
      timezone,
    );
  }

  private dispatchSchedulingFromParsed(
    parsed: ToriParsedRequest,
    timezone: string,
  ): PendingDispatch['scheduling'] {
    return this.dispatchSchedulingUpdateFromCurrent(parsed, {}, timezone);
  }

  private dispatchSchedulingUpdateFromCurrent(
    parsed: ToriParsedRequest,
    existing: PendingDispatch['scheduling'],
    timezone: string,
  ): PendingDispatch['scheduling'] {
    const date = parsed.scheduling?.date ?? existing.date;
    const daypart = parsed.scheduling?.daypart;
    const time = parsed.scheduling?.time;
    if (!date) {
      return parsed.scheduling?.durationMinutes
        ? { durationMinutes: parsed.scheduling.durationMinutes }
        : {};
    }
    const [year, month, day] = date.split('-').map(Number);
    const durationForWindow =
      parsed.scheduling?.durationMinutes ?? existing.durationMinutes;
    const startHour = time
      ? Number(time.split(':')[0])
      : daypart === 'AFTERNOON'
        ? 12
        : 8;
    const startMinute = time ? Number(time.split(':')[1]) : 0;
    const endHour = daypart === 'MORNING' ? 12 : 17;
    const windowStart = zonedTimeToUtc(
      { day, hour: startHour, minute: startMinute, month, year },
      timezone,
    );
    const windowEnd =
      time && durationForWindow
        ? new Date(windowStart.getTime() + durationForWindow * 60_000)
        : zonedTimeToUtc(
            {
              day,
              hour: time ? startHour + 1 : endHour,
              minute: 0,
              month,
              year,
            },
            timezone,
          );
    return {
      date,
      daypart,
      durationMinutes: durationForWindow,
      preferredStart: time ?? undefined,
      windowEnd: windowEnd.toISOString(),
      windowStart: windowStart.toISOString(),
    };
  }

  private ensureDispatchPreferredTimeWindow(
    dispatch: PendingDispatch,
    timezone: string,
  ) {
    const date = dispatch.scheduling.date;
    const preferredStart = dispatch.scheduling.preferredStart;
    const duration = dispatch.scheduling.durationMinutes;
    if (!date || !preferredStart || !duration) return;
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = preferredStart.split(':').map(Number);
    const windowStart = zonedTimeToUtc(
      { day, hour, minute, month, year },
      timezone,
    );
    dispatch.scheduling.windowStart = windowStart.toISOString();
    dispatch.scheduling.windowEnd = new Date(
      windowStart.getTime() + duration * 60_000,
    ).toISOString();
  }

  private extractCurrentTurnCustomer(
    text: string,
  ): ToriParsedRequest['customer'] | undefined {
    const phone = this.extractAustralianPhone(text) ?? undefined;
    const email = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0];
    const name =
      this.extractDispatchCustomerName(text) ||
      this.cleanCustomerNameCandidate(
        text.match(
          /\bnew customer\s+([A-Za-z][A-Za-z\s'-]{1,80}?)\s+(?:\+?61|0)?\d[\d\s-]{7,}\b/i,
        )?.[1],
      ) ||
      this.cleanCustomerNameCandidate(
        text.match(
          /\bbook\s+([A-Za-z][A-Za-z\s'-]{1,80}?)\s+(?:today|tomorrow|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{1,2}\/\d{1,2})\b/i,
        )?.[1],
      ) ||
      this.cleanCustomerNameCandidate(
        text.match(
          /\b(?:appointment|appoinment|appointement|apointment)\s+for\s+([A-Za-z][A-Za-z\s'-]{1,80}?)\s+(?:today|tomorrow|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{1,2}\/\d{1,2})\b/i,
        )?.[1],
      ) ||
      this.cleanCustomerNameCandidate(
        text.match(
          /\bsend(?:ing)?\s+(?:someone|somone|somebody)\s+to\s+([A-Za-z][A-Za-z\s'-]{1,80}?)(?:\s+today|\s+tomorrow|\s+on\b|\s+at\b|\s+for\b|[,.?!]|$)/i,
        )?.[1],
      ) ||
      this.cleanCustomerNameCandidate(
        text.match(
          /\bbook(?:ing)?\s+(?:someone|somone|somebody)\s+for\s+([A-Za-z][A-Za-z\s'-]{1,80}?)(?:\s+today|\s+tomorrow|\s+on\b|\s+at\b|\s+for\b|[,.?!]|$)/i,
        )?.[1],
      ) ||
      this.cleanCustomerNameCandidate(
        text.match(/\bschedule\s+([A-Za-z][A-Za-z\s'-]{1,80}?)'s\b/i)?.[1],
      ) ||
      this.cleanCustomerNameCandidate(
        text.match(
          /\bschedule\s+([A-Za-z][A-Za-z\s'-]{1,80}?)(?:\s+today|\s+tomorrow|\s+on\b|\s+for\b|\s+at\b|\s+(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b|[,.]|$)/i,
        )?.[1],
      ) ||
      this.cleanCustomerNameCandidate(
        text.match(
          /\b([A-Za-z][A-Za-z\s'-]{1,80}?)\s+needs\s+(?:someone|somone|somebody)\b/i,
        )?.[1],
      ) ||
      this.cleanCustomerNameCandidate(
        text.match(
          /\b(?:appointment|appoinment|appointement|apointment)\s+for\s+([A-Za-z][A-Za-z\s'-]{1,80}?)(?:\s+for\b|\s+on\b|\s+at\b|[,.?!]|$)/i,
        )?.[1],
      ) ||
      this.cleanCustomerNameCandidate(
        text.match(
          /\bfor\s+([A-Za-z][A-Za-z\s'-]{1,80}?)(?:\s+for\b|\s+on\b|\s+at\b|[,.?!]|$)/i,
        )?.[1],
      ) ||
      this.cleanCustomerNameCandidate(
        text.match(
          /\bbook\s+([A-Za-z][A-Za-z\s'-]{1,80}?)(?:\s+today|\s+tomorrow|\s+on\b|\s+for\b|\s+at\b|[,.?!]|$)/i,
        )?.[1],
      );
    if (!name && !phone && !email) {
      if (/\b(her|him|his|their|this customer|that customer)\b/i.test(text)) {
        return { pronounReference: true, referenceType: 'RECENT' };
      }
      return undefined;
    }
    return {
      ...(email ? { email } : {}),
      ...(name ? { name } : {}),
      ...(phone ? { phone } : {}),
      impliesNew: /\bnew customer\b/i.test(text),
      referenceType: name ? 'EXPLICIT' : 'RECENT',
    };
  }

  private extractDispatchCustomerName(text: string) {
    const patterns = [
      /\bnew customer\s+([A-Za-z][A-Za-z\s'-]{1,80}?)(?:[,.]|\s+(?:her|his|their|number|phone|called)\b)/i,
      /\bcustomer\s+([A-Za-z][A-Za-z\s'-]{1,80}?)(?:[,.]|\s+(?:on|at|with|number|phone|for)\b)/i,
      /^([A-Za-z][A-Za-z\s'-]{1,80}?)\s+called\b/i,
      /\b([A-Za-z][A-Za-z\s'-]{1,80}?)\s+called\b/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        const name = this.cleanCustomerNameCandidate(match[1]);
        if (name) return name;
      }
    }
    return '';
  }

  private extractDispatchJobTitle(text: string, parsed?: ToriParsedRequest) {
    if (parsed?.job?.title) return parsed.job.title;
    const currentTurnTitle = this.extractCurrentTurnJobTitle(text);
    if (currentTurnTitle) return currentTurnTitle;
    const lower = text.toLowerCase();
    if (
      /\bkitchen sink\b.*\b(blocked|clogged)\b|\b(blocked|clogged)\b.*\bkitchen sink\b/i.test(
        text,
      )
    ) {
      return 'Blocked kitchen sink';
    }
    if (/\bblocked toilet\b/i.test(text)) return 'Blocked toilet';
    if (/\bleaking tap\b/i.test(text)) return 'Leaking tap';
    if (/\bbroken hot water system\b/i.test(text)) {
      return 'Broken hot water system';
    }
    const match =
      text.match(/\bjob is\s+([^,.]+?)(?:\s+at\b|[,.]|$)/i) ??
      text.match(/\babout\s+(?:a\s+)?([^,.]+?)(?:\s+at\b|[,.]|$)/i);
    if (match?.[1]) return this.cleanJobTitleSlot(match[1]);
    if (lower.includes('sink') && lower.includes('blocked')) {
      return 'Blocked sink';
    }
    return this.extractJobTitle(text) || '';
  }

  private extractCurrentTurnJobTitle(text: string) {
    const explicit = this.extractIssuePhrase(text);
    if (explicit) return this.normaliseIssueTitle(explicit);
    const lower = text.toLowerCase();
    if (
      /\bkitchen sink\b.*\b(blocked|clogged)\b|\b(blocked|clogged)\b.*\bkitchen sink\b/i.test(
        text,
      )
    ) {
      return 'Blocked kitchen sink';
    }
    if (lower.includes('sink') && lower.includes('blocked')) {
      return 'Blocked sink';
    }
    return '';
  }

  private extractIssuePhrase(text: string) {
    const schedulingStrippedText = this.stripSchedulingMetadata(text);
    const schedulingAwarePatterns = [
      /\b(?:book|schedule)\s+[A-Za-z][A-Za-z\s'-]{1,80}?.*?\s+(?:for|to)\s+(?:the\s+)?([^,.?!]+?)(?:[,.?!]|$)/i,
      /\bcreate(?:\s+an?|\s+the)?\s+(?:appointment|appoinment|appointement)\s+for\s+[A-Za-z][A-Za-z\s'-]{1,80}?.*?\s+(?:for|to)\s+(?:the\s+)?([^,.?!]+?)(?:[,.?!]|$)/i,
      /\bsend(?:ing)?\s+someone\s+to\s+[A-Za-z][A-Za-z\s'-]{1,80}?.*?\s+(?:for|to)\s+(?:the\s+)?([^,.?!]+?)(?:[,.?!]|$)/i,
      /\b[A-Za-z][A-Za-z\s'-]{1,80}?\s+needs\s+someone\s+for\s+(?:his|her|their|the)?\s*([^,.?!]+?)(?:[,.?!]|$)/i,
    ];
    for (const pattern of schedulingAwarePatterns) {
      const match = schedulingStrippedText.match(pattern);
      const phrase = this.cleanIssueCandidate(match?.[1]);
      if (phrase && this.looksLikeServiceIssue(phrase)) return phrase;
    }

    for (const match of text.matchAll(
      /\b(?:her|his|their|the)\s+([^,.?!]+?)(?:\s+at\s+\d+\b|[,.]|$)/gi,
    )) {
      const phrase = this.cleanIssueCandidate(match[1]);
      if (phrase && this.looksLikeServiceIssue(phrase)) return phrase;
    }
    const patterns = [
      /\b(?:\+?61|0)?\d[\d\s-]{7,}\s*,\s*([^,.?!]+?)(?:\s*,\s*\d+\s+[A-Za-z]|\s+at\s+\d+\b|[,.?!]|$)/i,
      /\bbook\s+[A-Za-z][A-Za-z\s'-]{1,80}?\s+(?:today|tomorrow|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{1,2}\/\d{1,2})[^,.?!]*?\s+for\s+(?:the\s+)?([^,.?!]+?)(?:[,.?!]|$)/i,
      /\bfor\s+[A-Za-z][A-Za-z\s'-]{1,80}?\s+for\s+([^,.?!]+?)(?:\s+for\s+(?:today|tomorrow|next\b|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}[/\s])|\s+at\s+\d+\b|[,.]|$)/i,
      /\bsend(?:ing)?\s+someone\s+to\s+[A-Za-z][A-Za-z\s'-]{1,80}?.*?\s+for\s+(?:the\s+)?([^,.?!]+?)(?:\s+\d+\s*(?:min|mins|minutes?|mons?|hours?|hrs?)|[,.?!]|$)/i,
      /\bschedule\s+[A-Za-z][A-Za-z\s'-]{1,80}?'s\s+([^,.?!]+?)(?:\s+(?:today|tomorrow|morning|afternoon|evening|on\b|at\b|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|[,.?!]|$)/i,
      /\b[A-Za-z][A-Za-z\s'-]{1,80}?\s+needs\s+someone\s+for\s+(?:his|her|their|the)?\s*([^,.?!]+?)(?:\s+(?:today|tomorrow|on\b|at\b|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|[,.?!]|$)/i,
      /\bfor\s+(?:the\s+)?([^,.?!]+?)(?:\s+(?:today|tomorrow|morning|afternoon|evening|on\b|at\b|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\s+\d+\s*(?:min|mins|minutes?|mons?|hours?|hrs?)|[,.?!]|$)/i,
      /\b(?:about|job is|work is)\s+(?:a\s+)?([^,.?!]+?)(?:\s+at\s+\d+\b|[,.]|$)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const phrase = this.cleanIssueCandidate(match?.[1]);
      if (phrase && this.looksLikeServiceIssue(phrase)) return phrase;
    }
    return '';
  }

  private cleanIssueCandidate(value?: string) {
    if (!value) return '';
    return this.stripSchedulingMetadata(value)
      .replace(/^(?:for|to)\s+/i, '')
      .replace(/^(fix|repair|inspect|install|replace|clean)\s+the\s+/i, '$1 ')
      .replace(/\s+(?:for\s+)?(?:please|pls|thanks|thank you)\b.*$/i, '')
      .replace(/\s+(?:for|to|at|on)$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private looksLikeServiceIssue(value: string) {
    return /\b(leak|leaking|tap|sink|blocked|toilet|hot water|repair|fix|broken|install|inspect|service|bath|bathroom|bed|yard|pergola|pipe)\b/i.test(
      value,
    );
  }

  private normaliseIssueTitle(value: string) {
    const cleaned = this.stripSchedulingMetadata(value)
      .replace(/\bmaster bed bath\b/gi, 'master bedroom/bathroom')
      .replace(/^(?:his|her|their|the)\s+/i, '')
      .replace(/^(?:for|to)\s+/i, '')
      .replace(/^(fix|repair|inspect|install|replace|clean)\s+the\s+/i, '$1 ')
      .replace(
        /\s+(?:for\s+)?(?:today|tomorrow|on\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?\b.*$/i,
        '',
      )
      .replace(/\s+on\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b.*$/i, '')
      .replace(/\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b.*$/i, '')
      .replace(/\s+(?:for\s+)?(?:please|pls|thanks|thank you)\b.*$/i, '')
      .replace(/\s+(?:for|to|at|on)$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (
      /\bkitchen sink\b/i.test(cleaned) &&
      /\b(blocked|clogged)\b/i.test(cleaned)
    ) {
      return 'Blocked kitchen sink';
    }
    if (/^(blocked|clogged)\b/i.test(cleaned)) {
      return this.cleanJobTitleSlot(cleaned);
    }
    if (/\b(blocked|clogged)\b/i.test(cleaned)) {
      return this.cleanJobTitleSlot(cleaned.replace(/\bis\b/gi, ''));
    }
    return this.cleanJobTitleSlot(cleaned);
  }

  private stripSchedulingMetadata(value: string) {
    return value
      .replace(this.durationSpanRegex(), ' ')
      .replace(
        /\b(?:today|tomorrow|tonight|morning|afternoon|evening)\b/gi,
        ' ',
      )
      .replace(
        /\b(?:next\s+)?(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi,
        ' ',
      )
      .replace(
        /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/gi,
        ' ',
      )
      .replace(
        /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\b/gi,
        ' ',
      )
      .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
      .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, ' ')
      .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractDispatchAddress(text: string) {
    const explicit = this.extractAustralianAddressSlot(text);
    if (explicit) return explicit;
    const match = text.match(
      /\b(\d+\s+[A-Za-z][A-Za-z0-9\s'-]*(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Lane|Ln|Way|Place|Pl))[,]?\s+([A-Za-z][A-Za-z\s'-]+?)(?:[,.]|$)/i,
    );
    if (!match) return null;
    const suburb = this.cleanExtractedName(match[2]);
    const inferred = this.inferAddressFromSuburb(suburb);
    return inferred
      ? {
          addressLine1: match[1].trim(),
          postcode: inferred.postcode,
          state: inferred.state,
          suburb,
        }
      : null;
  }

  private inferAddressFromSuburb(suburb: string) {
    const key = suburb.toLowerCase();
    const known: Record<string, { postcode: string; state: AustralianState }> =
      {
        tarneit: { postcode: '3029', state: 'VIC' },
        werribee: { postcode: '3030', state: 'VIC' },
      };
    return known[key] ?? null;
  }

  private dispatchAddress(job: PendingDispatch['job']) {
    if (job.addressLine1 && job.suburb && job.state && job.postcode) {
      return {
        addressLine1: job.addressLine1,
        postcode: job.postcode,
        state: job.state as AustralianState,
        suburb: job.suburb,
      };
    }
    return null;
  }

  private dispatchAddressLabel(job: PendingDispatch['job']) {
    const address = this.dispatchAddress(job);
    if (address) return this.addressLabel(address);
    return [job.addressLine1, job.suburb, job.state, job.postcode]
      .filter(Boolean)
      .join(', ');
  }

  private dispatchCustomerName(dispatch: PendingDispatch) {
    return dispatch.customer.name ?? 'Customer';
  }

  private dispatchRequestedLabel(dispatch: PendingDispatch, timezone: string) {
    const start = dispatch.scheduling.windowStart
      ? new Date(dispatch.scheduling.windowStart)
      : null;
    if (!start) return 'Requested time';
    const date = formatBusinessDate(start, timezone);
    const part = dispatch.scheduling.daypart
      ? dispatch.scheduling.daypart.toLowerCase()
      : 'time window';
    return `${date} ${part}`;
  }

  private cancelDispatchMessage(dispatch: PendingDispatch) {
    const created: string[] = [];
    if (dispatch.customer.customerId) created.push('customer');
    if (dispatch.job.jobId) created.push('job');
    return created.length
      ? `Okay, I cancelled the remaining dispatch workflow. The already-created ${created.join(
          ' and ',
        )} will remain in TradieOS.`
      : 'Okay, I cancelled that dispatch workflow. No TradieOS data changed.';
  }

  private appointmentResumeContextFromCreatedJob(job: {
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
    const customerId = job.customer?.id ?? job.customerId;
    const customerName = job.customer?.displayName;
    const serviceLocation = {
      addressLine1: job.addressLine1,
      postcode: job.postcode,
      state: job.state,
      suburb: job.suburb,
    };
    return {
      customerId,
      customerName,
      jobId: job.id,
      jobNumber: job.jobNumber,
      jobTitle: job.title,
      pendingAppointment: {
        customerId,
        customerName,
        jobId: job.id,
        jobNumber: job.jobNumber,
        jobTitle: job.title,
        serviceLocation,
      },
      pendingQuestion: {
        intent: 'CREATE_APPOINTMENT_FOR_JOB',
        type: 'APPOINTMENT_DATE',
      },
      recentCustomer: customerId
        ? {
            displayName: customerName ?? 'Customer',
            id: customerId,
          }
        : undefined,
      recentJob: {
        customerId,
        customerName,
        id: job.id,
        jobNumber: job.jobNumber,
        title: job.title,
      },
      serviceLocation,
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
    const total = outstanding?._sum?.balanceDueCents ?? 0;
    const overdueTotal = overdue?._sum?.balanceDueCents ?? 0;
    const lines = invoices.map(
      (invoice) =>
        `${invoice.invoiceNumber} · ${invoice.customer.displayName} · ${formatAudCents(invoice.balanceDueCents)} due ${formatBusinessDate(invoice.dueDate, business.timezone)}`,
    );
    return [
      `Outstanding invoices: ${formatAudCents(total)} across ${outstanding?._count?._all ?? 0}.`,
      `Overdue: ${formatAudCents(overdueTotal)} across ${overdue?._count?._all ?? 0}.`,
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

  private async prepareSmartReassignDraft(
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
    const lower = text.toLowerCase();
    const technician = await this.findTechnicianMention(
      currentUser.businessId,
      lower,
    );
    const candidates = await this.technicianRecommendationsForAppointment(
      currentUser,
      business,
      appointment,
    );
    const namedIneligible = technician
      ? null
      : await this.findAnyMemberMention(currentUser.businessId, lower);
    if (namedIneligible) {
      return {
        content: `${this.userLabel(namedIneligible.user)} cannot be assigned as the field technician for this appointment. In Phase 1, Tori can only assign active Technician role members.`,
      };
    }
    const requestedBest = this.looksLikeBestTechnicianAssignment(lower);
    const selectedCandidate = technician
      ? candidates.find((candidate) => candidate.userId === technician.id)
      : requestedBest
        ? candidates.find((candidate) => candidate.isAvailable)
        : null;
    if (!selectedCandidate) {
      if (requestedBest) {
        return {
          content:
            'I could not find an available eligible technician for that appointment.',
        };
      }
      return {
        content: 'Which technician should I assign this appointment to?',
      };
    }
    if (!selectedCandidate.isAvailable) {
      const alternative = candidates.find((candidate) => candidate.isAvailable);
      return {
        content: alternative
          ? `${selectedCandidate.name} is not available: ${selectedCandidate.availabilityReason} ${alternative.name} is available with ${alternative.scheduledMinutes} scheduled minutes that day. Would you like me to prepare ${alternative.name} instead?`
          : `${selectedCandidate.name} is not available: ${selectedCandidate.availabilityReason} I could not find another eligible technician available for that time.`,
      };
    }
    const reason = `${selectedCandidate.name} is available with no overlapping appointment and has ${selectedCandidate.scheduledMinutes} scheduled minutes that day.`;
    const draft = this.actionDraft({
      description: `Assign ${appointment.job.customer.displayName}'s appointment to ${selectedCandidate.name}.`,
      entityId: appointment.id,
      entityType: 'APPOINTMENT',
      payload: {
        appointmentId: appointment.id,
        expectedUpdatedAt: appointment.updatedAt.toISOString(),
        reassignmentPayload: {
          assignedUserId: selectedCandidate.userId,
          reason,
        },
        type: 'REASSIGN_TECHNICIAN',
      },
      proposedChanges: [
        { label: 'Appointment', to: appointment.appointmentNumber },
        { label: 'Customer', to: appointment.job.customer.displayName },
        {
          from: this.userLabel(appointment.assignedUser),
          label: 'Technician',
          to: selectedCandidate.name,
        },
        { label: 'Reason', to: reason },
      ],
      title: 'Reassign technician',
      validationState: 'READY',
      warnings: [],
    });
    return {
      actionDraft: draft,
      content: `I recommend ${selectedCandidate.name}. I prepared a reassignment draft. Nothing has changed yet—confirm it if this looks right.`,
    };
  }

  private async answerTechnicianRecommendation(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    text: string,
    context?: ToriContext,
  ) {
    const appointment = await this.resolveAppointment(
      currentUser,
      business,
      text,
      context,
    );
    if (!appointment) {
      return "I couldn't identify the appointment. Which appointment should I check?";
    }
    const candidates = await this.technicianRecommendationsForAppointment(
      currentUser,
      business,
      appointment,
    );
    const available = candidates.filter((candidate) => candidate.isAvailable);
    if (!candidates.length) {
      return 'I could not find any active Technician role members in this workspace.';
    }
    if (!available.length) {
      return `No eligible technicians are available for ${appointment.appointmentNumber}. ${candidates
        .slice(0, 3)
        .map(
          (candidate) => `${candidate.name}: ${candidate.availabilityReason}`,
        )
        .join(' ')}`;
    }
    const recommended = available[0];
    return [
      `Available technicians for ${appointment.appointmentNumber}:`,
      ...available
        .slice(0, 3)
        .map(
          (candidate, index) =>
            `${index + 1}. ${candidate.name} — available ${formatBusinessTimeRange(
              appointment.scheduledStart,
              appointment.scheduledEnd,
              business.timezone,
            )}; ${candidate.scheduledMinutes} scheduled minutes that day.`,
        ),
      `Recommended: ${recommended.name}. ${recommended.name} has no conflict and the lightest eligible schedule.`,
    ].join('\n');
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
    const questionType = context.pendingQuestion?.type;
    if (
      (!pending.customerId && !pending.jobId) ||
      questionType === 'APPOINTMENT_CUSTOMER'
    ) {
      const dateTimeCandidate = this.parseAppointmentDateTimeParts(
        text,
        business.timezone,
      );
      if (dateTimeCandidate.date || dateTimeCandidate.time) {
        return {
          content:
            'I still need to know which customer this appointment is for before I can use a date and time.',
          context,
        };
      }
      const customer = await this.resolveCustomer(
        currentUser.businessId,
        text,
        pending.customerId ?? context.customerId,
        text,
      );
      if (!customer.match) {
        return {
          content:
            customer.message === 'Which customer should I use?'
              ? 'Which customer is this appointment for?'
              : `${customer.message} Please choose an existing customer before I prepare the appointment.`,
          context,
        };
      }
      const jobResult = await this.resolveAppointmentJobForCustomer(
        currentUser.businessId,
        customer.match.id,
      );
      if (!jobResult.job) {
        return {
          content: jobResult.message.includes('prepare a job')
            ? `I found ${customer.match.displayName}, but there isn't an active job to schedule. Would you like me to prepare a job for ${customer.match.displayName}?`
            : jobResult.message,
          context: {
            ...context,
            customerId: customer.match.id,
            customerName: customer.match.displayName,
            pendingAppointment: {
              ...pending,
              customerId: customer.match.id,
              customerName: customer.match.displayName,
            },
            pendingQuestion: {
              intent: 'CREATE_APPOINTMENT_FOR_JOB',
              type: 'APPOINTMENT_JOB',
            },
          },
        };
      }
      return {
        content: `I’ll use ${customer.match.displayName}'s ${jobResult.job.jobNumber} — ${jobResult.job.title} job. What date and time should I book the appointment for?`,
        context: {
          ...context,
          customerId: customer.match.id,
          customerName: customer.match.displayName,
          jobId: jobResult.job.id,
          jobNumber: jobResult.job.jobNumber,
          jobTitle: jobResult.job.title,
          pendingAppointment: this.pendingAppointmentFromJob(jobResult.job),
          pendingQuestion: {
            intent: 'CREATE_APPOINTMENT_FOR_JOB',
            type: 'APPOINTMENT_DATE',
          },
          serviceLocation: this.jobServiceLocation(jobResult.job),
        },
      };
    }
    if (!pending.jobId || questionType === 'APPOINTMENT_JOB') {
      const selectedJob = pending.customerId
        ? await this.resolveAppointmentJobSelection(
            currentUser.businessId,
            pending.customerId,
            text,
          )
        : null;
      if (selectedJob) {
        return {
          content: `I’ll use ${selectedJob.jobNumber} — ${selectedJob.title}. What date and time should I book the appointment for?`,
          context: {
            ...context,
            customerId: selectedJob.customerId,
            customerName: selectedJob.customer.displayName,
            jobId: selectedJob.id,
            jobNumber: selectedJob.jobNumber,
            jobTitle: selectedJob.title,
            pendingAppointment: this.pendingAppointmentFromJob(selectedJob),
            pendingQuestion: {
              intent: 'CREATE_APPOINTMENT_FOR_JOB',
              type: 'APPOINTMENT_DATE',
            },
            serviceLocation: this.jobServiceLocation(selectedJob),
          },
        };
      }
      return {
        content:
          'Which active job should I use for this appointment? Please send the job number, or say "create a job" if you need a new one.',
        context,
      };
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
  ): Promise<DraftPreparation> {
    this.assertRole(currentUser, APPOINTMENT_WRITE_ROLES);
    if (context?.pendingAppointment) {
      return this.continueAppointmentDraft(
        currentUser,
        business,
        text,
        context,
      );
    }
    const targetTime = this.parseTargetDateTime(text, business.timezone);
    if (context?.jobId && !this.parseTargetDateTime(text, business.timezone)) {
      return this.beginAppointmentFromContext(currentUser, text, {
        ...context,
        pendingQuestion: {
          intent: 'CREATE_APPOINTMENT_FOR_JOB',
          type: 'YES_NO',
        },
      });
    }
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
        content: 'Which customer is this appointment for?',
        context: {
          ...this.clearPendingContext(context),
          pendingAppointment: {},
          pendingQuestion: {
            intent: 'CREATE_APPOINTMENT_FOR_JOB',
            type: 'APPOINTMENT_CUSTOMER',
          },
        },
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
          include: {
            customer: { include: { sites: { where: { isArchived: false } } } },
          },
          where: { businessId: currentUser.businessId, id: context.jobId },
        })
      : await this.prisma.job.findFirst({
          include: {
            customer: { include: { sites: { where: { isArchived: false } } } },
          },
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
    const location = this.appointmentLocationFromJob(job);
    if (!location) {
      return {
        content:
          'I need a service location before I can prepare an appointment draft. Which service address should I use?',
      };
    }
    const draft = this.actionDraft({
      description: `Book ${customer.match.displayName} for ${formatBusinessDateTime(targetTime, business.timezone)}.`,
      entityId: null,
      entityType: 'APPOINTMENT',
      payload: {
        appointmentPayload: {
          accessInstructions: location.accessInstructions ?? undefined,
          addressLine1: location.addressLine1,
          addressLine2: location.addressLine2 ?? undefined,
          appointmentType: 'INSPECTION',
          assignedUserId: technician?.id ?? null,
          customerSiteId: location.customerSiteId,
          estimatedDurationMinutes: duration,
          jobId: job.id,
          locationSource: location.locationSource,
          notes: 'Prepared by Tori. Review before saving.',
          postcode: location.postcode,
          scheduledEnd: end.toISOString(),
          scheduledStart: targetTime.toISOString(),
          state: location.state,
          suburb: location.suburb,
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
    const existingPendingJob = request.context?.pendingJob;
    const resumeAppointment =
      existingPendingJob?.resumeAppointment ??
      (request.context?.pendingQuestion?.intent ===
        'CREATE_APPOINTMENT_FOR_JOB' &&
      request.context.pendingQuestion.type === 'APPOINTMENT_JOB'
        ? request.context.pendingAppointment
        : undefined);
    const pendingSlots: JobDraftSlots = {
      addressLine1: existingPendingJob?.addressLine1,
      customerId:
        existingPendingJob?.customerId ??
        request.context?.pendingAppointment?.customerId ??
        request.context?.customerId ??
        request.context?.recentCustomer?.id,
      customerName:
        existingPendingJob?.customerName ??
        request.context?.pendingAppointment?.customerName ??
        request.context?.customerName ??
        request.context?.recentCustomer?.displayName,
      description: existingPendingJob?.description,
      postcode: existingPendingJob?.postcode,
      state:
        existingPendingJob?.state &&
        this.isAustralianState(existingPendingJob.state)
          ? existingPendingJob.state
          : undefined,
      suburb: existingPendingJob?.suburb,
      title: existingPendingJob?.title,
    };
    const slots = this.mergeJobSlotsForCurrentTurn(pendingSlots, text, request);
    const customer = await this.resolveCustomerForJob(
      currentUser.businessId,
      slots.customerName,
      slots.customerId ?? request.context?.customerId,
    );
    if (!customer.match) return { content: customer.message };
    const site = this.singleUsableServiceSite(customer.match);
    const title = slots.title ?? '';
    if (!title) {
      const expectedTitle =
        request.context?.pendingQuestion?.intent === 'CREATE_JOB' &&
        request.context.pendingQuestion.type === 'JOB_TITLE';
      return {
        content: expectedTitle
          ? 'That does not look like a job title I can use. What is the job for?'
          : 'What is the job for?',
        context: {
          ...request.context,
          customerId: customer.match.id,
          customerName: customer.match.displayName,
          pendingJob: {
            ...slots,
            customerId: customer.match.id,
            customerName: customer.match.displayName,
            resumeAppointment,
          },
          pendingQuestion: {
            intent: 'CREATE_JOB',
            type: 'JOB_TITLE',
          },
        },
      };
    }
    const address = this.jobAddressFromSlotsOrCustomer(slots, customer.match);
    if (!address) {
      const hasMultipleSites = customer.match.sites.length > 1;
      const expectedAddress =
        request.context?.pendingQuestion?.intent === 'CREATE_JOB' &&
        request.context.pendingQuestion.type === 'JOB_ADDRESS';
      return {
        content: expectedAddress
          ? 'That does not look like a service address. Please send the street, suburb, state if known, and postcode.'
          : hasMultipleSites
            ? 'I found multiple service addresses for this customer. Which service address should I use for this job?'
            : 'I found the customer. What service address should I use for this job?',
        context: {
          ...request.context,
          customerId: customer.match.id,
          customerName: customer.match.displayName,
          pendingJob: {
            ...slots,
            customerId: customer.match.id,
            customerName: customer.match.displayName,
            resumeAppointment,
          },
          pendingQuestion: {
            intent: 'CREATE_JOB',
            type: 'JOB_ADDRESS',
          },
        },
      };
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
      payload: { jobPayload, resumeAppointment, type: 'CREATE_JOB' },
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
      context: {
        ...request.context,
        customerId: customer.match.id,
        customerName: customer.match.displayName,
        pendingJob: {
          ...slots,
          ...address,
          customerId: customer.match.id,
          customerName: customer.match.displayName,
          resumeAppointment,
          title,
        },
        pendingQuestion: {
          intent: 'CREATE_JOB',
          type: 'JOB_TITLE',
        },
      },
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
    const job = this.mergeJobSlotsForCurrentTurn(
      pendingJob,
      text,
      request,
      'CREATE_CUSTOMER_AND_JOB',
    );
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
  ): Promise<DraftPreparation> {
    this.assertRole(currentUser, QUOTE_CREATE_ROLES);
    const currentTurnCustomer = this.extractCustomerSearch(text);
    const customer = await this.resolveCustomer(
      currentUser.businessId,
      text,
      currentTurnCustomer
        ? undefined
        : (context?.pendingQuote?.customerId ?? context?.customerId),
    );
    if (!customer.match) return { content: customer.message };
    const lineItems = this.parseLineItems(text);
    if (!lineItems.length) {
      return {
        content:
          'Tell me the quote line items, for example: 2 hours labour at $120 and $80 materials.',
        context: this.quoteLineItemsContext(context, customer.match),
      };
    }
    return this.quoteDraftFromLineItems(business, customer.match, lineItems);
  }

  private async answerQuoteLineItemsQuestion(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    text: string,
    context: ToriContext,
  ): Promise<DraftPreparation> {
    const lineItems = this.parseLineItems(text);
    if (
      !lineItems.length &&
      this.looksLikeReadQuestion(text.toLowerCase()) &&
      !this.isActionableCurrentTurn(
        this.parseCurrentTurn(text, business.timezone),
      )
    ) {
      return {
        content: await this.answerReadQuestion(currentUser, business, text),
        context,
      };
    }
    if (!lineItems.length) {
      return {
        content:
          "I couldn't read quote line items from that. Please send items like: 1.5 hours labour at $150 and $100 materials.",
        context,
      };
    }
    const customer = await this.resolveCustomer(
      currentUser.businessId,
      text,
      context.pendingQuote?.customerId ?? context.customerId,
    );
    if (!customer.match) return { content: customer.message, context };
    return this.quoteDraftFromLineItems(business, customer.match, lineItems);
  }

  private quoteLineItemsContext(
    context: ToriContext | undefined,
    customer: CustomerMatch,
  ): ToriContext {
    const workflowId = `quote:${customer.id}`;
    return {
      ...context,
      customerId: customer.id,
      customerName: customer.displayName,
      pendingQuestion: {
        customerName: customer.displayName,
        intent: 'CREATE_QUOTE',
        promptPurpose: 'Collect quote line items before drafting a quote',
        subjectId: customer.id,
        subjectName: customer.displayName,
        type: 'QUOTE_LINE_ITEMS',
        workflowId,
      },
      pendingQuote: {
        customerId: customer.id,
        customerName: customer.displayName,
      },
      workflow: {
        customerId: customer.id,
        customerName: customer.displayName,
        awaitingSlot: 'QUOTE_LINE_ITEMS',
        rootIntent: 'CREATE_QUOTE',
        state: 'AWAITING_QUOTE_LINE_ITEMS',
        status: 'ACTIVE',
        workflowId,
      },
    };
  }

  private quoteDraftFromLineItems(
    business: BusinessSummary,
    customer: CustomerMatch,
    lineItems: QuotePayload['lineItems'],
  ): DraftPreparation {
    const site = customer.sites.find((item) => item.isPrimary) ?? null;
    const quotePayload: QuotePayload = {
      customerId: customer.id,
      customerNotes: 'Draft prepared by Tori. Review before sending.',
      customerSiteId: site?.id ?? null,
      description: 'Prepared by Tori from your request.',
      discountType: 'NONE',
      discountValue: 0,
      gstRateBasisPoints: business.gstRegistered ? 1000 : 0,
      issueDate: new Date().toISOString(),
      lineItems,
      pricingMode: 'GST_EXCLUSIVE',
      title: `Quote for ${customer.displayName}`,
    };
    const totals = calculateQuoteTotals(quotePayload);
    const draft = this.actionDraft({
      description: `Create a draft quote for ${customer.displayName}.`,
      entityId: null,
      entityType: 'QUOTE',
      payload: { quotePayload, type: 'CREATE_QUOTE' },
      proposedChanges: [
        { label: 'Customer', to: customer.displayName },
        ...totals.lineItems.flatMap((item, index) => [
          { label: `Line ${index + 1}`, to: item.name },
          {
            label: 'Amount',
            to: `${item.quantity} ${item.unit} × ${formatAudCents(
              item.unitPriceCents,
            )} = ${formatAudCents(item.lineSubtotalCents)}`,
          },
        ]),
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
    slotSearch?: string,
  ): Promise<{ match: CustomerMatch | null; message: string }> {
    if (contextCustomerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { businessId, id: contextCustomerId, isArchived: false },
        include: { sites: { where: { isArchived: false } } },
      });
      if (customer) return { match: customer, message: '' };
    }
    const candidate = this.extractCustomerSearch(text) || slotSearch?.trim();
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

  private assistantMessage(
    content: string,
    actionDraft?: ToriActionDraft,
  ): ToriChatResponse['message'] {
    return {
      actionDraft,
      content,
      createdAt: new Date().toISOString(),
      id: randomUUID(),
      role: 'assistant',
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

  private async resolveAppointmentJobForCustomer(
    businessId: string,
    customerId: string,
  ): Promise<{
    job: NonNullable<
      Awaited<ReturnType<AiService['loadAppointmentJob']>>
    > | null;
    message: string;
  }> {
    const jobs = await this.prisma.job.findMany({
      include: {
        customer: { include: { sites: { where: { isArchived: false } } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      where: {
        businessId,
        customerId,
        isArchived: false,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
    });
    if (jobs.length === 1) return { job: jobs[0], message: '' };
    if (jobs.length > 1) {
      return {
        job: null,
        message: `I found multiple active jobs for that customer. Which job should I schedule? ${jobs
          .map((job) => `${job.jobNumber} — ${job.title}`)
          .join('; ')}`,
      };
    }
    return {
      job: null,
      message: `I found that customer, but they don't have an active job to schedule. Would you like me to prepare a job for them?`,
    };
  }

  private async resolveAppointmentJobSelection(
    businessId: string,
    customerId: string,
    text: string,
  ) {
    const lower = text.toLowerCase();
    const jobs = await this.prisma.job.findMany({
      include: {
        customer: { include: { sites: { where: { isArchived: false } } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      where: {
        businessId,
        customerId,
        isArchived: false,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
    });
    return (
      jobs.find(
        (job) =>
          lower.includes(job.jobNumber.toLowerCase()) ||
          lower.includes(job.title.toLowerCase()),
      ) ?? null
    );
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

  private appointmentLocationFromJob(job: {
    accessInstructions?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    postcode?: string | null;
    state?: string | null;
    suburb?: string | null;
    customer: {
      addressLine1?: string | null;
      addressLine2?: string | null;
      postcode?: string | null;
      state?: string | null;
      suburb?: string | null;
      sites: Array<{
        id: string;
        accessInstructions?: string | null;
        addressLine1: string;
        addressLine2?: string | null;
        postcode: string;
        state: string;
        suburb: string;
        isPrimary: boolean;
      }>;
    };
  }): ToriAppointmentLocation | null {
    const matchingSite = job.customer.sites.find((site) =>
      this.addressesMatch(site, job),
    );
    if (matchingSite) {
      return {
        accessInstructions: matchingSite.accessInstructions,
        addressLine1: matchingSite.addressLine1,
        addressLine2: matchingSite.addressLine2,
        customerSiteId: matchingSite.id,
        locationSource: 'CUSTOMER_SITE',
        postcode: matchingSite.postcode,
        state: matchingSite.state as AppointmentPayload['state'],
        suburb: matchingSite.suburb,
      };
    }

    if (this.hasCompleteAddress(job)) {
      return {
        accessInstructions: job.accessInstructions,
        addressLine1: job.addressLine1,
        addressLine2: job.addressLine2,
        customerSiteId: null,
        locationSource: 'MANUAL',
        postcode: job.postcode,
        state: job.state as AppointmentPayload['state'],
        suburb: job.suburb,
      };
    }

    const site = this.singleUsableSite(job.customer.sites);
    if (site) {
      return {
        accessInstructions: site.accessInstructions,
        addressLine1: site.addressLine1,
        addressLine2: site.addressLine2,
        customerSiteId: site.id,
        locationSource: 'CUSTOMER_SITE',
        postcode: site.postcode,
        state: site.state as AppointmentPayload['state'],
        suburb: site.suburb,
      };
    }

    if (this.hasCompleteAddress(job.customer)) {
      return {
        accessInstructions: null,
        addressLine1: job.customer.addressLine1,
        addressLine2: job.customer.addressLine2,
        customerSiteId: null,
        locationSource: 'CUSTOMER_DEFAULT',
        postcode: job.customer.postcode,
        state: job.customer.state as AppointmentPayload['state'],
        suburb: job.customer.suburb,
      };
    }

    return null;
  }

  private hasCompleteAddress(address: {
    addressLine1?: string | null;
    postcode?: string | null;
    state?: string | null;
    suburb?: string | null;
  }): address is {
    addressLine1: string;
    postcode: string;
    state: string;
    suburb: string;
  } {
    return Boolean(
      address.addressLine1 &&
      address.suburb &&
      address.state &&
      address.postcode,
    );
  }

  private addressesMatch(
    left: {
      addressLine1?: string | null;
      postcode?: string | null;
      state?: string | null;
      suburb?: string | null;
    },
    right: {
      addressLine1?: string | null;
      postcode?: string | null;
      state?: string | null;
      suburb?: string | null;
    },
  ) {
    return (
      this.addressPart(left.addressLine1) ===
        this.addressPart(right.addressLine1) &&
      this.addressPart(left.suburb) === this.addressPart(right.suburb) &&
      this.addressPart(left.state) === this.addressPart(right.state) &&
      this.addressPart(left.postcode) === this.addressPart(right.postcode)
    );
  }

  private addressPart(value?: string | null) {
    return value?.trim().replace(/\s+/g, ' ').toLowerCase() ?? '';
  }

  private addressKey(address: {
    addressLine1?: string | null;
    postcode?: string | null;
    state?: string | null;
    suburb?: string | null;
  }) {
    return [
      this.addressPart(address.addressLine1),
      this.addressPart(address.suburb),
      this.addressPart(address.state),
      this.addressPart(address.postcode),
    ].join('|');
  }

  private async appointmentDraftFromPending(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    context: ToriContext,
  ): Promise<DraftPreparation> {
    const pending = context.pendingAppointment;
    if (
      !pending?.jobId ||
      !pending.date ||
      !pending.time ||
      !pending.durationMinutes
    ) {
      return {
        content:
          'I still need the customer, job, date, start time and duration.',
      };
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
    const location = this.appointmentLocationFromJob(job);
    if (!location) {
      return {
        content:
          'I need a service location before I can prepare an appointment draft. Which service address should I use?',
        context,
      };
    }
    const appointmentPayload: AppointmentPayload = {
      accessInstructions: location.accessInstructions ?? undefined,
      addressLine1: location.addressLine1,
      addressLine2: location.addressLine2 ?? undefined,
      appointmentType: 'INSPECTION',
      assignedUserId: null,
      customerSiteId: location.customerSiteId,
      estimatedDurationMinutes: pending.durationMinutes,
      jobId: job.id,
      locationSource: location.locationSource,
      notes: 'Prepared by Tori. Review before saving.',
      postcode: location.postcode,
      scheduledEnd: end.toISOString(),
      scheduledStart: start.toISOString(),
      state: location.state,
      suburb: location.suburb,
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
          to: this.addressLabel(location),
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

  private async technicianRecommendationsForAppointment(
    currentUser: AuthenticatedUser,
    business: BusinessSummary,
    appointment: NonNullable<
      Awaited<ReturnType<AiService['resolveAppointment']>>
    >,
  ) {
    const members = await this.prisma.businessMember.findMany({
      where: {
        businessId: currentUser.businessId,
        role: { in: [...APPOINTMENT_ASSIGNABLE_TECHNICIAN_ROLES] },
        status: 'ACTIVE',
        user: { isActive: true },
        userId: { not: null },
      },
      include: {
        user: {
          select: {
            email: true,
            firstName: true,
            id: true,
            lastName: true,
          },
        },
      },
      orderBy: [{ joinedAt: 'asc' }],
    });
    const technicians = members
      .map((member) =>
        member.user
          ? {
              email: member.user.email,
              name: this.userLabel(member.user),
              role: member.role,
              userId: member.user.id,
            }
          : null,
      )
      .filter((member): member is NonNullable<typeof member> =>
        Boolean(member),
      );
    const dayRange = getBusinessDayRangeUtc(
      appointment.scheduledStart,
      business.timezone,
    );
    const dayAppointments = await this.prisma.appointment.findMany({
      where: {
        assignedUserId: { in: technicians.map((item) => item.userId) },
        businessId: currentUser.businessId,
        scheduledStart: { gte: dayRange.start, lt: dayRange.end },
        status: { notIn: [...CLOSED_APPOINTMENT_STATUSES] },
      },
      select: {
        assignedUserId: true,
        scheduledEnd: true,
        scheduledStart: true,
      },
    });

    const candidates = await Promise.all(
      technicians.map(async (technician) => {
        const availability = await this.appointments.availability(currentUser, {
          assignedUserId: technician.userId,
          excludeAppointmentId: appointment.id,
          scheduledEnd: appointment.scheduledEnd.toISOString(),
          scheduledStart: appointment.scheduledStart.toISOString(),
        });
        const technicianAppointments = dayAppointments.filter(
          (item) => item.assignedUserId === technician.userId,
        );
        const scheduledMinutes = technicianAppointments.reduce(
          (sum, item) =>
            sum +
            Math.max(
              0,
              Math.round(
                (item.scheduledEnd.getTime() - item.scheduledStart.getTime()) /
                  60_000,
              ),
            ),
          0,
        );
        return {
          ...technician,
          availabilityReason: availability.reason,
          conflicts: availability.conflicts,
          isAvailable: !availability.hasConflict,
          scheduledMinutes,
          todayWorkload: technicianAppointments.length,
        };
      }),
    );

    return candidates.sort(
      (left, right) =>
        Number(right.isAvailable) - Number(left.isAvailable) ||
        left.scheduledMinutes - right.scheduledMinutes ||
        left.todayWorkload - right.todayWorkload ||
        left.name.localeCompare(right.name) ||
        left.userId.localeCompare(right.userId),
    );
  }

  private async findTechnicianMention(businessId: string, lower: string) {
    const members = await this.prisma.businessMember.findMany({
      where: {
        businessId,
        role: { in: [...APPOINTMENT_ASSIGNABLE_TECHNICIAN_ROLES] },
        status: 'ACTIVE',
        user: { isActive: true },
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

  private async findAnyMemberMention(businessId: string, lower: string) {
    const members = await this.prisma.businessMember.findMany({
      where: {
        businessId,
        status: 'ACTIVE',
        user: { isActive: true },
        userId: { not: null },
      },
      include: { user: true },
      take: 50,
    });
    return (
      members.find((member) => {
        if (!member.user) return false;
        const name = this.userLabel(member.user).toLowerCase();
        return (
          lower.includes(name) ||
          lower.includes(member.user.firstName.toLowerCase()) ||
          lower.includes(member.user.email.toLowerCase().split('@')[0])
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

  private parseWordTimeString(text: string) {
    const lower = text.toLowerCase().trim();
    const words: Record<string, number> = {
      eight: 8,
      eleven: 11,
      five: 17,
      four: 16,
      nine: 9,
      one: 13,
      seven: 19,
      six: 18,
      ten: 10,
      three: 15,
      twelve: 12,
      two: 14,
    };
    const word = Object.keys(words).find((candidate) =>
      new RegExp(`\\b(?:around|about|at)?\\s*${candidate}\\b`).test(lower),
    );
    if (!word) return null;
    return `${String(words[word]).padStart(2, '0')}:00`;
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
    const wordHourMatch = text.match(
      /\b(?:an?|one|two)\s+(?:hours?|hrs?|h)\b/i,
    );
    if (wordHourMatch) {
      const word = wordHourMatch[0].toLowerCase();
      if (/\btwo\b/.test(word)) return 120;
      return 60;
    }
    const minuteMatch = text.match(/\b(\d+)\s*(minutes?|mins?|mons?|m)\b/i);
    return minuteMatch ? Number(minuteMatch[1]) : null;
  }

  private durationSpanRegex() {
    return /\b(?:for\s+)?(?:(?:\d+(?:\.\d+)?)\s*(?:minutes?|mins?|min|mons?|hours?|hrs?|hr|h)|(?:an?|one|two)\s+(?:hours?|hrs?|hr|h))\b/gi;
  }

  private parseLineItems(text: string): QuotePayload['lineItems'] {
    const items: QuotePayload['lineItems'] = [];
    const cleaned = this.cleanQuoteLineItemText(text);
    const segments = cleaned
      .split(/\s*(?:,|;|\band\b|\bplus\b|&)\s*/i)
      .map((segment) => segment.trim())
      .filter(Boolean);

    for (const segment of segments) {
      const parsed = this.parseQuoteLineItemSegment(segment);
      if (parsed) items.push(parsed);
    }

    if (!items.length) {
      const parsed = this.parseQuoteLineItemSegment(cleaned);
      if (parsed) items.push(parsed);
    }
    return items;
  }

  private cleanQuoteLineItemText(text: string) {
    return text
      .replace(
        /\b(?:create|prepare|draft)\s+(?:a\s+)?quote\s+for\s+[A-Za-z][A-Za-z\s'-]{1,80}?(?:\s+with\b|:|$)/gi,
        ' ',
      )
      .replace(
        /\bquote\s+[A-Za-z][A-Za-z\s'-]{1,80}?(?=\s+\$|\s+\d|\s+with\b|:|$)/gi,
        ' ',
      )
      .replace(/\bwith\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private parseQuoteLineItemSegment(
    segment: string,
  ): QuotePayload['lineItems'][number] | null {
    const trimmed = segment.trim().replace(/\s+/g, ' ');
    if (!trimmed) return null;

    const labourWithQuantity =
      trimmed.match(
        /\b(\d+(?:\.\d{1,3})?)\s*(hours?|hrs?|hr|h)\b[^\d$]*(?:\$?\s*([\d,]+(?:\.\d{1,2})?)\s*\$?(?:\s*\/\s*(?:hour|hr|h))?)/i,
      ) ??
      trimmed.match(
        /\b(\d+)\s*(minutes?|mins?|min)\b[^\d$]*(?:\$?\s*([\d,]+(?:\.\d{1,2})?)\s*\$?(?:\s*\/\s*(?:hour|hr|h))?)/i,
      );
    if (labourWithQuantity) {
      const quantity = /min/i.test(labourWithQuantity[2])
        ? this.normaliseQuoteQuantity(
            String(Number(labourWithQuantity[1]) / 60),
          )
        : this.normaliseQuoteQuantity(labourWithQuantity[1]);
      const unitPriceCents = this.quoteMoneyToCents(labourWithQuantity[3]);
      if (quantity && unitPriceCents !== null) {
        return {
          name: 'Labour',
          quantity,
          taxable: true,
          type: 'LABOUR',
          unit: 'hour',
          unitPriceCents,
        };
      }
    }

    const labourTotal = trimmed.match(
      /\blabou?r(?:\s+total)?\s*(?:\$?\s*([\d,]+(?:\.\d{1,2})?)\s*\$?)/i,
    );
    if (labourTotal) {
      const unitPriceCents = this.quoteMoneyToCents(labourTotal[1]);
      if (unitPriceCents !== null) {
        return {
          name: 'Labour',
          quantity: '1',
          taxable: true,
          type: 'LABOUR',
          unit: 'item',
          unitPriceCents,
        };
      }
    }

    const material =
      trimmed.match(
        /\b(materials?|parts?|supplies|hardware)\b(?:\s+cost)?\s*(?:\$?\s*([\d,]+(?:\.\d{1,2})?)\s*\$?)/i,
      ) ??
      trimmed.match(
        /(?:\$?\s*([\d,]+(?:\.\d{1,2})?)\s*\$?)\s*\b(materials?|parts?|supplies|hardware)\b/i,
      );
    if (material) {
      const money = material[2] ?? material[1];
      const label =
        material[1] && Number.isNaN(Number(material[1].replace(/,/g, '')))
          ? material[1]
          : material[2];
      const unitPriceCents = this.quoteMoneyToCents(money);
      if (unitPriceCents !== null) {
        return {
          name: this.quoteItemName(label ?? 'Materials'),
          quantity: '1',
          taxable: true,
          type: 'MATERIAL',
          unit: 'item',
          unitPriceCents,
        };
      }
    }

    const namedItem =
      trimmed.match(
        /\b([A-Za-z][A-Za-z\s'-]{1,40}?)\s*(?:\$?\s*([\d,]+(?:\.\d{1,2})?)\s*\$?)$/i,
      ) ??
      trimmed.match(
        /^(?:\$?\s*([\d,]+(?:\.\d{1,2})?)\s*\$?)\s*([A-Za-z][A-Za-z\s'-]{1,40})\b/i,
      );
    if (namedItem) {
      const name = Number.isNaN(Number(namedItem[1]?.replace(/,/g, '')))
        ? namedItem[1]
        : namedItem[2];
      const money = Number.isNaN(Number(namedItem[1]?.replace(/,/g, '')))
        ? namedItem[2]
        : namedItem[1];
      const unitPriceCents = this.quoteMoneyToCents(money);
      if (
        name &&
        unitPriceCents !== null &&
        !this.isIgnoredQuoteItemName(name)
      ) {
        return {
          name: this.quoteItemName(name),
          quantity: '1',
          taxable: true,
          type: this.quoteLineItemTypeForName(name),
          unit: 'item',
          unitPriceCents,
        };
      }
    }

    const serviceAmount = trimmed.match(/^\$?\s*([\d,]+(?:\.\d{1,2})?)\s*\$?$/);
    const unitPriceCents = serviceAmount
      ? this.quoteMoneyToCents(serviceAmount[1])
      : null;
    return unitPriceCents === null
      ? null
      : {
          name: 'Service',
          quantity: '1',
          taxable: true,
          type: 'SERVICE',
          unit: 'item',
          unitPriceCents,
        };
  }

  private normaliseQuoteQuantity(value: string) {
    const rounded = Math.round(Number(value) * 1000) / 1000;
    if (!Number.isFinite(rounded) || rounded <= 0) return null;
    return String(rounded)
      .replace(/\.0+$/, '')
      .replace(/(\.\d*?)0+$/, '$1');
  }

  private quoteMoneyToCents(value?: string) {
    if (!value) return null;
    const parsed = parseQuoteMoneyInput(value.replace(/[$,\s]/g, ''));
    return parsed.error ? null : parsed.value;
  }

  private quoteItemName(value: string) {
    const cleaned = value.replace(/\s+/g, ' ').trim();
    if (/^parts?$/i.test(cleaned)) return 'Parts';
    if (/^supplies$/i.test(cleaned)) return 'Supplies';
    if (/^hardware$/i.test(cleaned)) return 'Hardware';
    if (/^materials?$/i.test(cleaned)) return 'Materials';
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
  }

  private quoteLineItemTypeForName(
    name: string,
  ): QuotePayload['lineItems'][number]['type'] {
    return /\b(tap|washer|materials?|parts?|supplies|hardware)\b/i.test(name)
      ? 'MATERIAL'
      : 'SERVICE';
  }

  private isIgnoredQuoteItemName(name: string) {
    return /^(quote|create quote|for|with|and|plus)$/i.test(name.trim());
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

  private mergeJobSlotsForCurrentTurn(
    existing: JobDraftSlots,
    text: string,
    request: ToriChatRequest,
    intent: NonNullable<
      ToriContext['pendingQuestion']
    >['intent'] = 'CREATE_JOB',
  ): JobDraftSlots {
    const expected = request.context?.pendingQuestion;
    if (expected?.intent === intent) {
      if (expected.type === 'JOB_TITLE') {
        const title = this.cleanJobTitleSlot(text);
        return {
          ...existing,
          ...(title
            ? {
                description: existing.description ?? title,
                title,
              }
            : {}),
        };
      }
      if (expected.type === 'JOB_ADDRESS') {
        const address = this.extractAustralianAddressSlot(text);
        return {
          ...existing,
          ...(address ?? {}),
        };
      }
    }

    const extracted = this.jobSlots(text, request);
    return {
      ...existing,
      ...extracted,
      customerId: existing.customerId ?? extracted.customerId,
      customerName: existing.customerName ?? extracted.customerName,
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
        /\b(?:create|crete|add)\s+(?:a\s+|new\s+)?customer\s+([A-Za-z][A-Za-z\s'-]{1,80}?)(?:\s+(?:phone|email|at|on|for|and|to)\b|$)/i,
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
    const raw = match?.[1] ?? '';
    if (!raw) return '';
    const lower = raw.toLowerCase().trim();
    if (
      this.referencesKnownCustomer(lower) ||
      /^(her|him|them|this customer|that customer|the customer|newly created customer|created customer|customer above)$/.test(
        lower,
      )
    ) {
      return '';
    }
    return this.cleanExtractedName(raw.replace(/\s+customer$/i, ''));
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

  private cleanJobTitleSlot(text: string) {
    const trimmed = text.trim().replace(/\s+/g, ' ');
    if (!trimmed || trimmed.length > 120) return '';
    if (this.looksLikeExplicitCreateJob(trimmed.toLowerCase())) return '';
    if (this.isPositiveConfirmation(trimmed.toLowerCase())) return '';
    if (this.isNegativeConfirmation(trimmed.toLowerCase())) return '';
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }

  private extractTradeType(text: string) {
    if (/\bplumb|pipe|leak|tap|toilet|sink\b/i.test(text)) return 'Plumbing';
    if (/\belectric|power|light|switch\b/i.test(text)) return 'Electrical';
    if (/\bclean|cleaning\b/i.test(text)) return 'Cleaning';
    return undefined;
  }

  private extractAustralianAddress(
    text: string,
  ): AustralianAddressSlots | null {
    const result = this.parseAustralianAddressSlot(text);
    return result.status === 'VALID' ? result.address : null;
  }

  private extractAustralianAddressSlot(
    text: string,
  ): AustralianAddressSlots | null {
    const result = this.parseAustralianAddressSlot(text);
    return result.status === 'VALID' ? result.address : null;
  }

  private parseAustralianAddressSlot(
    text: string,
  ): AustralianAddressParseResult {
    const streetTypes =
      '(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Lane|Ln|Way|Place|Pl|Boulevard|Blvd|Terrace|Tce|Highway|Hwy|Parade|Pde|Close|Cl|Crescent|Cres|Circuit|Cct)';
    const stateCodes = '(?:VIC|NSW|QLD|SA|WA|TAS|ACT|NT)';
    const normalizedText = text.trim().replace(/\s+/g, ' ');
    const match = normalizedText.match(
      new RegExp(
        `\\b(\\d+\\s+[A-Za-z][A-Za-z0-9\\s'-]*?\\s+${streetTypes})\\s*,?\\s+([A-Za-z][A-Za-z\\s'-]*?)\\s*,?\\s*(?:(${stateCodes})\\s*,?\\s*)?(\\d{4})(?:[,.]|\\b)`,
        'i',
      ),
    );

    if (!match) return { status: 'INVALID' };

    const explicitState = match[3]?.toUpperCase();
    const postcode = match[4];
    const inferredState = this.inferAustralianStateFromPostcode(postcode);
    if (
      explicitState &&
      this.isAustralianState(explicitState) &&
      inferredState &&
      explicitState !== inferredState
    ) {
      return {
        message: `That address has state ${explicitState} but postcode ${postcode} looks like ${inferredState}. Please send the correct state and postcode for the service address.`,
        status: 'STATE_POSTCODE_CONFLICT',
      };
    }

    const state =
      explicitState && this.isAustralianState(explicitState)
        ? explicitState
        : inferredState;
    if (!state) return { status: 'INVALID' };

    return {
      address: {
        addressLine1: match[1].trim(),
        postcode,
        state,
        suburb: this.cleanExtractedName(match[2]),
      },
      status: 'VALID',
    };
  }

  private inferAustralianStateFromPostcode(
    postcode: string,
  ): AustralianState | null {
    const numericPostcode = Number.parseInt(postcode, 10);
    if (!Number.isInteger(numericPostcode)) return null;
    if (
      (numericPostcode >= 200 && numericPostcode <= 299) ||
      (numericPostcode >= 2600 && numericPostcode <= 2618) ||
      (numericPostcode >= 2900 && numericPostcode <= 2920)
    ) {
      return 'ACT';
    }
    if (numericPostcode >= 800 && numericPostcode <= 999) return 'NT';
    if (
      (numericPostcode >= 3000 && numericPostcode <= 3999) ||
      (numericPostcode >= 8000 && numericPostcode <= 8999)
    ) {
      return 'VIC';
    }
    if (
      (numericPostcode >= 1000 && numericPostcode <= 2599) ||
      (numericPostcode >= 2620 && numericPostcode <= 2899) ||
      (numericPostcode >= 2921 && numericPostcode <= 2999)
    ) {
      return 'NSW';
    }
    if (
      (numericPostcode >= 4000 && numericPostcode <= 4999) ||
      (numericPostcode >= 9000 && numericPostcode <= 9999)
    ) {
      return 'QLD';
    }
    if (numericPostcode >= 5000 && numericPostcode <= 5999) return 'SA';
    if (numericPostcode >= 6000 && numericPostcode <= 6999) return 'WA';
    if (numericPostcode >= 7000 && numericPostcode <= 7999) return 'TAS';
    return null;
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
    const site = this.singleUsableServiceSite(customer);
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

  private singleUsableServiceSite(customer: CustomerMatch) {
    return this.singleUsableSite(customer.sites);
  }

  private singleUsableSite<
    TSite extends {
      isPrimary: boolean;
    },
  >(sites: TSite[]) {
    if (sites.length === 1) return sites[0];
    return sites.find((item) => item.isPrimary) ?? null;
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

  private cleanCustomerNameCandidate(value?: string) {
    if (!value) return '';
    const cleaned = this.cleanExtractedName(value)
      .replace(
        /\b(?:please|today|tomorrow|morning|afternoon|evening|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{1,2}(?:st|nd|rd|th)?)\b/gi,
        '',
      )
      .trim();
    if (!cleaned || cleaned.length > 80) return '';
    if (this.looksLikeServiceIssue(cleaned)) return '';
    if (
      /^(someone|somone|somebody|technician|tradie|appointment|the above|above|that|this)$/i.test(
        cleaned,
      )
    ) {
      return '';
    }
    return cleaned;
  }

  private extractJobNumber(text: string) {
    return text.match(/\bJOB-\d{4}-\d{6}\b/i)?.[0]?.toUpperCase();
  }

  private normalisedIntentTokens(text: string) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(
        (token) =>
          token.length > 2 &&
          !['fix', 'the', 'and', 'job', 'for', 'with'].includes(token),
      );
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

  private isExpectedQuoteLineItems(context?: ToriContext) {
    return (
      context?.pendingQuestion?.intent === 'CREATE_QUOTE' &&
      context.pendingQuestion.type === 'QUOTE_LINE_ITEMS' &&
      Boolean(context.pendingQuote?.customerId)
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

  private looksLikeTechnicianRecommendation(lower: string) {
    return (
      /\b(who|which)\b.*\b(available|free|take|best technician)\b/.test(
        lower,
      ) ||
      /\brecommend\b.*\b(technician|someone)\b/.test(lower) ||
      /\bwho can take\b/.test(lower)
    );
  }

  private looksLikeTechnicianAssignment(lower: string) {
    return (
      /\bassign\b.*\b(best|available|someone|whoever|free|least busy|technician)\b/.test(
        lower,
      ) || /\bassign\b/.test(lower)
    );
  }

  private looksLikeBestTechnicianAssignment(lower: string) {
    return /\b(best|available|someone|whoever|free|least busy|technician)\b/.test(
      lower,
    );
  }

  private looksLikeCreateAppointment(lower: string) {
    return (
      /\b(book|schedule)\b.*\bappointment\b/.test(lower) ||
      /\bcrea(?:te|n)\b.*\bappointment\b/.test(lower) ||
      /\bcreate appointment\b/.test(lower)
    );
  }

  private looksLikeDispatchRequest(lower: string) {
    return (
      (/\b(new customer|customer|called)\b/.test(lower) ||
        /\b\d{4}[\s-]?\d{3}[\s-]?\d{3}\b/.test(lower)) &&
      /\b(book(?:ing)?|schedule|scheduling|send(?:ing)? someone|someone|appointment)\b/.test(
        lower,
      ) &&
      /\b(today|tomorrow|morning|afternoon|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\/\d{1,2})\b/.test(
        lower,
      ) &&
      /\b(blocked|leaking|broken|sink|toilet|tap|hot water|repair|fix)\b/.test(
        lower,
      )
    );
  }

  private looksLikeExplicitCreateCustomerAndJob(lower: string) {
    if (this.looksLikeCreateJobForReferencedCustomer(lower)) {
      return false;
    }
    return (
      (/\b(creat|create|crete|add)\b/.test(lower) &&
        /\bcustomer\b/.test(lower) &&
        /\b(job|hob)\b/.test(lower)) ||
      (/\bcustomer\b/.test(lower) &&
        /(?:&|\band\b|\bwith\b)/.test(lower) &&
        /\b(job|hob)\b/.test(lower))
    );
  }

  private looksLikeExplicitCreateCustomer(lower: string) {
    return (
      /\b(create|crete|add)\b.*\bcustomer\b/.test(lower) ||
      /\badd\s+[a-z][a-z\s'-]{1,80}\s+as\s+(?:a\s+)?customer\b/i.test(lower)
    );
  }

  private looksLikeExplicitCreateJob(lower: string) {
    return /\b(create|add|prepare)\b.*\bjob\b/.test(lower);
  }

  private looksLikeCreateJobForReferencedCustomer(lower: string) {
    return (
      this.looksLikeExplicitCreateJob(lower) &&
      this.referencesKnownCustomer(lower)
    );
  }

  private referencesKnownCustomer(lower: string) {
    return (
      /\b(newly created|just created|created)\s+customer\b/.test(lower) ||
      /\b(this|that|the|above)\s+customer\b/.test(lower) ||
      /\bcustomer\s+(above|mentioned|we just created)\b/.test(lower) ||
      /\bfor\s+(her|him|them)\b/.test(lower) ||
      /\banother\s+job\s+for\s+this\s+customer\b/.test(lower)
    );
  }

  private looksLikeCreateCustomerAndJob(
    lower: string,
    request: ToriChatRequest,
  ) {
    if (this.looksLikeCreateJobForReferencedCustomer(lower)) {
      return false;
    }
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
      /\b(create|crete|add)\b.*\bcustomer\b/.test(lower) ||
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
      (/\b(quote|estimate)\b/.test(lower) &&
        /\b(prepare|create|draft|make|new|start)\b/.test(lower)) ||
      /\bnew\s+(quote|estimate)\b/.test(lower) ||
      /\b(quote|estimate)\s+(this\s+)?(job|customer)\b/.test(lower) ||
      /\bquote\s+[a-z][a-z\s'-]{1,80}\b.*(?:\$|\bhours?\b|\bhrs?\b|\bmaterials?\b|\bparts?\b|\bcallout\b)/i.test(
        lower,
      )
    );
  }

  private looksLikeCreateInvoice(lower: string) {
    return (
      (/\binvoice\b/.test(lower) &&
        /\b(create|draft|prepare|make|new)\b/.test(lower)) ||
      /\bnew\s+invoice\b/.test(lower) ||
      /\binvoice\s+(this\s+)?(job|customer)\b/.test(lower) ||
      /\bbill\s+(this\s+)?(job|customer)\b/.test(lower)
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
      request.context?.pendingDispatch ||
      request.context?.pendingQuestion ||
      this.looksLikePendingCustomerAndJob(request) ||
      this.looksLikePendingCustomer(request) ||
      this.looksLikePendingJob(request),
    );
  }

  private isCancelCommand(lower: string) {
    return /^(cancel(?: this)?|stop|never mind|nevermind|forget it)$/i.test(
      lower.trim(),
    );
  }

  private isPositiveConfirmation(lower: string) {
    return /^(yes|yes please|yep|yeah|yea|yup|sure|okay|ok|do it|please|please do|go ahead|sounds good|that's fine|that is fine|correct|use it|use that|use this)$/i.test(
      lower.trim().replace(/[.!?]+$/g, ''),
    );
  }

  private isNegativeConfirmation(lower: string) {
    return /^(no|no thanks|not now|nope|nah|don't|do not|cancel|stop|leave it|not that one|choose another)$/i.test(
      lower.trim().replace(/[.!?]+$/g, ''),
    );
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
      pendingChoice,
      pendingDispatch,
      pendingJob,
      pendingQuote,
      pendingQuestion,
      workflow,
      ...rest
    } = context;
    void pendingAppointment;
    void pendingCustomer;
    void pendingCustomerAndJob;
    void pendingChoice;
    void pendingDispatch;
    void pendingJob;
    void pendingQuote;
    void pendingQuestion;
    void workflow;
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
