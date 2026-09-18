import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

describe('appointment availability attention UI', () => {
  const repoRoot = resolve(__dirname, '..', '..', '..', '..');
  const source = (name: string) =>
    readFileSync(join(repoRoot, 'apps', 'mobile', 'src', name), 'utf8');

  it('uses the same notice on calendar, dispatcher, My Day, appointment and job details', () => {
    for (const screen of [
      'CalendarScreen.tsx',
      'MyDayScreen.tsx',
      'AppointmentDetailsScreen.tsx',
      'JobDetailsScreen.tsx',
    ]) {
      expect(source(`screens/${screen}`)).toContain(
        'AppointmentAttentionNotice',
      );
    }
    expect(source('screens/CalendarScreen.tsx')).toMatch(
      /AppointmentAttentionNotice/g,
    );
    expect(source('components/AppointmentAttentionNotice.tsx')).toContain(
      'appointmentAttentionLabel',
    );
  });

  it('keeps reassignment behind the existing appointment permissions', () => {
    const details = source('screens/AppointmentDetailsScreen.tsx');
    expect(details).toMatch(
      /quickActions\.find\([\s\S]*?action\.id === 'reassign'/,
    );
    expect(details).toContain("navigation.navigate('AppointmentReassign'");
    expect(details).toContain('appointment.availabilityConflict');
  });
});
