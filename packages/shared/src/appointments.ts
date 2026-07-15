import type { BusinessRole } from './auth';
import type { AustralianState } from './customers';
import type { JobAssignedUser, JobCustomerSummary, JobPriority } from './jobs';

export const APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'ON_THE_WAY',
  'ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
] as const;

export const APPOINTMENT_TYPES = [
  'INSPECTION',
  'INSTALLATION',
  'MAINTENANCE',
  'RETURN_VISIT',
  'EMERGENCY_VISIT',
] as const;

export const APPOINTMENT_LOCATION_SOURCES = [
  'CUSTOMER_SITE',
  'CUSTOMER_DEFAULT',
  'MANUAL',
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];
export type AppointmentLocationSource =
  (typeof APPOINTMENT_LOCATION_SOURCES)[number];
export type CalendarViewMode = 'day' | 'week' | 'month' | 'agenda';

export type AppointmentSortBy =
  'scheduledStart' | 'createdAt' | 'updatedAt' | 'appointmentNumber' | 'status';

export type AppointmentFilter =
  | 'today'
  | 'tomorrow'
  | 'upcoming'
  | 'completed'
  | 'cancelled'
  | 'my-appointments';

export interface AppointmentJobSummary {
  id: string;
  jobNumber: string;
  title: string;
  priority: JobPriority;
  addressLine1: string;
  addressLine2: string | null;
  suburb: string;
  state: AustralianState;
  postcode: string;
  customer: JobCustomerSummary;
}

export interface Appointment {
  id: string;
  businessId: string;
  jobId: string;
  customerSiteId: string | null;
  assignedUserId: string | null;
  appointmentNumber: string;
  appointmentType: AppointmentType;
  locationSource: AppointmentLocationSource;
  status: AppointmentStatus;
  scheduledStart: string;
  scheduledEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  estimatedDurationMinutes: number | null;
  travelDurationMinutes: number | null;
  travelDistanceKm: number | null;
  addressLine1: string;
  addressLine2: string | null;
  suburb: string;
  state: AustralianState;
  postcode: string;
  accessInstructions: string | null;
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  assignedUser: JobAssignedUser | null;
  job: AppointmentJobSummary;
}

export interface AppointmentListResponse {
  records: Appointment[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AppointmentDetailResponse {
  appointment: Appointment;
}

export interface AppointmentPayload {
  jobId: string;
  customerSiteId?: string | null;
  assignedUserId?: string | null;
  appointmentType: AppointmentType;
  locationSource?: AppointmentLocationSource;
  status?: AppointmentStatus;
  scheduledStart: string;
  scheduledEnd: string;
  estimatedDurationMinutes?: number | null;
  travelDurationMinutes?: number | null;
  travelDistanceKm?: number | null;
  addressLine1?: string;
  addressLine2?: string;
  suburb?: string;
  state?: AustralianState | '';
  postcode?: string;
  accessInstructions?: string;
  saveAddressAsCustomerSite?: boolean;
  notes?: string;
  allowConflictOverride?: boolean;
}

export interface AppointmentRecommendationRequest {
  jobId: string;
  scheduledStart: string;
  scheduledEnd: string;
  estimatedDurationMinutes?: number | null;
  priority?: JobPriority;
}

export interface AppointmentRecommendationResponse {
  recommendedTechnicianId: string | null;
  technicianName: string | null;
  reason: string;
}

export interface AppointmentAvailabilityRequest {
  scheduledStart: string;
  scheduledEnd: string;
  assignedUserId?: string | null;
  excludeAppointmentId?: string;
}

export interface AppointmentConflict {
  id: string;
  appointmentNumber: string;
  jobTitle: string;
  technicianName: string | null;
  scheduledStart: string;
  scheduledEnd: string;
}

export interface AppointmentAvailabilityResponse {
  hasConflict: boolean;
  canOverride: boolean;
  conflicts: AppointmentConflict[];
  reason: string;
}

export interface AppointmentReassignmentPayload {
  assignedUserId?: string | null;
  allowConflictOverride?: boolean;
  reason?: string;
}

export interface AppointmentReassignmentTechnician {
  userId: string;
  name: string;
  email: string;
  role: BusinessRole;
  todayWorkload: number;
  upcomingToday: number;
  isAvailable: boolean;
  availabilityReason: string;
}

export interface AppointmentReassignmentRecommendation {
  technicianId: string | null;
  technicianName: string | null;
  reason: string;
}

export interface AppointmentReassignmentOptionsResponse {
  appointment: Appointment;
  technicians: AppointmentReassignmentTechnician[];
  recommendation: AppointmentReassignmentRecommendation;
}

export const APPOINTMENT_STATUS_COLOURS: Record<
  AppointmentStatus,
  { background: string; border: string; text: string }
> = {
  ARRIVED: { background: '#E0F2FE', border: '#38BDF8', text: '#075985' },
  CANCELLED: { background: '#FFF1F2', border: '#FB7185', text: '#9F1239' },
  COMPLETED: { background: '#DCFCE7', border: '#22C55E', text: '#166534' },
  CONFIRMED: { background: '#ECFDF5', border: '#10B981', text: '#047857' },
  IN_PROGRESS: { background: '#FEF3C7', border: '#F59E0B', text: '#92400E' },
  NO_SHOW: { background: '#F3F4F6', border: '#9CA3AF', text: '#374151' },
  ON_THE_WAY: { background: '#DBEAFE', border: '#3B82F6', text: '#1D4ED8' },
  RESCHEDULED: { background: '#F5F3FF', border: '#8B5CF6', text: '#5B21B6' },
  SCHEDULED: { background: '#EEF2FF', border: '#6366F1', text: '#3730A3' },
};

export interface JobTimelineEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

export const APPOINTMENT_VIEW_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
  'TECHNICIAN',
  'ACCOUNTANT',
  'SALES',
  'READ_ONLY',
];

export const APPOINTMENT_WRITE_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
];

export const APPOINTMENT_STATUS_UPDATE_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
  'TECHNICIAN',
];

export type AppointmentQuickActionId =
  | 'navigate'
  | 'call'
  | 'reassign'
  | 'start'
  | 'arrive'
  | 'complete'
  | 'reschedule'
  | 'cancel'
  | 'viewDetails';

export interface AppointmentQuickAction {
  id: AppointmentQuickActionId;
  label: string;
  kind: 'contact' | 'workflow' | 'navigation' | 'secondary';
}

export interface AppointmentQuickActionInput {
  status: AppointmentStatus;
  hasPhone: boolean;
  hasAddress: boolean;
  role?: BusinessRole | null;
  isAssignedUser?: boolean;
  hasRescheduledToAppointment?: boolean;
}

const APPOINTMENT_RESCHEDULE_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
];

const APPOINTMENT_REASSIGN_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
];

function canUpdateAppointmentStatus(input: AppointmentQuickActionInput) {
  if (!input.role || !APPOINTMENT_STATUS_UPDATE_ROLES.includes(input.role)) {
    return false;
  }

  if (input.role === 'TECHNICIAN') {
    return Boolean(input.isAssignedUser);
  }

  return true;
}

function canRescheduleAppointment(input: AppointmentQuickActionInput) {
  return Boolean(
    input.role && APPOINTMENT_RESCHEDULE_ROLES.includes(input.role),
  );
}

function canReassignAppointment(input: AppointmentQuickActionInput) {
  return Boolean(input.role && APPOINTMENT_REASSIGN_ROLES.includes(input.role));
}

export function getAppointmentQuickActions(
  input: AppointmentQuickActionInput,
): AppointmentQuickAction[] {
  if (input.status === 'RESCHEDULED') {
    return [
      ...(input.hasRescheduledToAppointment
        ? [
            {
              id: 'viewDetails' as const,
              kind: 'secondary' as const,
              label: 'View new appointment',
            },
          ]
        : []),
      { id: 'viewDetails', kind: 'secondary', label: 'View details' },
    ];
  }

  const actions: AppointmentQuickAction[] = [];
  const canUpdateStatus = canUpdateAppointmentStatus(input);
  const canReschedule = canRescheduleAppointment(input);
  const canReassign = canReassignAppointment(input);

  if (
    input.hasAddress &&
    ['SCHEDULED', 'CONFIRMED', 'ON_THE_WAY'].includes(input.status)
  ) {
    actions.push({ id: 'navigate', kind: 'navigation', label: 'Navigate' });
  }

  if (
    input.hasPhone &&
    ['SCHEDULED', 'CONFIRMED', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS'].includes(
      input.status,
    )
  ) {
    actions.push({ id: 'call', kind: 'contact', label: 'Call' });
  }

  if (
    canUpdateStatus &&
    ['SCHEDULED', 'CONFIRMED', 'ARRIVED'].includes(input.status)
  ) {
    actions.push({ id: 'start', kind: 'workflow', label: 'Start' });
  }

  if (canUpdateStatus && input.status === 'ON_THE_WAY') {
    actions.push({ id: 'arrive', kind: 'workflow', label: 'Arrive' });
  }

  if (canUpdateStatus && input.status === 'IN_PROGRESS') {
    actions.push({ id: 'complete', kind: 'workflow', label: 'Complete' });
  }

  if (
    canReassign &&
    !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(input.status)
  ) {
    actions.push({
      id: 'reassign',
      kind: 'secondary',
      label: 'Reassign',
    });
  }

  if (canReschedule && ['CANCELLED', 'NO_SHOW'].includes(input.status)) {
    actions.push({
      id: 'reschedule',
      kind: 'secondary',
      label: 'Reschedule',
    });
  }

  if (
    canUpdateStatus &&
    !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(input.status)
  ) {
    actions.push({
      id: 'cancel',
      kind: 'secondary',
      label: 'Cancel',
    });
  }

  if (
    actions.length === 0 ||
    ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(input.status)
  ) {
    actions.push({
      id: 'viewDetails',
      kind: 'secondary',
      label: 'View details',
    });
  }

  return actions;
}
