import type { AuditLogEntry } from './members';
import type { AustralianState } from './customers';
import type { BusinessRole } from './auth';

export const JOB_STATUSES = [
  'NEW',
  'SCHEDULED',
  'ON_THE_WAY',
  'IN_PROGRESS',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
] as const;

export const JOB_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobPriority = (typeof JOB_PRIORITIES)[number];

export type JobSortBy =
  | 'scheduledStart'
  | 'createdAt'
  | 'updatedAt'
  | 'jobNumber'
  | 'priority'
  | 'status';

export type JobFilter =
  | 'today'
  | 'tomorrow'
  | 'upcoming'
  | 'completed'
  | 'cancelled'
  | 'high-priority'
  | 'my-jobs'
  | 'unassigned';

export interface JobCustomerSummary {
  id: string;
  displayName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
}

export interface JobAssignedUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface Job {
  id: string;
  businessId: string;
  customerId: string;
  assignedToUserId: string | null;
  jobNumber: string;
  title: string;
  description: string | null;
  tradeType: string | null;
  status: JobStatus;
  priority: JobPriority;
  scheduledStart: string;
  scheduledEnd: string | null;
  estimatedDurationMinutes: number | null;
  actualStart: string | null;
  actualEnd: string | null;
  completedAt: string | null;
  addressLine1: string;
  addressLine2: string | null;
  suburb: string;
  state: AustralianState;
  postcode: string;
  accessInstructions: string | null;
  customerNotes: string | null;
  internalNotes: string | null;
  requiresQuote: boolean;
  requiresInvoice: boolean;
  invoiceCreated: boolean;
  quoteCreated: boolean;
  isArchived: boolean;
  archivedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  customer: JobCustomerSummary;
  assignedTo: JobAssignedUser | null;
}

export interface JobListResponse {
  records: Job[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface JobDetailResponse {
  job: Job;
  activity: AuditLogEntry[];
}

export interface JobPayload {
  customerId: string;
  assignedToUserId?: string | null;
  title: string;
  description?: string;
  tradeType?: string;
  status: JobStatus;
  priority: JobPriority;
  scheduledStart: string;
  scheduledEnd?: string | null;
  estimatedDurationMinutes?: number | null;
  addressLine1: string;
  addressLine2?: string;
  suburb: string;
  state: AustralianState;
  postcode: string;
  accessInstructions?: string;
  customerNotes?: string;
  internalNotes?: string;
  requiresQuote?: boolean;
  requiresInvoice?: boolean;
}

export const JOB_VIEW_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
  'TECHNICIAN',
  'ACCOUNTANT',
  'SALES',
  'READ_ONLY',
];

export const JOB_WRITE_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
];

export const JOB_STATUS_UPDATE_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
  'TECHNICIAN',
];

export const JOB_ARCHIVE_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
];
