export const BUSINESS_ROLES = ['OWNER', 'ADMIN', 'STAFF'] as const;

export type BusinessRole = (typeof BUSINESS_ROLES)[number];

export interface AuthenticatedUser {
  id: string;
  businessId: string;
  email: string;
  role: BusinessRole;
}
