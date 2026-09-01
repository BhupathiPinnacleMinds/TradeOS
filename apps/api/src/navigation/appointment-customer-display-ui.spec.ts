import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

describe('Appointment customer display UI contracts', () => {
  const repoRoot = resolve(__dirname, '..', '..', '..', '..');

  function mobileSource(path: string) {
    return readFileSync(join(repoRoot, 'apps', 'mobile', 'src', path), 'utf8');
  }

  it('keeps displayName as the primary appointment customer label', () => {
    const helper = mobileSource('utils/customerDisplay.ts');

    expect(helper).toContain('primaryCustomerName');
    expect(helper).toContain('customer.displayName?.trim()');
    expect(helper.indexOf('customer.displayName?.trim()')).toBeLessThan(
      helper.indexOf('customer.companyName?.trim()'),
    );
  });

  it('uses the shared customer display helper across appointment UI surfaces', () => {
    for (const source of [
      mobileSource('screens/CalendarScreen.tsx'),
      mobileSource('screens/MyDayScreen.tsx'),
      mobileSource('screens/AppointmentDetailsScreen.tsx'),
      mobileSource('screens/AppointmentReassignScreen.tsx'),
      mobileSource('screens/JobDetailsScreen.tsx'),
    ]) {
      expect(source).toContain('primaryCustomerName');
      expect(source).not.toMatch(
        /companyName\s*\?\?\s*[\s\S]{0,80}displayName/,
      );
    }
  });
});
