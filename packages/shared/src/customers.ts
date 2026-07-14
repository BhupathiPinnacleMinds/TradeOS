import type { BusinessRole } from './auth';
import type { AuditLogEntry } from './members';

export const AUSTRALIAN_STATES = [
  'VIC',
  'NSW',
  'QLD',
  'SA',
  'WA',
  'TAS',
  'ACT',
  'NT',
] as const;

export const CONTACT_PREFERENCES = ['PHONE', 'SMS', 'EMAIL', 'ANY'] as const;

export const CUSTOMER_TYPES = [
  'RESIDENTIAL',
  'COMMERCIAL',
  'REAL_ESTATE',
  'STRATA',
  'BUILDER',
  'OTHER',
] as const;

export type AustralianState = (typeof AUSTRALIAN_STATES)[number];
export type ContactPreference = (typeof CONTACT_PREFERENCES)[number];
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export type CustomerSortBy =
  'displayName' | 'createdAt' | 'updatedAt' | 'suburb' | 'customerType';
export type SortOrder = 'asc' | 'desc';

export interface CustomerSite {
  id: string;
  businessId: string;
  customerId: string;
  label: string;
  addressLine1: string;
  addressLine2: string | null;
  suburb: string;
  state: AustralianState;
  postcode: string;
  accessInstructions: string | null;
  siteContactName: string | null;
  siteContactPhone: string | null;
  isPrimary: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  businessId: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  alternatePhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  suburb: string | null;
  state: AustralianState | null;
  postcode: string | null;
  contactPreference: ContactPreference;
  customerType: CustomerType;
  notes: string | null;
  tags: string[];
  isArchived: boolean;
  archivedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  sites: CustomerSite[];
}

export interface CustomerSummary {
  customerSince: string;
  customerTypeLabel: string;
  contactPreferenceLabel: string;
  primarySuburb: string | null;
  serviceLocationCount: number;
}

export interface CustomerListResponse {
  records: Customer[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CustomerDetailResponse {
  customer: Customer;
  summary: CustomerSummary;
  activity: AuditLogEntry[];
}

export interface CustomerDuplicateMatch {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
}

export interface CustomerDuplicateWarning {
  code: 'POSSIBLE_DUPLICATE_CUSTOMER';
  message: string;
  matches: CustomerDuplicateMatch[];
}

export interface CustomerPayload {
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  alternatePhone?: string;
  addressLine1?: string;
  addressLine2?: string;
  suburb?: string;
  state?: AustralianState | '';
  postcode?: string;
  contactPreference: ContactPreference;
  customerType: CustomerType;
  notes?: string;
  tags?: string[];
  allowDuplicate?: boolean;
}

export interface CustomerSitePayload {
  label: string;
  addressLine1: string;
  addressLine2?: string;
  suburb: string;
  state: AustralianState;
  postcode: string;
  accessInstructions?: string;
  siteContactName?: string;
  siteContactPhone?: string;
  isPrimary?: boolean;
}

export const CUSTOMER_VIEW_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
  'ACCOUNTANT',
  'SALES',
  'READ_ONLY',
];

export const CUSTOMER_WRITE_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
  'SALES',
];

export const CUSTOMER_ARCHIVE_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
];
