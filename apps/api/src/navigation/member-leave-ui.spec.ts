import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

describe('member leave mobile UI contracts', () => {
  const repoRoot = resolve(__dirname, '..', '..', '..', '..');

  function mobileSource(path: string) {
    return readFileSync(join(repoRoot, 'apps', 'mobile', 'src', path), 'utf8');
  }

  function apiSource(path: string) {
    return readFileSync(join(repoRoot, 'apps', 'api', 'src', path), 'utf8');
  }

  it('exposes My availability from More for every role including read-only', () => {
    const roleVisibility = mobileSource('permissions/roleVisibility.ts');
    const rootNavigator = mobileSource('navigation/RootNavigator.tsx');

    expect(roleVisibility).toContain("'MyLeave'");
    expect(roleVisibility).toContain(
      "{ label: 'My availability', route: 'MyLeave' }",
    );
    expect(roleVisibility).toContain("'READ_ONLY'");
    expect(rootNavigator).toContain('MyLeaveScreen');
    expect(rootNavigator).toContain("options={{ title: 'My availability' }}");
  });

  it('uses native date pickers for self-service leave dates', () => {
    const myLeave = mobileSource('screens/MyLeaveScreen.tsx');

    expect(myLeave).toContain('mode="date"');
    expect(myLeave).toContain('DateOnlyField');
    expect(myLeave).toContain('formatDateOnlyForDisplay(value)');
    expect(myLeave).toContain('validateMemberLeaveRange');
    expect(myLeave).toContain('cancelMyLeaveRequest');
    expect(myLeave).toContain('Cancel this leave entry?');
    expect(myLeave).not.toContain('Appointment');
  });

  it('shows owner team leave with a lightweight shift-management entry only', () => {
    const team = mobileSource('screens/TeamScreen.tsx');

    expect(team).toContain('Team availability');
    expect(team).toContain('On leave today');
    expect(team).toContain('Upcoming leave');
    expect(team).toContain('teamLeaveRequest');
    expect(team).toContain('Manage shifts');
    expect(team).toContain('Shifts and assignment validation');
    expect(team).not.toContain('shift template');
  });

  it('registers leave API endpoints without appointment scheduling hooks', () => {
    const controller = apiSource('member-leave/member-leave.controller.ts');
    const appModule = apiSource('app.module.ts');

    expect(controller).toContain("@Get('me/leave')");
    expect(controller).toContain("@Post('me/leave')");
    expect(controller).toContain("@Patch('me/leave/:leaveId')");
    expect(controller).toContain("@Post('me/leave/:leaveId/cancel')");
    expect(controller).toContain("@Get('team/leave')");
    expect(appModule).toContain('MemberLeaveModule');
  });
});
