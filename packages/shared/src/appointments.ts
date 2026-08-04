import type { BusinessRole } from './auth';
import type { AustralianState } from './customers';
import type { JobAssignedUser, JobCustomerSummary, JobPriority } from './jobs';

export const APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'ON_THE_WAY',
  'ARRIVED',
  'IN_PROGRESS',
  'PAUSED',
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
export type CalendarTopTab = 'calendar' | 'dispatcher' | 'today';

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
  travelStartedAt: string | null;
  arrivedAt: string | null;
  workStartedAt: string | null;
  currentWorkStartedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  totalTravelMinutes: number;
  totalWorkMinutes: number;
  totalPausedMinutes: number;
  executionDurations: AppointmentExecutionDurations;
  signature: AppointmentSignature | null;
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
  workLog: AppointmentWorkLog | null;
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

export interface AppointmentWorkLog {
  id: string;
  businessId: string;
  appointmentId: string;
  jobId: string;
  technicianUserId: string;
  technicianNotes: string | null;
  workCompleted: string | null;
  followUpRequired: boolean;
  followUpNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentExecutionDurations {
  travelMinutes: number;
  workMinutes: number;
  pausedMinutes: number;
  totalElapsedMinutes: number;
  calculatedAt: string;
}

export const DEFAULT_APPOINTMENT_EXECUTION_DURATIONS: AppointmentExecutionDurations =
  {
    calculatedAt: '',
    pausedMinutes: 0,
    totalElapsedMinutes: 0,
    travelMinutes: 0,
    workMinutes: 0,
  };

export function normaliseAppointmentExecutionDurations(
  executionDurations?: Partial<AppointmentExecutionDurations> | null,
): AppointmentExecutionDurations {
  return {
    calculatedAt:
      executionDurations?.calculatedAt ??
      DEFAULT_APPOINTMENT_EXECUTION_DURATIONS.calculatedAt,
    pausedMinutes:
      executionDurations?.pausedMinutes ??
      DEFAULT_APPOINTMENT_EXECUTION_DURATIONS.pausedMinutes,
    totalElapsedMinutes:
      executionDurations?.totalElapsedMinutes ??
      DEFAULT_APPOINTMENT_EXECUTION_DURATIONS.totalElapsedMinutes,
    travelMinutes:
      executionDurations?.travelMinutes ??
      DEFAULT_APPOINTMENT_EXECUTION_DURATIONS.travelMinutes,
    workMinutes:
      executionDurations?.workMinutes ??
      DEFAULT_APPOINTMENT_EXECUTION_DURATIONS.workMinutes,
  };
}

export interface AppointmentSignatureData {
  strokes: Array<Array<{ x: number; y: number }>>;
  width: number;
  height: number;
}

export interface AppointmentSignature {
  id: string;
  businessId: string;
  appointmentId: string;
  jobId: string;
  customerName: string | null;
  signerTitle: string | null;
  consentText: string;
  signatureData: AppointmentSignatureData | null;
  skipReason: string | null;
  capturedByUserId: string;
  capturedAt: string | null;
  skippedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentWorkLogPayload {
  technicianNotes?: string;
  workCompleted?: string;
  followUpRequired?: boolean;
  followUpNotes?: string;
}

export interface CompleteAppointmentPayload extends AppointmentWorkLogPayload {
  workCompleted: string;
  signatureId?: string;
  signatureSkipReason?: string;
}

export interface AppointmentSignaturePayload {
  customerName: string;
  signerTitle?: string | null;
  consentText?: string;
  signatureData: AppointmentSignatureData;
}

export interface SkipAppointmentSignaturePayload {
  reason: string;
}

export interface MyDayResponse {
  businessDate: string;
  businessTimezone: string;
  businessName: string;
  technicianUserId: string;
  technicianName: string;
  nextAppointment: Appointment | null;
  laterToday: Appointment[];
  completedToday: Appointment[];
  appointments: Appointment[];
  completedCount: number;
  remainingCount: number;
  urgentCount: number;
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

export type DispatcherTechnicianStatus =
  | 'AVAILABLE'
  | 'TRAVELLING'
  | 'WORKING'
  | 'ON_BREAK'
  | 'FINISHED_TODAY'
  | 'OFFLINE';

export type DispatcherFilter =
  | 'working'
  | 'available'
  | 'completed'
  | 'high-priority'
  | 'overdue'
  | 'unassigned';

export interface DispatcherAppointment {
  appointment: Appointment;
  recommendation?: AppointmentReassignmentRecommendation;
}

export interface DispatcherTechnician {
  userId: string;
  name: string;
  email: string;
  role: BusinessRole;
  avatarInitials: string;
  workingHours: string;
  currentStatus: DispatcherTechnicianStatus;
  todaysWorkload: number;
  completedToday: number;
  upcomingToday: number;
  estimatedWorkMinutes: number;
  travelPlaceholderMinutes: number;
  availableMinutes: number;
  overtimeWarning: boolean;
  appointments: DispatcherAppointment[];
}

export interface DispatcherSummary {
  totalAppointmentsToday: number;
  estimatedWorkMinutes: number;
  travelPlaceholderMinutes: number;
  availableMinutes: number;
  overtimeWarning: boolean;
  techniciansWorking: number;
  availableTechnicians: number;
  unassignedAppointments: number;
}

export interface DispatcherViewResponse {
  date: string;
  canManage: boolean;
  summary: DispatcherSummary;
  technicians: DispatcherTechnician[];
  unassigned: DispatcherAppointment[];
  filters: DispatcherFilter[];
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
  PAUSED: { background: '#FFF7ED', border: '#FB923C', text: '#9A3412' },
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

export const APPOINTMENT_CONFIRM_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
];

export type AppointmentQuickActionId =
  | 'navigate'
  | 'call'
  | 'confirm'
  | 'reassign'
  | 'startTravel'
  | 'start'
  | 'arrive'
  | 'complete'
  | 'pause'
  | 'resume'
  | 'reschedule'
  | 'cancel'
  | 'viewDetails';

export interface AppointmentQuickAction {
  id: AppointmentQuickActionId;
  label: string;
  kind: 'contact' | 'workflow' | 'navigation' | 'secondary';
}

export const APPOINTMENT_MORE_ACTIONS_DISMISS_ID =
  'appointment-more-actions-dismiss';

export type AppointmentMoreActionsMenuState = {
  backdropEnabled: boolean;
  dismissing: boolean;
  hasPendingActionTimer: boolean;
  opening: boolean;
  pendingActionId: string | null;
  selectedActionId: string | null;
  touchBlocked: boolean;
  visible: boolean;
};

export function dismissedAppointmentMoreActionsMenuState(): AppointmentMoreActionsMenuState {
  return {
    backdropEnabled: false,
    dismissing: false,
    hasPendingActionTimer: false,
    opening: false,
    pendingActionId: null,
    selectedActionId: null,
    touchBlocked: false,
    visible: false,
  };
}

export function openedAppointmentMoreActionsMenuState(): AppointmentMoreActionsMenuState {
  return {
    ...dismissedAppointmentMoreActionsMenuState(),
    backdropEnabled: true,
    visible: true,
  };
}

export function shouldExecuteAppointmentMoreActionsMenuItem(actionId: string) {
  return actionId !== APPOINTMENT_MORE_ACTIONS_DISMISS_ID;
}

export interface AppointmentQuickActionInput {
  status: AppointmentStatus;
  hasPhone: boolean;
  hasAddress: boolean;
  role?: BusinessRole | null;
  isAssignedUser?: boolean;
  hasRescheduledToAppointment?: boolean;
}

export type AppointmentTransitionAction =
  | 'confirm'
  | 'start-travel'
  | 'arrive'
  | 'start'
  | 'pause'
  | 'resume'
  | 'complete'
  | 'cancel';

export interface AppointmentTransitionOption {
  action: AppointmentTransitionAction;
  label: string;
  nextStatus: AppointmentStatus;
}

export const APPOINTMENT_TRANSITION_ROUTE_SEGMENTS: Record<
  AppointmentTransitionAction,
  string
> = {
  arrive: 'arrive',
  cancel: 'cancel',
  complete: 'complete',
  confirm: 'confirm',
  pause: 'pause',
  resume: 'resume',
  start: 'start',
  'start-travel': 'start-travel',
};

export function buildAppointmentTransitionPath(
  appointmentId: string,
  action: AppointmentTransitionAction,
) {
  const segment = APPOINTMENT_TRANSITION_ROUTE_SEGMENTS[action];
  return `/appointments/${appointmentId}/${segment}`;
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

function canConfirmAppointment(input: AppointmentQuickActionInput) {
  return Boolean(input.role && APPOINTMENT_CONFIRM_ROLES.includes(input.role));
}

export function getAllowedAppointmentTransitions(input: {
  currentStatus: AppointmentStatus;
  userRole?: BusinessRole | null;
  isAssignedTechnician?: boolean;
}): AppointmentTransitionOption[] {
  const quickActionInput: AppointmentQuickActionInput = {
    hasAddress: true,
    hasPhone: true,
    isAssignedUser: input.isAssignedTechnician,
    role: input.userRole,
    status: input.currentStatus,
  };
  const canUpdate = canUpdateAppointmentStatus(quickActionInput);
  const canConfirm = canConfirmAppointment(quickActionInput);
  if (!canUpdate) return [];

  if (
    ['CANCELLED', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED'].includes(
      input.currentStatus,
    )
  ) {
    return [];
  }

  const options: AppointmentTransitionOption[] = [];

  if (input.currentStatus === 'SCHEDULED') {
    if (canConfirm) {
      options.push({
        action: 'confirm',
        label: 'Confirm appointment',
        nextStatus: 'CONFIRMED',
      });
    }
    options.push({
      action: 'cancel',
      label: 'Cancel appointment',
      nextStatus: 'CANCELLED',
    });
    return options;
  }

  if (input.currentStatus === 'CONFIRMED') {
    options.push(
      {
        action: 'start-travel',
        label: 'Start travel',
        nextStatus: 'ON_THE_WAY',
      },
      {
        action: 'cancel',
        label: 'Cancel appointment',
        nextStatus: 'CANCELLED',
      },
    );
    return options;
  }
  if (input.currentStatus === 'ON_THE_WAY') {
    return [
      { action: 'arrive', label: 'Mark arrived', nextStatus: 'ARRIVED' },
      {
        action: 'cancel',
        label: 'Cancel appointment',
        nextStatus: 'CANCELLED',
      },
    ];
  }
  if (input.currentStatus === 'ARRIVED') {
    return [
      { action: 'start', label: 'Start work', nextStatus: 'IN_PROGRESS' },
      {
        action: 'cancel',
        label: 'Cancel appointment',
        nextStatus: 'CANCELLED',
      },
    ];
  }
  if (input.currentStatus === 'IN_PROGRESS') {
    return [
      {
        action: 'pause',
        label: 'Pause',
        nextStatus: 'PAUSED',
      },
      {
        action: 'complete',
        label: 'Complete appointment',
        nextStatus: 'COMPLETED',
      },
      {
        action: 'cancel',
        label: 'Cancel appointment',
        nextStatus: 'CANCELLED',
      },
    ];
  }
  if (input.currentStatus === 'PAUSED') {
    return [
      {
        action: 'resume',
        label: 'Resume work',
        nextStatus: 'IN_PROGRESS',
      },
      {
        action: 'cancel',
        label: 'Cancel appointment',
        nextStatus: 'CANCELLED',
      },
    ];
  }
  return [];
}

export function canTransitionAppointment(input: {
  fromStatus: AppointmentStatus;
  action: AppointmentTransitionAction;
  userRole?: BusinessRole | null;
  isAssignedTechnician?: boolean;
}) {
  return getAllowedAppointmentTransitions({
    currentStatus: input.fromStatus,
    isAssignedTechnician: input.isAssignedTechnician,
    userRole: input.userRole,
  }).some((option) => option.action === input.action);
}

export function getAppointmentExecutionActions(input: {
  status: AppointmentStatus;
  role?: BusinessRole | null;
  isAssignedTechnician?: boolean;
}) {
  return getAllowedAppointmentTransitions({
    currentStatus: input.status,
    isAssignedTechnician: input.isAssignedTechnician,
    userRole: input.role,
  });
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
  const canConfirm = canConfirmAppointment(input);
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

  if (canConfirm && input.status === 'SCHEDULED') {
    actions.push({
      id: 'confirm',
      kind: 'workflow',
      label: 'Confirm appointment',
    });
  }

  if (canUpdateStatus && input.status === 'CONFIRMED') {
    actions.push({
      id: 'startTravel',
      kind: 'workflow',
      label: 'Start travel',
    });
  }

  if (canUpdateStatus && input.status === 'ARRIVED') {
    actions.push({ id: 'start', kind: 'workflow', label: 'Start work' });
  }

  if (canUpdateStatus && input.status === 'ON_THE_WAY') {
    actions.push({ id: 'arrive', kind: 'workflow', label: 'Arrived' });
  }

  if (canUpdateStatus && input.status === 'IN_PROGRESS') {
    actions.push({ id: 'pause', kind: 'workflow', label: 'Pause' });
    actions.push({ id: 'complete', kind: 'workflow', label: 'Complete' });
  }

  if (canUpdateStatus && input.status === 'PAUSED') {
    actions.push({ id: 'resume', kind: 'workflow', label: 'Resume' });
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

  if (
    canReschedule &&
    ['SCHEDULED', 'CONFIRMED', 'CANCELLED', 'NO_SHOW'].includes(input.status)
  ) {
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
