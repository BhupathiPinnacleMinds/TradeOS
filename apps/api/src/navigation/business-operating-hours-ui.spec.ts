import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

describe('business operating hours mobile UI contracts', () => {
  const repoRoot = resolve(__dirname, '..', '..', '..', '..');

  function source(path: string) {
    return readFileSync(join(repoRoot, path), 'utf8');
  }

  function mobileSource(path: string) {
    return source(join('apps', 'mobile', 'src', path));
  }

  it('captures business hours during workspace creation with native time pickers', () => {
    const register = mobileSource('screens/RegisterScreen.tsx');
    const client = mobileSource('api/client.ts');

    expect(register).toContain('Business hours');
    expect(register).toContain('DEFAULT_BUSINESS_START_TIME');
    expect(register).toContain('DEFAULT_BUSINESS_END_TIME');
    expect(register).toContain('mode="time"');
    expect(register).toContain('formatBusinessClockTime(value)');
    expect(register).toContain('Ends the following day');
    expect(register).toContain('validateBusinessOperatingHours');
    expect(client).toContain('businessStartTime?: string');
    expect(client).toContain('businessEndTime?: string');
  });

  it('lets workspace admins update business hours in Settings', () => {
    const settings = mobileSource('screens/SettingsScreen.tsx');
    const client = mobileSource('api/client.ts');

    expect(settings).toContain('Business hours');
    expect(settings).toContain('Save business hours');
    expect(settings).toContain('businessOperatingHoursRequest');
    expect(settings).toContain('updateBusinessOperatingHoursRequest');
    expect(settings).toContain("setOperatingHoursPicker('businessStartTime')");
    expect(settings).toContain("setOperatingHoursPicker('businessEndTime')");
    expect(settings).toContain('mode="time"');
    expect(settings).toContain('Ends the following day');
    expect(client).toContain("'/business/operating-hours'");
  });

  it('stores business hours as canonical HH:mm strings in the API schema and DTOs', () => {
    const schema = source(join('apps', 'api', 'prisma', 'schema.prisma'));
    const authDto = source(
      join('apps', 'api', 'src', 'auth', 'dto', 'auth.dto.ts'),
    );
    const businessesDto = source(
      join('apps', 'api', 'src', 'businesses', 'dto', 'businesses.dto.ts'),
    );
    const authService = source(
      join('apps', 'api', 'src', 'auth', 'auth.service.ts'),
    );
    const businessesService = source(
      join('apps', 'api', 'src', 'businesses', 'businesses.service.ts'),
    );

    expect(schema).toContain('businessStartTime            String');
    expect(schema).toContain('@default("08:00")');
    expect(schema).toContain('businessEndTime              String');
    expect(schema).toContain('@default("17:00")');
    expect(authDto).toContain('businessStartTime?: string');
    expect(authDto).toContain('businessEndTime?: string');
    expect(businessesDto).toContain('UpdateBusinessOperatingHoursDto');
    expect(authService).toContain('validateBusinessOperatingHours');
    expect(authService).toContain('businessStartTime,');
    expect(authService).toContain('businessEndTime,');
    expect(businessesService).toContain('updateOperatingHours');
  });
});
