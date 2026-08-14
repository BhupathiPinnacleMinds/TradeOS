import type { BusinessRole } from '@tradieos/shared';
import {
  canAccessStackRoute,
  canCreateAppointment,
  canCreateCustomer,
  canCreateInvoice,
  canCreateJob,
  canCreateQuote,
  canManageDispatcher,
  canManageTeam,
  canViewBusinessSettings,
  getBottomTabsForRole,
  getDefaultTabForRole,
  getForbiddenRouteFallbackForRole,
  getMoreDestinationsForRole,
} from '../../../mobile/src/permissions/roleVisibility';

describe('mobile role visibility matrix', () => {
  const expectedTabs: Record<BusinessRole, string[]> = {
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

  it.each(Object.entries(expectedTabs) as Array<[BusinessRole, string[]]>)(
    'shows the documented bottom tabs for %s',
    (role, tabs) => {
      expect(getBottomTabsForRole(role)).toEqual(tabs);
      expect(getDefaultTabForRole(role)).toBe(tabs[0]);
    },
  );

  it('hides customer, job, team and dispatcher management from technicians', () => {
    const role: BusinessRole = 'TECHNICIAN';
    const moreRoutes = getMoreDestinationsForRole(role).map(
      (destination) => destination.route,
    );

    expect(getDefaultTabForRole(role)).toBe('MyDay');
    expect(getBottomTabsForRole(role)).not.toContain('Customers');
    expect(getBottomTabsForRole(role)).not.toContain('Jobs');
    expect(moreRoutes).not.toContain('Customers');
    expect(moreRoutes).not.toContain('Team');
    expect(moreRoutes).not.toContain('Settings');
    expect(moreRoutes).not.toContain('AccountsReceivable');
    expect(canCreateCustomer(role)).toBe(false);
    expect(canCreateJob(role)).toBe(false);
    expect(canCreateQuote(role)).toBe(false);
    expect(canCreateAppointment(role)).toBe(false);
    expect(canManageDispatcher(role)).toBe(false);
    expect(canManageTeam(role)).toBe(false);
    expect(canAccessStackRoute(role, 'CustomerForm')).toBe(false);
    expect(canAccessStackRoute(role, 'JobForm')).toBe(false);
    expect(canAccessStackRoute(role, 'AppointmentForm')).toBe(false);
    expect(canAccessStackRoute(role, 'QuoteForm')).toBe(false);
    expect(canAccessStackRoute(role, 'AccountsReceivable')).toBe(false);
    expect(canAccessStackRoute(role, 'Team')).toBe(false);
  });

  it('blocks accountant scheduling management screens and actions', () => {
    const role: BusinessRole = 'ACCOUNTANT';

    expect(canAccessStackRoute(role, 'AppointmentForm')).toBe(false);
    expect(canAccessStackRoute(role, 'AppointmentReassign')).toBe(false);
    expect(canCreateAppointment(role)).toBe(false);
    expect(canCreateQuote(role)).toBe(false);
    expect(canManageDispatcher(role)).toBe(false);
  });

  it('allows scheduler invoice visibility but blocks invoice creation/settings', () => {
    const role: BusinessRole = 'SCHEDULER';
    const moreRoutes = getMoreDestinationsForRole(role).map(
      (destination) => destination.route,
    );

    expect(moreRoutes).toContain('Invoices');
    expect(moreRoutes).not.toContain('Settings');
    expect(canAccessStackRoute(role, 'Invoices')).toBe(true);
    expect(canAccessStackRoute(role, 'AccountsReceivable')).toBe(false);
    expect(canAccessStackRoute(role, 'InvoiceForm')).toBe(false);
    expect(canAccessStackRoute(role, 'Settings')).toBe(false);
    expect(canAccessStackRoute(role, 'QuoteForm')).toBe(false);
    expect(canCreateInvoice(role)).toBe(false);
    expect(canCreateQuote(role)).toBe(false);
    expect(canViewBusinessSettings(role)).toBe(false);
  });

  it('prevents read-only users reaching create or edit forms', () => {
    const role: BusinessRole = 'READ_ONLY';

    expect(canAccessStackRoute(role, 'CustomerForm')).toBe(false);
    expect(canAccessStackRoute(role, 'JobForm')).toBe(false);
    expect(canAccessStackRoute(role, 'AppointmentForm')).toBe(false);
    expect(canAccessStackRoute(role, 'AppointmentReassign')).toBe(false);
    expect(canAccessStackRoute(role, 'QuoteForm')).toBe(false);
    expect(canAccessStackRoute(role, 'InvoiceForm')).toBe(false);
    expect(canCreateCustomer(role)).toBe(false);
    expect(canCreateJob(role)).toBe(false);
    expect(canCreateAppointment(role)).toBe(false);
    expect(canCreateQuote(role)).toBe(false);
  });

  it('shows sales only permitted customer and sales areas', () => {
    const role: BusinessRole = 'SALES';

    expect(getBottomTabsForRole(role)).toEqual([
      'Dashboard',
      'Customers',
      'Quotes',
      'Tori',
      'More',
    ]);
    expect(canCreateCustomer(role)).toBe(true);
    expect(canCreateJob(role)).toBe(false);
    expect(canCreateAppointment(role)).toBe(false);
    expect(canCreateInvoice(role)).toBe(true);
    expect(canCreateQuote(role)).toBe(true);
    expect(canAccessStackRoute(role, 'Invoices')).toBe(true);
    expect(canAccessStackRoute(role, 'AccountsReceivable')).toBe(false);
    expect(canAccessStackRoute(role, 'InvoiceForm')).toBe(true);
    expect(canAccessStackRoute(role, 'Team')).toBe(false);
  });

  it('keeps owner full operational access', () => {
    const role: BusinessRole = 'OWNER';

    expect(canCreateCustomer(role)).toBe(true);
    expect(canCreateJob(role)).toBe(true);
    expect(canCreateAppointment(role)).toBe(true);
    expect(canCreateInvoice(role)).toBe(true);
    expect(canCreateQuote(role)).toBe(true);
    expect(canAccessStackRoute(role, 'AccountsReceivable')).toBe(true);
    expect(canManageDispatcher(role)).toBe(true);
    expect(canManageTeam(role)).toBe(true);
    expect(canViewBusinessSettings(role)).toBe(true);
  });

  it('returns a safe permitted home fallback for forbidden deep or stale routes', () => {
    expect(getForbiddenRouteFallbackForRole('TECHNICIAN')).toEqual({
      stackRoute: 'Main',
      tabRoute: 'MyDay',
    });
    expect(getForbiddenRouteFallbackForRole('READ_ONLY')).toEqual({
      stackRoute: 'Main',
      tabRoute: 'Dashboard',
    });
  });
});
