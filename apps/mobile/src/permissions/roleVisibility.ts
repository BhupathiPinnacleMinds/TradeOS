import type { BusinessRole } from '@tradieos/shared';
import type {
  MainTabsParamList,
  RootStackParamList,
} from '../navigation/types';

export type MainTabRoute = keyof MainTabsParamList;
export type MoreDestinationRoute =
  | 'Customers'
  | 'Jobs'
  | 'MyDay'
  | 'Quotes'
  | 'Invoices'
  | 'Notifications'
  | 'Team'
  | 'Settings';

export interface MoreDestination {
  label: string;
  route: MoreDestinationRoute;
}

type ProtectedStackRoute = Exclude<
  keyof RootStackParamList,
  'Login' | 'Register' | 'AcceptInvitation' | 'Main'
>;

const roles = {
  appointmentCreate: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER'],
  appointmentManage: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER'],
  businessSettings: ['OWNER', 'ADMIN', 'OFFICE_MANAGER'],
  customerArchive: ['OWNER', 'ADMIN', 'OFFICE_MANAGER'],
  customerCreate: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER', 'SALES'],
  customerManage: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER', 'SALES'],
  dispatcher: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER'],
  jobCreate: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER'],
  jobArchive: ['OWNER', 'ADMIN', 'OFFICE_MANAGER'],
  jobManage: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER'],
  quoteCreate: [
    'OWNER',
    'ADMIN',
    'OFFICE_MANAGER',
    'SCHEDULER',
    'SALES',
    'TECHNICIAN',
  ],
  quoteView: [
    'OWNER',
    'ADMIN',
    'OFFICE_MANAGER',
    'SCHEDULER',
    'TECHNICIAN',
    'ACCOUNTANT',
    'SALES',
    'READ_ONLY',
  ],
  teamManage: ['OWNER', 'ADMIN'],
} satisfies Record<string, BusinessRole[]>;

const bottomTabs: Record<BusinessRole, MainTabRoute[]> = {
  ACCOUNTANT: ['Dashboard', 'Tori', 'More'],
  ADMIN: ['Dashboard', 'Calendar', 'Jobs', 'Tori', 'More'],
  OFFICE_MANAGER: ['Dashboard', 'Calendar', 'Jobs', 'Tori', 'More'],
  OWNER: ['Dashboard', 'Calendar', 'Jobs', 'Tori', 'More'],
  READ_ONLY: ['Dashboard', 'Calendar', 'More'],
  SALES: ['Dashboard', 'Customers', 'Quotes', 'Tori', 'More'],
  SCHEDULER: ['Dashboard', 'Calendar', 'Jobs', 'Tori', 'More'],
  STAFF: ['Dashboard', 'Calendar', 'Jobs', 'Tori', 'More'],
  TECHNICIAN: ['MyDay', 'Calendar', 'Tori', 'More'],
};

const moreDestinations: Record<BusinessRole, MoreDestination[]> = {
  ACCOUNTANT: [
    { label: 'Quotes', route: 'Quotes' },
    { label: 'Invoices', route: 'Invoices' },
    { label: 'Notifications', route: 'Notifications' },
  ],
  ADMIN: [
    { label: 'My Day', route: 'MyDay' },
    { label: 'Customers', route: 'Customers' },
    { label: 'Quotes', route: 'Quotes' },
    { label: 'Invoices', route: 'Invoices' },
    { label: 'Notifications', route: 'Notifications' },
    { label: 'Team', route: 'Team' },
    { label: 'Settings', route: 'Settings' },
  ],
  OFFICE_MANAGER: [
    { label: 'My Day', route: 'MyDay' },
    { label: 'Customers', route: 'Customers' },
    { label: 'Quotes', route: 'Quotes' },
    { label: 'Invoices', route: 'Invoices' },
    { label: 'Notifications', route: 'Notifications' },
    { label: 'Settings', route: 'Settings' },
  ],
  OWNER: [
    { label: 'My Day', route: 'MyDay' },
    { label: 'Customers', route: 'Customers' },
    { label: 'Quotes', route: 'Quotes' },
    { label: 'Invoices', route: 'Invoices' },
    { label: 'Notifications', route: 'Notifications' },
    { label: 'Team', route: 'Team' },
    { label: 'Settings', route: 'Settings' },
  ],
  READ_ONLY: [
    { label: 'Customers', route: 'Customers' },
    { label: 'Jobs', route: 'Jobs' },
    { label: 'Quotes', route: 'Quotes' },
    { label: 'Invoices', route: 'Invoices' },
    { label: 'Notifications', route: 'Notifications' },
  ],
  SALES: [
    { label: 'Customers', route: 'Customers' },
    { label: 'Notifications', route: 'Notifications' },
  ],
  SCHEDULER: [
    { label: 'My Day', route: 'MyDay' },
    { label: 'Customers', route: 'Customers' },
    { label: 'Quotes', route: 'Quotes' },
    { label: 'Notifications', route: 'Notifications' },
  ],
  STAFF: [
    { label: 'My Day', route: 'MyDay' },
    { label: 'Customers', route: 'Customers' },
    { label: 'Quotes', route: 'Quotes' },
    { label: 'Invoices', route: 'Invoices' },
    { label: 'Notifications', route: 'Notifications' },
  ],
  TECHNICIAN: [
    { label: 'Quotes', route: 'Quotes' },
    { label: 'Notifications', route: 'Notifications' },
  ],
};

const routeRoles: Record<ProtectedStackRoute, BusinessRole[]> = {
  AppointmentDetails: [
    'OWNER',
    'ADMIN',
    'OFFICE_MANAGER',
    'SCHEDULER',
    'TECHNICIAN',
    'READ_ONLY',
  ],
  AppointmentForm: roles.appointmentCreate,
  AppointmentReassign: roles.appointmentManage,
  MediaEvidence: [
    'OWNER',
    'ADMIN',
    'OFFICE_MANAGER',
    'SCHEDULER',
    'TECHNICIAN',
    'SALES',
  ],
  MediaViewer: [
    'OWNER',
    'ADMIN',
    'OFFICE_MANAGER',
    'SCHEDULER',
    'TECHNICIAN',
    'ACCOUNTANT',
    'SALES',
    'READ_ONLY',
  ],
  CustomerDetails: [
    'OWNER',
    'ADMIN',
    'OFFICE_MANAGER',
    'SCHEDULER',
    'ACCOUNTANT',
    'SALES',
    'READ_ONLY',
  ],
  CustomerForm: roles.customerCreate,
  Customers: [
    'OWNER',
    'ADMIN',
    'OFFICE_MANAGER',
    'SCHEDULER',
    'ACCOUNTANT',
    'SALES',
    'READ_ONLY',
  ],
  Invoices: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'ACCOUNTANT', 'READ_ONLY'],
  JobDetails: [
    'OWNER',
    'ADMIN',
    'OFFICE_MANAGER',
    'SCHEDULER',
    'TECHNICIAN',
    'READ_ONLY',
  ],
  JobForm: roles.jobCreate,
  Jobs: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER', 'READ_ONLY'],
  MyDay: ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER', 'TECHNICIAN'],
  Notifications: [
    'OWNER',
    'ADMIN',
    'OFFICE_MANAGER',
    'SCHEDULER',
    'TECHNICIAN',
    'ACCOUNTANT',
    'SALES',
    'READ_ONLY',
  ],
  QuoteDetails: roles.quoteView,
  QuoteForm: roles.quoteCreate,
  Quotes: roles.quoteView,
  Settings: roles.businessSettings,
  Team: roles.teamManage,
  TeamMemberProfile: roles.teamManage,
};

function roleOrStaff(role?: BusinessRole | null): BusinessRole {
  return role ?? 'STAFF';
}

function allows(
  role: BusinessRole | null | undefined,
  allowed: BusinessRole[],
) {
  return allowed.includes(roleOrStaff(role));
}

export function getBottomTabsForRole(
  role?: BusinessRole | null,
): MainTabRoute[] {
  return bottomTabs[roleOrStaff(role)];
}

export function getDefaultTabForRole(role?: BusinessRole | null): MainTabRoute {
  return getBottomTabsForRole(role)[0] ?? 'Dashboard';
}

export function getMoreDestinationsForRole(
  role?: BusinessRole | null,
): MoreDestination[] {
  return moreDestinations[roleOrStaff(role)];
}

export function canAccessStackRoute(
  role: BusinessRole | null | undefined,
  route: ProtectedStackRoute,
) {
  return allows(role, routeRoles[route]);
}

export function getForbiddenRouteFallbackForRole(role?: BusinessRole | null): {
  stackRoute: 'Main';
  tabRoute: MainTabRoute;
} {
  return {
    stackRoute: 'Main',
    tabRoute: getDefaultTabForRole(role),
  };
}

export function canCreateAppointment(role?: BusinessRole | null) {
  return allows(role, roles.appointmentCreate);
}

export function canCreateCustomer(role?: BusinessRole | null) {
  return allows(role, roles.customerCreate);
}

export function canCreateJob(role?: BusinessRole | null) {
  return allows(role, roles.jobCreate);
}

export function canArchiveCustomer(role?: BusinessRole | null) {
  return allows(role, roles.customerArchive);
}

export function canArchiveJob(role?: BusinessRole | null) {
  return allows(role, roles.jobArchive);
}

export function canManageCustomer(role?: BusinessRole | null) {
  return allows(role, roles.customerManage);
}

export function canManageDispatcher(role?: BusinessRole | null) {
  return allows(role, roles.dispatcher);
}

export function canManageJob(role?: BusinessRole | null) {
  return allows(role, roles.jobManage);
}

export function canManageTeam(role?: BusinessRole | null) {
  return allows(role, roles.teamManage);
}

export function canViewBusinessSettings(role?: BusinessRole | null) {
  return allows(role, roles.businessSettings);
}
