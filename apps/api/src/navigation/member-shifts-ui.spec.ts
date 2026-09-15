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

  it('uses canonical shiftDate for native date picker state and API payloads', () => {
    const teamShifts = mobileSource('screens/TeamShiftsScreen.tsx');
    const client = mobileSource('api/client.ts');

    expect(teamShifts).toContain(
      "type PickerField = 'endTime' | 'shiftDate' | 'startTime';",
    );
    expect(teamShifts).toContain("setPickerField('shiftDate')");
    expect(teamShifts).toContain("pickerField === 'shiftDate'");
    expect(teamShifts).toContain('[pickerField]:');
    expect(teamShifts).toContain('shiftDate: date,');
    expect(teamShifts).not.toContain("setPickerField('date')");
    expect(client).toContain("apiRequest<MemberShiftResponse>('/team/shifts'");
    expect(client).toContain('body: JSON.stringify(input)');
  });

  it('converts picker dates with local calendar components instead of UTC ISO slicing', () => {
    const teamShifts = mobileSource('screens/TeamShiftsScreen.tsx');
    const myLeave = mobileSource('screens/MyLeaveScreen.tsx');

    expect(teamShifts).toContain('value.getFullYear()');
    expect(teamShifts).toContain('value.getMonth() + 1');
    expect(teamShifts).toContain('value.getDate()');
    expect(teamShifts).not.toContain('toISOString().slice(0, 10)');
    expect(myLeave).toContain('value.getFullYear()');
    expect(myLeave).toContain('value.getMonth() + 1');
    expect(myLeave).toContain('value.getDate()');
    expect(myLeave).not.toContain('toISOString().slice(0, 10)');
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
