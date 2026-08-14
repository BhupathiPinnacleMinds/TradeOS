import type {
  AuthResponse,
  AppointmentDetailResponse,
  AppointmentAvailabilityRequest,
  AppointmentAvailabilityResponse,
  AppointmentListResponse,
  AppointmentPayload,
  AppointmentRecommendationRequest,
  AppointmentRecommendationResponse,
  AppointmentReassignmentOptionsResponse,
  AppointmentReassignmentPayload,
  AppointmentSignaturePayload,
  AppointmentTransitionAction,
  AppointmentWorkLogPayload,
  AppointmentStatus,
  BusinessRole,
  CompleteAppointmentPayload,
  CustomerDetailResponse,
  CustomerListResponse,
  CustomerPayload,
  CustomerSite,
  CustomerSitePayload,
  CustomerCommunicationChannel,
  CustomerCommunicationListResponse,
  CustomerCommunicationSettings,
  DispatcherFilter,
  DispatcherViewResponse,
  JobDetailResponse,
  JobListResponse,
  JobPayload,
  JobStatus,
  InvoiceDetailResponse,
  InvoiceListResponse,
  InvoicePayload,
  AccountsReceivableResponse,
  PublicInvoiceResponse,
  QuoteDetailResponse,
  QuoteListResponse,
  QuotePayload,
  PublicQuoteResponse,
  InvitationPreviewResponse,
  InviteMemberResponse,
  LocalMediaUploadRequest,
  MediaAccessResponse,
  MediaDetailResponse,
  MediaListResponse,
  MediaUploadTargetRequest,
  MediaUploadTargetResponse,
  MyDayResponse,
  ResendInvitationResponse,
  TeamMemberDetailResponse,
  TeamMember,
  SkipAppointmentSignaturePayload,
} from '@tradieos/shared';
import { buildAppointmentTransitionPath } from '@tradieos/shared';

declare const process: {
  env?: {
    EXPO_PUBLIC_API_URL?: string;
  };
};

export const apiUrl =
  process.env?.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api';

export function buildApiUrl(path: string, baseUrl = apiUrl) {
  const base = baseUrl.replace(/\/+$/, '');
  const baseIncludesApiPrefix = /\/api$/i.test(base);
  let normalisedPath = path.trim().replace(/^\/+/, '');

  if (baseIncludesApiPrefix) {
    while (
      normalisedPath === 'api' ||
      normalisedPath.toLowerCase().startsWith('api/')
    ) {
      normalisedPath = normalisedPath.slice(3).replace(/^\/+/, '');
    }
  }

  const slashPath = normalisedPath.startsWith('/')
    ? normalisedPath
    : `/${normalisedPath}`;
  return `${base}${slashPath}`;
}

export const buildApiRequestUrl = buildApiUrl;

export function buildMediaListPath(
  params: Record<string, string | number | boolean | undefined> = {},
) {
  return `/media${queryString(params)}`;
}

export function buildMediaFilePath(
  mediaId: string,
  disposition: 'attachment' | 'inline' = 'inline',
) {
  return `/media/${mediaId}/file?disposition=${disposition}`;
}

export function buildMediaPreviewPath(mediaId: string) {
  return `/media/${mediaId}/preview`;
}

export function buildMediaDownloadPath(mediaId: string) {
  return `/media/${mediaId}/download`;
}

export function buildMediaLocalUploadPath(mediaId: string) {
  return `/media/${mediaId}/local-upload`;
}

export function buildMediaAccessUrl(urlOrPath: string, baseUrl = apiUrl) {
  return buildApiUrl(urlOrPath, baseUrl);
}

export function buildAuthenticatedHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export function friendlyAppointmentMutationError(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.code === 'NETWORK_ERROR') {
      return 'Could not connect to TradeOS. Check your connection and retry.';
    }
    if (error.status === 403 || error.code === 'INSUFFICIENT_PERMISSION') {
      return 'You do not have permission to perform this action.';
    }
    if (error.code === 'APPOINTMENT_NOT_FOUND') {
      return 'Appointment could not be found.';
    }
    if (error.code === 'FOLLOW_UP_NOTES_REQUIRED') {
      return 'Please describe the follow-up required.';
    }
    if (error.code === 'WORK_COMPLETED_REQUIRED') {
      return 'Please enter the work completed.';
    }
    if (error.code === 'SIGNATURE_REQUIRED') {
      return 'Capture the customer signature before completing this appointment.';
    }
    if (error.code === 'SIGNATURE_SKIP_REASON_REQUIRED') {
      return 'Please enter a reason before skipping the customer signature.';
    }
    if (
      error.status === 404 ||
      error.code === 'NOT_FOUND' ||
      /Cannot (POST|PATCH|GET|PUT|DELETE)\b/i.test(error.message)
    ) {
      return 'Appointment action is unavailable. Refresh and try again.';
    }
    if (
      error.status === 400 ||
      error.status === 409 ||
      error.code === 'INVALID_STATUS_TRANSITION' ||
      error.code === 'VALIDATION_ERROR' ||
      error.code === 'CONFLICT'
    ) {
      return 'This appointment can no longer perform that action.';
    }
    if (error.status && error.status >= 500) {
      return 'Appointment action is temporarily unavailable. Refresh and try again.';
    }
  }

  return error instanceof Error
    ? error.message
    : "We couldn't update this appointment.";
}

export function friendlyAppointmentCreateError(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.code === 'APPOINTMENT_CONFLICT') {
      const availability = error.details.availability as
        | {
            conflicts?: Array<{ technicianName?: string | null }>;
            reason?: string;
          }
        | undefined;
      const technicianName = availability?.conflicts?.[0]?.technicianName;
      if (technicianName) {
        return `${technicianName} already has another appointment during this time.`;
      }
      return availability?.reason ?? error.message;
    }
    if (error.code === 'JOB_NOT_FOUND') {
      return 'Select a valid job before saving this appointment.';
    }
    if (error.code === 'CUSTOMER_SITE_NOT_FOUND') {
      return 'Select a valid service site before saving this appointment.';
    }
    if (error.code === 'INVALID_APPOINTMENT_DATA') {
      return error.message;
    }
    if (error.status === 400 || error.code === 'VALIDATION_ERROR') {
      return error.message || 'Check the appointment details and try again.';
    }
    if (error.status === 409 || error.code === 'CONFLICT') {
      return (
        error.message || 'This appointment conflicts with another booking.'
      );
    }
  }

  return friendlyAppointmentMutationError(error);
}

export function friendlyInvoiceMutationError(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.code === 'NETWORK_ERROR') {
      return 'Could not connect to TradeOS. Check your connection and retry.';
    }
    if (error.status === 401 || error.code === 'SESSION_EXPIRED') {
      return 'Your session has expired. Please log in again.';
    }
    if (error.status === 403 || error.code === 'INVOICE_ACCESS_DENIED') {
      return 'You do not have permission to perform this invoice action.';
    }
    if (error.status === 404 || error.code === 'INVOICE_NOT_FOUND') {
      return 'Invoice could not be found. Refresh and try again.';
    }
    if (error.code === 'INVOICE_EMAIL_REQUIRED') {
      return 'Add a customer email address before sending this invoice.';
    }
    if (error.code === 'INVOICE_LINE_ITEM_INVALID') {
      return 'Add at least one valid line item before continuing.';
    }
    if (error.code === 'INVOICE_INVALID_STATUS') {
      return 'This invoice can no longer perform that action. Refresh and try again.';
    }
    if (error.code === 'INVOICE_PAYMENT_EXCEEDS_BALANCE') {
      return 'Payment cannot exceed the remaining balance.';
    }
    if (error.code === 'INVOICE_ALREADY_PAID') {
      return 'This invoice has already been paid.';
    }
    if (error.code === 'INVOICE_VOID') {
      return 'Payments cannot be recorded against a void invoice.';
    }
    if (
      error.status === 400 ||
      error.status === 409 ||
      error.code === 'VALIDATION_ERROR' ||
      error.code === 'CONFLICT'
    ) {
      return 'The invoice changed while you were working. Refresh and try again.';
    }
    if (
      error.status === 500 ||
      /Cannot (POST|PATCH|GET|PUT|DELETE)\b/i.test(error.message)
    ) {
      return 'Invoice action is temporarily unavailable. Refresh and try again.';
    }
  }

  return error instanceof Error
    ? error.message
    : "We couldn't update this invoice.";
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, headers, ...requestOptions } = options;
  let response: Response;

  try {
    response = await fetch(buildApiRequestUrl(path), {
      ...requestOptions,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } catch (error) {
    throw new ApiRequestError(
      error instanceof Error && error.message
        ? error.message
        : 'Network request failed',
      null,
      'NETWORK_ERROR',
    );
  }

  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    let code = statusCodeToErrorCode(response.status);
    let details: Record<string, unknown> = {};

    try {
      const body = (await response.json()) as {
        code?: string;
        message?: string | string[];
        details?: Record<string, unknown>;
      };
      if (body.code) {
        code = body.code;
      }
      if (Array.isArray(body.message)) {
        message = body.message.join('\n');
      } else if (body.message) {
        message = body.message;
      }
      if (body.details) {
        details = body.details;
      }
    } catch {
      // Keep the default status message.
    }

    throw new ApiRequestError(message, response.status, code, details);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function statusCodeToErrorCode(status: number) {
  if (status === 400) return 'VALIDATION_ERROR';
  if (status === 401) return 'SESSION_EXPIRED';
  if (status === 403) return 'INSUFFICIENT_PERMISSION';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 413) return 'FILE_TOO_LARGE';
  if (status === 429) return 'TOO_MANY_REQUESTS';
  if (status >= 500) return 'SERVICE_UNAVAILABLE';
  return 'REQUEST_FAILED';
}

export function loginRequest(input: { email: string; password: string }) {
  return apiRequest<AuthResponse>('/auth/login', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function registerRequest(input: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  businessName: string;
  abn?: string;
  tradeType: string;
  gstRegistered: boolean;
  phone?: string;
  businessEmail?: string;
  address?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  timezone?: string;
}) {
  return apiRequest<AuthResponse>('/auth/register', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function meRequest(token: string) {
  return apiRequest<Pick<AuthResponse, 'user'>>('/auth/me', { token });
}

export function membersRequest(token: string) {
  return apiRequest<TeamMember[]>('/members', { token });
}

export function memberDetailRequest(token: string, memberId: string) {
  return apiRequest<TeamMemberDetailResponse>(`/members/${memberId}`, {
    token,
  });
}

export function inviteMemberRequest(
  token: string,
  input: {
    email: string;
    firstName: string;
    lastName: string;
    role: BusinessRole;
  },
) {
  return apiRequest<InviteMemberResponse>('/members/invite', {
    body: JSON.stringify(input),
    method: 'POST',
    token,
  });
}

export function invitationPreviewRequest(token: string) {
  return apiRequest<InvitationPreviewResponse>(`/members/invitations/${token}`);
}

export function acceptInvitationRequest(
  token: string,
  input: {
    email: string;
    firstName: string;
    lastName: string;
    password: string;
    confirmPassword: string;
  },
) {
  return apiRequest<AuthResponse>(`/members/invitations/${token}/accept`, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function resendInvitationRequest(token: string, memberId: string) {
  return apiRequest<ResendInvitationResponse>(
    `/members/${memberId}/resend-invite`,
    {
      method: 'POST',
      token,
    },
  );
}

export function cancelInvitationRequest(token: string, memberId: string) {
  return apiRequest<TeamMember>(`/members/${memberId}/cancel-invite`, {
    method: 'POST',
    token,
  });
}

export function updateMemberRoleRequest(
  token: string,
  memberId: string,
  role: BusinessRole,
) {
  return apiRequest<TeamMember>(`/members/${memberId}/role`, {
    body: JSON.stringify({ role }),
    method: 'PATCH',
    token,
  });
}

export function updateMemberStatusRequest(
  token: string,
  memberId: string,
  status: 'ACTIVE' | 'SUSPENDED',
) {
  return apiRequest<TeamMember>(`/members/${memberId}/status`, {
    body: JSON.stringify({ status }),
    method: 'PATCH',
    token,
  });
}

export function deleteMemberRequest(token: string, memberId: string) {
  return apiRequest<void>(`/members/${memberId}`, {
    method: 'DELETE',
    token,
  });
}

function customerQuery(
  params: Record<string, string | number | boolean | undefined>,
) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

function queryString(
  params: Record<string, string | number | boolean | undefined>,
) {
  return customerQuery(params);
}

export function customersRequest(
  token: string,
  params: Record<string, string | number | boolean | undefined> = {},
) {
  return apiRequest<CustomerListResponse>(
    `/customers${customerQuery(params)}`,
    {
      token,
    },
  );
}

export function customerDetailRequest(token: string, customerId: string) {
  return apiRequest<CustomerDetailResponse>(`/customers/${customerId}`, {
    token,
  });
}

export function customerCommunicationsRequest(
  token: string,
  params: Record<string, string | number | boolean | undefined> = {},
) {
  return apiRequest<CustomerCommunicationListResponse>(
    `/communications${queryString(params)}`,
    { token },
  );
}

export function sendManualCustomerCommunicationRequest(
  token: string,
  input: {
    customerId: string;
    channel: CustomerCommunicationChannel;
    subject?: string;
    message: string;
  },
) {
  return apiRequest<{
    communication: CustomerCommunicationListResponse['records'][number];
  }>('/communications/manual', {
    body: JSON.stringify(input),
    method: 'POST',
    token,
  });
}

export function communicationSettingsRequest(token: string) {
  return apiRequest<{ settings: CustomerCommunicationSettings }>(
    '/communications/settings',
    { token },
  );
}

export function updateCommunicationSettingsRequest(
  token: string,
  input: Partial<CustomerCommunicationSettings>,
) {
  return apiRequest<{ settings: CustomerCommunicationSettings }>(
    '/communications/settings',
    {
      body: JSON.stringify(input),
      method: 'PATCH',
      token,
    },
  );
}

export function communicationPreferencesRequest(
  token: string,
  customerId: string,
) {
  return apiRequest<{
    preferences: {
      businessId: string;
      customerId: string;
      emailEnabled: boolean;
      smsEnabled: boolean;
    };
  }>(`/communications/customers/${customerId}/preferences`, { token });
}

export function updateCommunicationPreferencesRequest(
  token: string,
  customerId: string,
  input: { emailEnabled?: boolean; smsEnabled?: boolean },
) {
  return apiRequest<{
    preferences: {
      businessId: string;
      customerId: string;
      emailEnabled: boolean;
      smsEnabled: boolean;
    };
  }>(`/communications/customers/${customerId}/preferences`, {
    body: JSON.stringify(input),
    method: 'PATCH',
    token,
  });
}

export function createCustomerRequest(token: string, input: CustomerPayload) {
  return apiRequest<CustomerDetailResponse>('/customers', {
    body: JSON.stringify(input),
    method: 'POST',
    token,
  });
}

export function updateCustomerRequest(
  token: string,
  customerId: string,
  input: CustomerPayload,
) {
  return apiRequest<CustomerDetailResponse>(`/customers/${customerId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
    token,
  });
}

export function archiveCustomerRequest(token: string, customerId: string) {
  return apiRequest<CustomerDetailResponse>(
    `/customers/${customerId}/archive`,
    {
      method: 'POST',
      token,
    },
  );
}

export function restoreCustomerRequest(token: string, customerId: string) {
  return apiRequest<CustomerDetailResponse>(
    `/customers/${customerId}/restore`,
    {
      method: 'POST',
      token,
    },
  );
}

export function createCustomerSiteRequest(
  token: string,
  customerId: string,
  input: CustomerSitePayload,
) {
  return apiRequest<CustomerSite>(`/customers/${customerId}/sites`, {
    body: JSON.stringify(input),
    method: 'POST',
    token,
  });
}

export function updateCustomerSiteRequest(
  token: string,
  customerId: string,
  siteId: string,
  input: CustomerSitePayload,
) {
  return apiRequest<CustomerSite>(`/customers/${customerId}/sites/${siteId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
    token,
  });
}

export function archiveCustomerSiteRequest(
  token: string,
  customerId: string,
  siteId: string,
) {
  return apiRequest<CustomerSite>(
    `/customers/${customerId}/sites/${siteId}/archive`,
    {
      method: 'POST',
      token,
    },
  );
}

export function jobsRequest(
  token: string,
  params: Record<string, string | number | boolean | undefined> = {},
) {
  return apiRequest<JobListResponse>(`/jobs${queryString(params)}`, {
    token,
  });
}

export function todayJobsRequest(token: string) {
  return apiRequest<JobListResponse>('/jobs/today', { token });
}

export function jobDetailRequest(token: string, jobId: string) {
  return apiRequest<JobDetailResponse>(`/jobs/${jobId}`, { token });
}

export function createJobRequest(token: string, input: JobPayload) {
  return apiRequest<JobDetailResponse>('/jobs', {
    body: JSON.stringify(input),
    method: 'POST',
    token,
  });
}

export function updateJobRequest(
  token: string,
  jobId: string,
  input: JobPayload,
) {
  return apiRequest<JobDetailResponse>(`/jobs/${jobId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
    token,
  });
}

export function updateJobStatusRequest(
  token: string,
  jobId: string,
  status: JobStatus,
  internalNotes?: string,
) {
  return apiRequest<JobDetailResponse>(`/jobs/${jobId}/status`, {
    body: JSON.stringify({ internalNotes, status }),
    method: 'PATCH',
    token,
  });
}

export function archiveJobRequest(token: string, jobId: string) {
  return apiRequest<JobDetailResponse>(`/jobs/${jobId}/archive`, {
    method: 'POST',
    token,
  });
}

export function restoreJobRequest(token: string, jobId: string) {
  return apiRequest<JobDetailResponse>(`/jobs/${jobId}/restore`, {
    method: 'POST',
    token,
  });
}

export function quotesRequest(
  token: string,
  params: Record<string, string | number | boolean | undefined> = {},
) {
  return apiRequest<QuoteListResponse>(`/quotes${queryString(params)}`, {
    token,
  });
}

export function quoteDetailRequest(token: string, quoteId: string) {
  return apiRequest<QuoteDetailResponse>(`/quotes/${quoteId}`, { token });
}

export function createQuoteRequest(token: string, input: QuotePayload) {
  return apiRequest<QuoteDetailResponse>('/quotes', {
    body: JSON.stringify(input),
    method: 'POST',
    token,
  });
}

export function updateQuoteRequest(
  token: string,
  quoteId: string,
  input: QuotePayload,
) {
  return apiRequest<QuoteDetailResponse>(`/quotes/${quoteId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
    token,
  });
}

export function quotePdfUrl(quoteId: string) {
  return buildApiRequestUrl(`/quotes/${quoteId}/pdf`);
}

export function sendQuoteRequest(
  token: string,
  quoteId: string,
  input?: { message: string; subject: string; to: string },
) {
  return apiRequest<QuoteDetailResponse>(`/quotes/${quoteId}/send`, {
    body: input ? JSON.stringify(input) : undefined,
    method: 'POST',
    token,
  });
}

export function publicQuoteRequest(publicToken: string) {
  return apiRequest<PublicQuoteResponse>(
    `/public/quotes/${encodeURIComponent(publicToken)}`,
  );
}

export function publicQuoteAcceptRequest(
  publicToken: string,
  input: {
    acceptedByName: string;
    acceptedByTitle?: string;
    acceptedTerms: boolean;
    note?: string;
  },
) {
  return apiRequest<PublicQuoteResponse>(
    `/public/quotes/${encodeURIComponent(publicToken)}/accept`,
    {
      body: JSON.stringify(input),
      method: 'POST',
    },
  );
}

export function publicQuoteDeclineRequest(
  publicToken: string,
  input: {
    comment?: string;
    reason?: 'PRICE' | 'TIMING' | 'SCOPE' | 'OTHER_PROVIDER' | 'OTHER';
  },
) {
  return apiRequest<PublicQuoteResponse>(
    `/public/quotes/${encodeURIComponent(publicToken)}/decline`,
    {
      body: JSON.stringify(input),
      method: 'POST',
    },
  );
}

export function acceptQuoteRequest(
  token: string,
  quoteId: string,
  acceptedByName: string,
  acceptedByEmail?: string,
) {
  return apiRequest<QuoteDetailResponse>(`/quotes/${quoteId}/accept`, {
    body: JSON.stringify({ acceptedByEmail, acceptedByName }),
    method: 'POST',
    token,
  });
}

export function cancelQuoteRequest(
  token: string,
  quoteId: string,
  reason?: string,
) {
  return apiRequest<QuoteDetailResponse>(`/quotes/${quoteId}/cancel`, {
    body: JSON.stringify({ reason }),
    method: 'POST',
    token,
  });
}

export function convertQuoteToJobRequest(token: string, quoteId: string) {
  return apiRequest<
    QuoteDetailResponse & { jobId: string; nextAction: string }
  >(`/quotes/${quoteId}/convert-to-job`, {
    method: 'POST',
    token,
  });
}

export function duplicateQuoteRequest(token: string, quoteId: string) {
  return apiRequest<QuoteDetailResponse>(`/quotes/${quoteId}/duplicate`, {
    method: 'POST',
    token,
  });
}

export function invoicesRequest(
  token: string,
  params: Record<string, string | number | boolean | undefined> = {},
) {
  return apiRequest<InvoiceListResponse>(`/invoices${queryString(params)}`, {
    token,
  });
}

export function accountsReceivableRequest(
  token: string,
  params: Record<string, string | number | boolean | undefined> = {},
) {
  return apiRequest<AccountsReceivableResponse>(
    `/invoices/accounts-receivable${queryString(params)}`,
    {
      token,
    },
  );
}

export function invoiceDetailRequest(token: string, invoiceId: string) {
  return apiRequest<InvoiceDetailResponse>(`/invoices/${invoiceId}`, {
    token,
  });
}

export function createInvoiceRequest(token: string, input: InvoicePayload) {
  return apiRequest<InvoiceDetailResponse>('/invoices', {
    body: JSON.stringify(input),
    method: 'POST',
    token,
  });
}

export function updateInvoiceRequest(
  token: string,
  invoiceId: string,
  input: InvoicePayload,
) {
  return apiRequest<InvoiceDetailResponse>(`/invoices/${invoiceId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
    token,
  });
}

export function invoicePdfUrl(invoiceId: string) {
  return buildApiRequestUrl(`/invoices/${invoiceId}/pdf`);
}

export function invoicePaymentReceiptUrl(invoiceId: string, paymentId: string) {
  return buildApiRequestUrl(
    `/invoices/${invoiceId}/payments/${paymentId}/receipt`,
  );
}

export function sendInvoiceRequest(
  token: string,
  invoiceId: string,
  input?: { message: string; subject: string; to: string },
) {
  return apiRequest<InvoiceDetailResponse>(`/invoices/${invoiceId}/send`, {
    body: input ? JSON.stringify(input) : undefined,
    method: 'POST',
    token,
  });
}

export function recordInvoicePaymentRequest(
  token: string,
  invoiceId: string,
  input: {
    amountCents: number;
    method: string;
    notes?: string;
    receivedAt: string;
    reference?: string;
  },
) {
  return apiRequest<InvoiceDetailResponse>(`/invoices/${invoiceId}/payments`, {
    body: JSON.stringify(input),
    method: 'POST',
    token,
  });
}

export function voidInvoiceRequest(token: string, invoiceId: string) {
  return apiRequest<InvoiceDetailResponse>(`/invoices/${invoiceId}/void`, {
    method: 'POST',
    token,
  });
}

export function publicInvoiceRequest(publicToken: string) {
  return apiRequest<PublicInvoiceResponse>(
    `/public/invoices/${encodeURIComponent(publicToken)}`,
  );
}

export function publicInvoiceViewRequest(publicToken: string) {
  return apiRequest<PublicInvoiceResponse>(
    `/public/invoices/${encodeURIComponent(publicToken)}/view`,
    { method: 'POST' },
  );
}

export function appointmentsRequest(
  token: string,
  params: Record<string, string | number | boolean | undefined> = {},
) {
  return apiRequest<AppointmentListResponse>(
    `/appointments${queryString(params)}`,
    { token },
  );
}

export function dispatcherRequest(
  token: string,
  params: {
    date?: string;
    search?: string;
    filter?: DispatcherFilter | '';
  } = {},
) {
  return apiRequest<DispatcherViewResponse>(
    `/appointments/dispatcher${queryString(params)}`,
    { token },
  );
}

export function myDayRequest(token: string) {
  return apiRequest<MyDayResponse>('/appointments/my-day', { token });
}

export function appointmentDetailRequest(token: string, appointmentId: string) {
  return apiRequest<AppointmentDetailResponse>(
    `/appointments/${appointmentId}`,
    { token },
  );
}

export function createAppointmentRequest(
  token: string,
  input: AppointmentPayload,
) {
  return apiRequest<AppointmentDetailResponse>('/appointments', {
    body: JSON.stringify(input),
    method: 'POST',
    token,
  });
}

export function updateAppointmentRequest(
  token: string,
  appointmentId: string,
  input: AppointmentPayload,
) {
  return apiRequest<AppointmentDetailResponse>(
    `/appointments/${appointmentId}`,
    {
      body: JSON.stringify(input),
      method: 'PATCH',
      token,
    },
  );
}

export function appointmentReassignmentOptionsRequest(
  token: string,
  appointmentId: string,
) {
  return apiRequest<AppointmentReassignmentOptionsResponse>(
    `/appointments/${appointmentId}/reassignment-options`,
    { token },
  );
}

export function reassignAppointmentRequest(
  token: string,
  appointmentId: string,
  input: AppointmentReassignmentPayload,
) {
  return apiRequest<AppointmentDetailResponse>(
    `/appointments/${appointmentId}/reassign`,
    {
      body: JSON.stringify(input),
      method: 'PATCH',
      token,
    },
  );
}

export function recommendAppointmentRequest(
  token: string,
  input: AppointmentRecommendationRequest,
) {
  return apiRequest<AppointmentRecommendationResponse>(
    '/appointments/recommend',
    {
      body: JSON.stringify(input),
      method: 'POST',
      token,
    },
  );
}

export function appointmentAvailabilityRequest(
  token: string,
  input: AppointmentAvailabilityRequest,
) {
  return apiRequest<AppointmentAvailabilityResponse>(
    '/appointments/availability',
    {
      body: JSON.stringify(input),
      method: 'POST',
      token,
    },
  );
}

export function transitionAppointmentRequest(
  token: string,
  appointmentId: string,
  action: AppointmentTransitionAction,
  input?: CompleteAppointmentPayload,
) {
  return apiRequest<AppointmentDetailResponse>(
    buildAppointmentTransitionPath(appointmentId, action),
    {
      body: input ? JSON.stringify(input) : undefined,
      method: 'POST',
      token,
    },
  );
}

export function captureAppointmentSignatureRequest(
  token: string,
  appointmentId: string,
  input: AppointmentSignaturePayload,
) {
  return apiRequest<AppointmentDetailResponse>(
    `/appointments/${appointmentId}/signature`,
    {
      body: JSON.stringify(input),
      method: 'POST',
      token,
    },
  );
}

export function skipAppointmentSignatureRequest(
  token: string,
  appointmentId: string,
  input: SkipAppointmentSignaturePayload,
) {
  return apiRequest<AppointmentDetailResponse>(
    `/appointments/${appointmentId}/signature/skip`,
    {
      body: JSON.stringify(input),
      method: 'POST',
      token,
    },
  );
}

export function updateAppointmentWorkLogRequest(
  token: string,
  appointmentId: string,
  input: AppointmentWorkLogPayload,
) {
  return apiRequest<AppointmentDetailResponse>(
    `/appointments/${appointmentId}/work-log`,
    {
      body: JSON.stringify(input),
      method: 'PATCH',
      token,
    },
  );
}

export function mediaRequest(
  token: string,
  params: Record<string, string | number | boolean | undefined> = {},
) {
  return apiRequest<MediaListResponse>(buildMediaListPath(params), {
    token,
  });
}

export function mediaDetailRequest(token: string, mediaId: string) {
  return apiRequest<MediaDetailResponse>(`/media/${mediaId}`, { token });
}

export function createMediaUploadTargetRequest(
  token: string,
  input: MediaUploadTargetRequest,
) {
  return apiRequest<MediaUploadTargetResponse>('/media/upload-target', {
    body: JSON.stringify(input),
    method: 'POST',
    token,
  });
}

export function uploadLocalMediaRequest(
  token: string,
  mediaId: string,
  input: LocalMediaUploadRequest,
) {
  return apiRequest<MediaDetailResponse>(buildMediaLocalUploadPath(mediaId), {
    body: JSON.stringify(input),
    method: 'POST',
    token,
  });
}

export async function uploadLocalMediaFileRequest(
  token: string,
  mediaId: string,
  file: {
    name: string;
    type: string;
    uri: string;
  },
) {
  const form = new FormData();
  form.append('file', file as unknown as Blob);
  let response: Response;

  try {
    response = await fetch(
      buildApiRequestUrl(buildMediaLocalUploadPath(mediaId)),
      {
        body: form,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        method: 'POST',
      },
    );
  } catch (error) {
    throw new ApiRequestError(
      error instanceof Error && error.message
        ? error.message
        : 'Network request failed',
      null,
      'NETWORK_ERROR',
    );
  }

  if (!response.ok) {
    let message =
      response.status === 413
        ? 'This file could not be uploaded. It may exceed the allowed size.'
        : `Request failed with ${response.status}`;
    let code = statusCodeToErrorCode(response.status);
    let details: Record<string, unknown> = {};

    try {
      const body = (await response.json()) as {
        code?: string;
        message?: string | string[];
        details?: Record<string, unknown>;
      };
      if (body.code) code = body.code;
      if (Array.isArray(body.message)) {
        message = body.message.join('\n');
      } else if (body.message) {
        message = body.message;
      }
      if (body.details) details = body.details;
    } catch {
      // Keep the friendly fallback above.
    }

    throw new ApiRequestError(message, response.status, code, details);
  }

  return (await response.json()) as MediaDetailResponse;
}

export function cancelMediaUploadRequest(token: string, mediaId: string) {
  return apiRequest<MediaDetailResponse>(`/media/${mediaId}/cancel`, {
    method: 'POST',
    token,
  });
}

export function mediaPreviewRequest(token: string, mediaId: string) {
  return apiRequest<MediaAccessResponse>(buildMediaPreviewPath(mediaId), {
    token,
  });
}

export function mediaDownloadRequest(token: string, mediaId: string) {
  return apiRequest<MediaAccessResponse>(buildMediaDownloadPath(mediaId), {
    token,
  });
}

export function archiveMediaRequest(token: string, mediaId: string) {
  return apiRequest<MediaDetailResponse>(`/media/${mediaId}/archive`, {
    method: 'POST',
    token,
  });
}

export function restoreMediaRequest(token: string, mediaId: string) {
  return apiRequest<MediaDetailResponse>(`/media/${mediaId}/restore`, {
    method: 'POST',
    token,
  });
}
