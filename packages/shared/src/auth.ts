export const BUSINESS_ROLES = ['OWNER', 'ADMIN', 'STAFF'] as const;

export type BusinessRole = (typeof BUSINESS_ROLES)[number];

export interface AuthenticatedUser {
  id: string;
  businessId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: BusinessRole;
}

export interface BusinessWorkspace {
  id: string;
  name: string;
  abn: string | null;
  tradeType: string | null;
  gstRegistered: boolean;
  phone: string | null;
  email: string | null;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  timezone: string;
}

export interface AuthUser extends AuthenticatedUser {
  firstName: string;
  lastName: string;
  isActive: boolean;
  business: BusinessWorkspace;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}
