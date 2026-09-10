import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getBusinessGreeting } from '@tradieos/shared';

describe('staging mobile regression UI contracts', () => {
  const repoRoot = resolve(__dirname, '..', '..', '..', '..');

  function mobileSource(path: string) {
    return readFileSync(join(repoRoot, 'apps', 'mobile', 'src', path), 'utf8');
  }

  it('navigates appointment notifications using authoritative metadata appointment IDs', () => {
    const notificationsScreen = mobileSource('screens/NotificationsScreen.tsx');

    expect(notificationsScreen).toContain('appointmentIdForNotification');
    expect(notificationsScreen).toContain(
      "notification.entityType === 'appointment' && notification.entityId",
    );
    expect(notificationsScreen).toContain(
      'const metadataAppointmentId = notification.metadata?.appointmentId;',
    );
    expect(notificationsScreen).toContain(
      "notification.type.startsWith('APPOINTMENT_')",
    );
    expect(notificationsScreen).toContain(
      "navigation.navigate('AppointmentDetails', {\n        appointmentId,",
    );
    expect(notificationsScreen).not.toContain('notification.body.match');
  });

  it('navigates after marking notifications read with updated unread count', () => {
    const notificationsScreen = mobileSource('screens/NotificationsScreen.tsx');

    expect(notificationsScreen).toContain(
      'let nextNotification = notification;',
    );
    expect(notificationsScreen).toContain(
      'nextNotification = response.notification;',
    );
    expect(notificationsScreen).toContain(
      'setUnreadCount(response.unreadCount);',
    );
    expect(notificationsScreen).toContain(
      'navigateForNotification(nextNotification);',
    );
  });

  it('uses the business-timezone greeting helper on Dashboard instead of a hardcoded daypart', () => {
    const dashboardScreen = mobileSource('screens/DashboardScreen.tsx');

    expect(dashboardScreen).toContain('getBusinessGreeting');
    expect(dashboardScreen).toContain('const [greetingNow, setGreetingNow]');
    expect(dashboardScreen).toContain('timezone: businessTimezone');
    expect(dashboardScreen).toContain('{greeting}');
    expect(dashboardScreen).not.toContain('Good morning{user?.firstName');
  });

  it('keeps dashboard greetings deterministic across Melbourne daypart boundaries', () => {
    expect(
      getBusinessGreeting({
        firstName: 'Bhupathi',
        now: '2026-09-08T02:49:00.000Z',
        timezone: 'Australia/Melbourne',
      }),
    ).toBe('Good afternoon, Bhupathi');
    expect(
      getBusinessGreeting({
        firstName: 'Bhupathi',
        now: '2026-09-07T21:30:00.000Z',
        timezone: 'Australia/Melbourne',
      }),
    ).toBe('Good morning, Bhupathi');
    expect(
      getBusinessGreeting({
        firstName: 'Bhupathi',
        now: '2026-09-08T08:30:00.000Z',
        timezone: 'Australia/Melbourne',
      }),
    ).toBe('Good evening, Bhupathi');
  });

  it('shows date plus scheduled time only for My Day completed-today cards', () => {
    const myDayScreen = mobileSource('screens/MyDayScreen.tsx');
    const laterTodayIndex = myDayScreen.indexOf(
      '<Section title="Later today">',
    );
    const completedTodayIndex = myDayScreen.indexOf(
      '<Section title="Completed today">',
    );
    const completedShowScheduledDateIndex = myDayScreen.indexOf(
      'showScheduledDate',
      completedTodayIndex,
    );

    expect(myDayScreen).toContain('showScheduledDate');
    expect(laterTodayIndex).toBeGreaterThan(-1);
    expect(completedTodayIndex).toBeGreaterThan(laterTodayIndex);
    expect(completedShowScheduledDateIndex).toBeGreaterThan(
      completedTodayIndex,
    );
    expect(myDayScreen).toContain('formatBusinessCompactDateTimeRange');
    expect(myDayScreen).toContain(
      'formatBusinessCompactDateTimeRange(\n                appointment.scheduledStart,\n                appointment.scheduledEnd,\n                timezone,',
    );
    expect(myDayScreen).toContain(
      ': formatBusinessTime(appointment.scheduledStart, timezone)',
    );
  });

  it('shows the scheduled date and time range on the My Day next appointment card', () => {
    const myDayScreen = mobileSource('screens/MyDayScreen.tsx');

    expect(myDayScreen).toContain('<NextAppointment');
    expect(myDayScreen).toContain('showScheduledDate');
    expect(myDayScreen).toContain(
      'formatBusinessCompactDateTimeRange(\n                appointment.scheduledStart,\n                appointment.scheduledEnd,\n                timezone,',
    );
    expect(myDayScreen).toContain(
      'showScheduledDate\n          ? null\n          : ` · ${formatBusinessTimeRange(',
    );
  });
});
