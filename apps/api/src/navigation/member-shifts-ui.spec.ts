import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

describe('member shifts mobile UI contracts', () => {
  const repoRoot = resolve(__dirname, '..', '..', '..', '..');

  function mobileSource(path: string) {
    return readFileSync(join(repoRoot, 'apps', 'mobile', 'src', path), 'utf8');
  }

  function apiSource(path: string) {
    return readFileSync(join(repoRoot, 'apps', 'api', 'src', path), 'utf8');
  }

  it('registers owner-only Team Shifts navigation', () => {
    const rootNavigator = mobileSource('navigation/RootNavigator.tsx');
    const roleVisibility = mobileSource('permissions/roleVisibility.ts');
    const team = mobileSource('screens/TeamScreen.tsx');

    expect(rootNavigator).toContain('TeamShiftsScreen');
    expect(rootNavigator).toContain('name="TeamShifts"');
    expect(rootNavigator).toContain("options={{ title: 'Team shifts' }}");
    expect(roleVisibility).toContain("TeamShifts: ['OWNER']");
    expect(team).toContain("navigation.navigate('TeamShifts')");
  });

  it('renders dedicated shift management without appointment validation hooks', () => {
    const teamShifts = mobileSource('screens/TeamShiftsScreen.tsx');

    expect(teamShifts).toContain('Team shifts');
    expect(teamShifts).toContain('+ Add shift');
    expect(teamShifts).toContain('Start time');
    expect(teamShifts).toContain('End time');
    expect(teamShifts).toContain('Ends the following day');
    expect(teamShifts).toContain('On leave');
    expect(teamShifts).toContain('DateTimePicker');
    expect(teamShifts).toContain('validateMemberShiftPayload');
    expect(teamShifts).toContain('shiftOverlapsMemberLeave');
    expect(teamShifts).not.toContain('AppointmentForm');
    expect(teamShifts).not.toContain('recommendation');
  });

  it('registers owner shift API routes', () => {
    const controller = apiSource('member-shifts/member-shifts.controller.ts');
    const appModule = apiSource('app.module.ts');

    expect(controller).toContain("@Controller('team/shifts')");
    expect(controller).toContain('@Get()');
    expect(controller).toContain('@Post()');
    expect(controller).toContain("@Patch(':shiftId')");
    expect(controller).toContain("@Post(':shiftId/cancel')");
    expect(appModule).toContain('MemberShiftsModule');
  });
});
