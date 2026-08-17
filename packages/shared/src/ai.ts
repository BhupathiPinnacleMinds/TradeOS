import type {
  AppointmentPayload,
  AppointmentReassignmentPayload,
} from './appointments';
import type { BusinessRole } from './auth';
import type { ManualCustomerCommunicationPayload } from './communications';
import type { CustomerPayload } from './customers';
import type { InvoicePayload } from './invoices';
import type { JobPayload } from './jobs';
import type { QuotePayload } from './quotes';

export const TORI_ACTION_TYPES = [
  'RESCHEDULE_APPOINTMENT',
  'REASSIGN_TECHNICIAN',
  'CANCEL_APPOINTMENT',
  'CREATE_APPOINTMENT',
  'CREATE_QUOTE',
  'CREATE_INVOICE',
  'SEND_CUSTOMER_MESSAGE',
  'CREATE_CUSTOMER',
  'CREATE_JOB',
  'CREATE_CUSTOMER_AND_JOB',
] as const;

export type ToriActionType = (typeof TORI_ACTION_TYPES)[number];

export type ToriActionStatus =
  | 'DRAFT'
  | 'AWAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'FAILED'
  | 'STALE';

export type ToriActionValidationState =
  'READY' | 'NEEDS_CLARIFICATION' | 'CONFLICT' | 'STALE' | 'PERMISSION_DENIED';

export type ToriEntityType =
  'APPOINTMENT' | 'CUSTOMER' | 'JOB' | 'QUOTE' | 'INVOICE' | 'COMMUNICATION';

export interface ToriProviderStatus {
  configured: boolean;
  mode: 'LOCAL_DETERMINISTIC' | 'OPENAI';
  model: string | null;
  message: string;
}

export interface ToriContext {
  appointmentId?: string;
  customerId?: string;
  customerName?: string;
  jobId?: string;
  jobNumber?: string;
  jobTitle?: string;
  serviceLocation?: {
    addressLine1: string;
    suburb: string;
    state: string;
    postcode: string;
  };
  quoteId?: string;
  invoiceId?: string;
  pendingQuestion?: {
    type:
      | 'YES_NO'
      | 'APPOINTMENT_CUSTOMER'
      | 'APPOINTMENT_JOB'
      | 'APPOINTMENT_DATE'
      | 'APPOINTMENT_TIME'
      | 'APPOINTMENT_DURATION'
      | 'CUSTOMER_NAME'
      | 'CUSTOMER_CONTACT'
      | 'JOB_TITLE'
      | 'JOB_ADDRESS';
    intent:
      | 'CREATE_APPOINTMENT_FOR_JOB'
      | 'CREATE_JOB'
      | 'CREATE_CUSTOMER'
      | 'CREATE_CUSTOMER_AND_JOB';
  };
  pendingCustomer?: {
    firstName?: string;
    lastName?: string;
    companyName?: string;
    phone?: string;
    email?: string;
  };
  pendingCustomerAndJob?: {
    customer: {
      firstName?: string;
      lastName?: string;
      companyName?: string;
      phone?: string;
      email?: string;
    };
    job: {
      title?: string;
      description?: string;
      addressLine1?: string;
      suburb?: string;
      state?: string;
      postcode?: string;
    };
  };
  pendingJob?: {
    customerId?: string;
    customerName?: string;
    title?: string;
    description?: string;
    addressLine1?: string;
    suburb?: string;
    state?: string;
    postcode?: string;
    resumeAppointment?: ToriContext['pendingAppointment'];
  };
  pendingAppointment?: {
    customerId?: string;
    customerName?: string;
    jobId?: string;
    jobNumber?: string;
    jobTitle?: string;
    serviceLocation?: {
      addressLine1: string;
      suburb: string;
      state: string;
      postcode: string;
    };
    date?: string;
    time?: string;
    durationMinutes?: number;
  };
}

export interface ToriChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  actionDraft?: ToriActionDraft;
}

export interface ToriChatRequest {
  message: string;
  context?: ToriContext;
  recentMessages?: Array<Pick<ToriChatMessage, 'role' | 'content'>>;
}

export interface ToriSnapshot {
  todayAppointments: number;
  unassignedAppointments: number;
  quotesAwaitingResponse: number;
  outstandingInvoicesCents: number;
  overdueInvoicesCents: number;
}

export type ToriActionPayload =
  | {
      type: 'RESCHEDULE_APPOINTMENT';
      appointmentId: string;
      appointmentPayload: AppointmentPayload;
      expectedUpdatedAt: string;
    }
  | {
      type: 'REASSIGN_TECHNICIAN';
      appointmentId: string;
      reassignmentPayload: AppointmentReassignmentPayload;
      expectedUpdatedAt: string;
    }
  | {
      type: 'CANCEL_APPOINTMENT';
      appointmentId: string;
      expectedUpdatedAt: string;
    }
  | {
      type: 'CREATE_APPOINTMENT';
      appointmentPayload: AppointmentPayload;
    }
  | {
      type: 'CREATE_QUOTE';
      quotePayload: QuotePayload;
    }
  | {
      type: 'CREATE_INVOICE';
      invoicePayload: InvoicePayload;
    }
  | {
      type: 'SEND_CUSTOMER_MESSAGE';
      communicationPayload: ManualCustomerCommunicationPayload;
    }
  | {
      type: 'CREATE_CUSTOMER';
      customerPayload: CustomerPayload;
    }
  | {
      type: 'CREATE_JOB';
      jobPayload: JobPayload;
      resumeAppointment?: ToriContext['pendingAppointment'];
    }
  | {
      type: 'CREATE_CUSTOMER_AND_JOB';
      jobPayload: JobPayload & {
        quickCustomer: NonNullable<JobPayload['quickCustomer']>;
      };
    };

export interface ToriActionDraft<
  TPayload extends ToriActionPayload = ToriActionPayload,
> {
  id: string;
  type: TPayload['type'];
  title: string;
  description: string;
  entityType: ToriEntityType;
  entityId: string | null;
  proposedChanges: Array<{
    label: string;
    from?: string | null;
    to: string;
  }>;
  validationState: ToriActionValidationState;
  warnings: string[];
  requiresConfirmation: true;
  status:
    'DRAFT' | 'AWAITING_CONFIRMATION' | 'COMPLETED' | 'CANCELLED' | 'STALE';
  createdAt: string;
  expiresAt: string;
  payload: TPayload;
}

export interface ToriChatResponse {
  message: ToriChatMessage;
  snapshot: ToriSnapshot;
  provider: ToriProviderStatus;
  suggestedPrompts: string[];
  context?: ToriContext;
}

export interface ConfirmToriActionRequest {
  draft: ToriActionDraft;
}

export interface ToriActionConfirmResponse {
  status: 'COMPLETED';
  message: string;
  entityType: ToriEntityType;
  entityId: string;
  details: Array<{ label: string; value: string }>;
  context?: ToriContext;
}

export const TORI_READ_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
  'TECHNICIAN',
  'ACCOUNTANT',
  'SALES',
  'READ_ONLY',
];

export const TORI_ACTION_ROLES: Record<ToriActionType, BusinessRole[]> = {
  CANCEL_APPOINTMENT: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER'],
  CREATE_APPOINTMENT: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER'],
  CREATE_INVOICE: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'ACCOUNTANT'],
  CREATE_CUSTOMER: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER', 'SALES'],
  CREATE_CUSTOMER_AND_JOB: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER'],
  CREATE_JOB: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER'],
  CREATE_QUOTE: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SALES'],
  REASSIGN_TECHNICIAN: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER'],
  RESCHEDULE_APPOINTMENT: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER'],
  SEND_CUSTOMER_MESSAGE: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER'],
};

export function roleCanUseTori(role: BusinessRole | undefined) {
  return Boolean(role && TORI_READ_ROLES.includes(role));
}

export function roleCanConfirmToriAction(
  role: BusinessRole | undefined,
  action: ToriActionType,
) {
  return Boolean(role && TORI_ACTION_ROLES[action].includes(role));
}
