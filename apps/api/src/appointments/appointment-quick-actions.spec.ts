import {
  APPOINTMENT_MORE_ACTIONS_DISMISS_ID,
  dismissedAppointmentMoreActionsMenuState,
  getAppointmentQuickActions,
  openedAppointmentMoreActionsMenuState,
  shouldExecuteAppointmentMoreActionsMenuItem,
} from '@tradieos/shared';

function actionIds(input: Parameters<typeof getAppointmentQuickActions>[0]) {
  return getAppointmentQuickActions(input).map((action) => action.id);
}

function actionLabels(input: Parameters<typeof getAppointmentQuickActions>[0]) {
  return getAppointmentQuickActions(input).map((action) => action.label);
}

describe('getAppointmentQuickActions', () => {
  it('shows scheduled appointment actions when contact and address exist', () => {
    expect(
      actionIds({
        hasAddress: true,
        hasPhone: true,
        isAssignedUser: false,
        role: 'OWNER',
        status: 'SCHEDULED',
      }),
    ).toEqual([
      'navigate',
      'call',
      'confirm',
      'reassign',
      'reschedule',
      'cancel',
    ]);
  });

  it('labels destructive cancellation explicitly', () => {
    expect(
      actionLabels({
        hasAddress: true,
        hasPhone: true,
        isAssignedUser: false,
        role: 'OWNER',
        status: 'SCHEDULED',
      }),
    ).toContain('Cancel appointment');
  });

  it('shows confirmed appointment actions', () => {
    expect(
      actionIds({
        hasAddress: true,
        hasPhone: true,
        isAssignedUser: false,
        role: 'ADMIN',
        status: 'CONFIRMED',
      }),
    ).toEqual(['navigate', 'call', 'reassign', 'reschedule', 'cancel']);
  });

  it('hides technician execution actions from owners and admins unless they are assigned', () => {
    expect(
      actionIds({
        hasAddress: true,
        hasPhone: true,
        isAssignedUser: false,
        role: 'OWNER',
        status: 'IN_PROGRESS',
      }),
    ).toEqual(['call', 'reassign', 'cancel']);

    expect(
      actionIds({
        hasAddress: true,
        hasPhone: true,
        isAssignedUser: true,
        role: 'OWNER',
        status: 'IN_PROGRESS',
      }),
    ).toEqual(['call', 'pause', 'complete', 'reassign', 'cancel']);
  });

  it('shows arrive for on-the-way appointments', () => {
    expect(
      actionIds({
        hasAddress: true,
        hasPhone: true,
        isAssignedUser: true,
        role: 'TECHNICIAN',
        status: 'ON_THE_WAY',
      }),
    ).toEqual(['navigate', 'call', 'arrive', 'cancel']);
  });

  it('shows start for arrived appointments', () => {
    expect(
      actionIds({
        hasAddress: true,
        hasPhone: true,
        isAssignedUser: true,
        role: 'TECHNICIAN',
        status: 'ARRIVED',
      }),
    ).toEqual(['call', 'start', 'cancel']);
  });

  it('shows pause and complete for in-progress appointments', () => {
    expect(
      actionIds({
        hasAddress: true,
        hasPhone: true,
        isAssignedUser: true,
        role: 'TECHNICIAN',
        status: 'IN_PROGRESS',
      }),
    ).toEqual(['call', 'pause', 'complete', 'cancel']);
  });

  it('shows resume for paused appointments', () => {
    expect(
      actionIds({
        hasAddress: true,
        hasPhone: true,
        isAssignedUser: true,
        role: 'TECHNICIAN',
        status: 'PAUSED',
      }),
    ).toEqual(['resume', 'cancel']);
  });

  it('hides workflow actions for completed appointments', () => {
    expect(
      actionIds({
        hasAddress: true,
        hasPhone: true,
        isAssignedUser: true,
        role: 'OWNER',
        status: 'COMPLETED',
      }),
    ).toEqual(['viewDetails']);
  });

  it('never shows workflow actions for rescheduled historical appointments', () => {
    expect(
      actionIds({
        hasAddress: true,
        hasPhone: true,
        isAssignedUser: true,
        role: 'OWNER',
        status: 'RESCHEDULED',
      }),
    ).toEqual(['viewDetails']);
  });

  it('shows reschedule for cancelled and no-show appointments only when permitted', () => {
    expect(
      actionIds({
        hasAddress: true,
        hasPhone: true,
        isAssignedUser: false,
        role: 'SCHEDULER',
        status: 'CANCELLED',
      }),
    ).toEqual(['reschedule', 'viewDetails']);

    expect(
      actionIds({
        hasAddress: true,
        hasPhone: true,
        isAssignedUser: false,
        role: 'READ_ONLY',
        status: 'NO_SHOW',
      }),
    ).toEqual(['viewDetails']);
  });

  it('hides call and navigate when phone or address are missing', () => {
    expect(
      actionIds({
        hasAddress: false,
        hasPhone: false,
        isAssignedUser: false,
        role: 'OWNER',
        status: 'SCHEDULED',
      }),
    ).toEqual(['confirm', 'reassign', 'reschedule', 'cancel']);
  });

  it('limits technicians to status updates on assigned appointments', () => {
    expect(
      actionIds({
        hasAddress: true,
        hasPhone: true,
        isAssignedUser: false,
        role: 'TECHNICIAN',
        status: 'SCHEDULED',
      }),
    ).toEqual(['navigate', 'call']);
  });

  it('does not show confirm for technicians, accountants, sales or read-only users', () => {
    for (const role of [
      'TECHNICIAN',
      'ACCOUNTANT',
      'SALES',
      'READ_ONLY',
    ] as const) {
      expect(
        actionIds({
          hasAddress: true,
          hasPhone: true,
          isAssignedUser: role === 'TECHNICIAN',
          role,
          status: 'SCHEDULED',
        }),
      ).not.toContain('confirm');
    }
  });

  it('shows start travel to the assigned technician only after confirmation', () => {
    expect(
      actionIds({
        hasAddress: true,
        hasPhone: true,
        isAssignedUser: true,
        role: 'TECHNICIAN',
        status: 'SCHEDULED',
      }),
    ).not.toContain('startTravel');

    expect(
      actionIds({
        hasAddress: true,
        hasPhone: true,
        isAssignedUser: true,
        role: 'TECHNICIAN',
        status: 'CONFIRMED',
      }),
    ).toContain('startTravel');
  });

  it('hides normal workflow actions for expired unstarted appointments', () => {
    expect(
      actionIds({
        hasAddress: true,
        hasPhone: true,
        isAssignedUser: false,
        isExpired: true,
        role: 'OWNER',
        status: 'SCHEDULED',
      }),
    ).toEqual(['navigate', 'call', 'reassign', 'reschedule', 'cancel']);

    expect(
      actionIds({
        hasAddress: true,
        hasPhone: true,
        isAssignedUser: true,
        isExpired: true,
        role: 'TECHNICIAN',
        status: 'CONFIRMED',
      }),
    ).toEqual(['navigate', 'call', 'cancel']);
  });

  it('never shows confirm for terminal statuses', () => {
    for (const status of [
      'CANCELLED',
      'COMPLETED',
      'NO_SHOW',
      'RESCHEDULED',
    ] as const) {
      expect(
        actionIds({
          hasAddress: true,
          hasPhone: true,
          isAssignedUser: false,
          role: 'OWNER',
          status,
        }),
      ).not.toContain('confirm');
    }
  });
});

describe('appointment More actions menu state', () => {
  it('treats menu Cancel as pure dismissal and never as an action to execute', () => {
    expect(
      shouldExecuteAppointmentMoreActionsMenuItem(
        APPOINTMENT_MORE_ACTIONS_DISMISS_ID,
      ),
    ).toBe(false);
    expect(shouldExecuteAppointmentMoreActionsMenuItem('call')).toBe(true);
    expect(shouldExecuteAppointmentMoreActionsMenuItem('job')).toBe(true);
  });

  it('resets transient state when the menu is dismissed', () => {
    expect(dismissedAppointmentMoreActionsMenuState()).toEqual({
      backdropEnabled: false,
      dismissing: false,
      hasPendingActionTimer: false,
      opening: false,
      pendingActionId: null,
      selectedActionId: null,
      touchBlocked: false,
      visible: false,
    });
  });

  it('opens without creating a pending action timer', () => {
    expect(openedAppointmentMoreActionsMenuState()).toEqual({
      backdropEnabled: true,
      dismissing: false,
      hasPendingActionTimer: false,
      opening: false,
      pendingActionId: null,
      selectedActionId: null,
      touchBlocked: false,
      visible: true,
    });
  });
});
