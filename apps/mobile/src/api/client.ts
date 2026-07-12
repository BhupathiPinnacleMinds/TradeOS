import type {
  AuthResponse,
  BusinessRole,
  InviteMemberResponse,
  TeamMember,
} from '@tradieos/shared';

declare const process: {
  env?: {
    EXPO_PUBLIC_API_URL?: string;
  };
};

export const apiUrl =
  process.env?.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api';

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, headers, ...requestOptions } = options;
  const response = await fetch(`${apiUrl}${path}`, {
    ...requestOptions,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  if (!response.ok) {
    let message = `Request failed with ${response.status}`;

    try {
      const body = (await response.json()) as { message?: string | string[] };
      if (Array.isArray(body.message)) {
        message = body.message.join('\n');
      } else if (body.message) {
        message = body.message;
      }
    } catch {
      // Keep the default status message.
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
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

export function inviteMemberRequest(
  token: string,
  input: {
    email: string;
    firstName?: string;
    lastName?: string;
    role: BusinessRole;
  },
) {
  return apiRequest<InviteMemberResponse>('/members/invite', {
    body: JSON.stringify(input),
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
