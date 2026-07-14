import type {
  AuthResponse,
  BusinessRole,
  CustomerDetailResponse,
  CustomerListResponse,
  CustomerPayload,
  CustomerSite,
  CustomerSitePayload,
  InvitationPreviewResponse,
  InviteMemberResponse,
  ResendInvitationResponse,
  TeamMemberDetailResponse,
  TeamMember,
} from '@tradieos/shared';

declare const process: {
  env?: {
    EXPO_PUBLIC_API_URL?: string;
  };
};

export const apiUrl =
  process.env?.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api';

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

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, headers, ...requestOptions } = options;
  let response: Response;

  try {
    response = await fetch(`${apiUrl}${path}`, {
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
