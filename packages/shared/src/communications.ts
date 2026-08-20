import type { BusinessRole } from './auth';

export const CUSTOMER_COMMUNICATION_CHANNELS = ['EMAIL', 'SMS'] as const;

export const CUSTOMER_COMMUNICATION_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'PROCESSING',
  'SENT',
  'FAILED',
  'CANCELLED',
] as const;

export const CUSTOMER_COMMUNICATION_TYPES = [
  'APPOINTMENT_CONFIRMATION',
  'APPOINTMENT_REMINDER',
  'APPOINTMENT_RESCHEDULED',
  'APPOINTMENT_CANCELLED',
  'QUOTE_SENT',
  'QUOTE_FOLLOW_UP',
  'QUOTE_ACCEPTED',
  'QUOTE_DECLINED',
  'INVOICE_SENT',
  'INVOICE_DUE_SOON',
  'INVOICE_OVERDUE',
  'PAYMENT_RECEIVED',
  'JOB_COMPLETED',
  'MANUAL_MESSAGE',
] as const;

export type CustomerCommunicationChannel =
  (typeof CUSTOMER_COMMUNICATION_CHANNELS)[number];
export type CustomerCommunicationStatus =
  (typeof CUSTOMER_COMMUNICATION_STATUSES)[number];
export type CustomerCommunicationType =
  (typeof CUSTOMER_COMMUNICATION_TYPES)[number];

export interface CustomerCommunication {
  id: string;
  businessId: string;
  customerId: string;
  channel: CustomerCommunicationChannel;
  type: CustomerCommunicationType;
  status: CustomerCommunicationStatus;
  recipient: string;
  subject: string | null;
  message: string;
  preview: string | null;
  relatedJobId: string | null;
  relatedAppointmentId: string | null;
  relatedQuoteId: string | null;
  relatedInvoiceId: string | null;
  relatedPaymentId: string | null;
  idempotencyKey: string;
  scheduledFor: string | null;
  processingStartedAt: string | null;
  processingExpiresAt: string | null;
  sentAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  provider: string | null;
  providerMessageId: string | null;
  cancelledAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerCommunicationListResponse {
  records: CustomerCommunication[];
}

export interface CustomerCommunicationSettings {
  businessId: string;
  appointmentConfirmationsEnabled: boolean;
  appointmentRemindersEnabled: boolean;
  appointmentReminderLeadMinutes: number;
  quoteFollowUpsEnabled: boolean;
  quoteFollowUpDelayMinutes: number;
  invoiceDueSoonRemindersEnabled: boolean;
  invoiceDueSoonLeadMinutes: number;
  invoiceOverdueRemindersEnabled: boolean;
  invoiceOverdueDelayMinutes: number;
  paymentConfirmationsEnabled: boolean;
}

export interface CustomerCommunicationPreferences {
  businessId: string;
  customerId: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
}

export interface ManualCustomerCommunicationPayload {
  customerId: string;
  channel: CustomerCommunicationChannel;
  message: string;
  subject?: string;
}

export const COMMUNICATION_VIEW_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
  'ACCOUNTANT',
  'SALES',
  'READ_ONLY',
];

export const COMMUNICATION_SEND_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
];

export const COMMUNICATION_APPOINTMENT_SEND_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
];

export const COMMUNICATION_QUOTE_SEND_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SALES',
];

export const COMMUNICATION_INVOICE_SEND_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'ACCOUNTANT',
];

export function roleCanViewCommunications(role: BusinessRole | undefined) {
  return Boolean(role && COMMUNICATION_VIEW_ROLES.includes(role));
}

export function roleCanSendManualCommunications(
  role: BusinessRole | undefined,
) {
  return Boolean(role && COMMUNICATION_SEND_ROLES.includes(role));
}
