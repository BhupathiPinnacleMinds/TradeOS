import { getAppointmentQuickActions } from '@tradieos/shared';

function actionIds(input: Parameters<typeof getAppointmentQuickActions>[0]) {
  return getAppointmentQuickActions(input).map((action) => action.id);
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
    ).toEqual(['navigate', 'call', 'start', 'reassign', 'cancel']);
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
    ).toEqual(['navigate', 'call', 'start', 'reassign', 'cancel']);
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

  it('shows complete for in-progress appointments', () => {
    expect(
      actionIds({
        hasAddress: true,
        hasPhone: true,
        isAssignedUser: true,
        role: 'TECHNICIAN',
        status: 'IN_PROGRESS',
      }),
    ).toEqual(['call', 'complete', 'cancel']);
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
    ).toEqual(['start', 'reassign', 'cancel']);
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
});
