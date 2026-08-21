import { readFileSync } from 'fs';
import { join } from 'path';

const mobileRoot = join(__dirname, '../../../mobile/src');

describe('mobile password recovery contract', () => {
  it('exposes forgot-password and reset-password API helpers', () => {
    const client = readFileSync(join(mobileRoot, 'api/client.ts'), 'utf8');

    expect(client).toContain("'/auth/forgot-password'");
    expect(client).toContain("'/auth/reset-password'");
    expect(client).toContain('forgotPasswordRequest');
    expect(client).toContain('resetPasswordRequest');
  });

  it('shows a neutral forgot-password success message and preserves local logout semantics', () => {
    const forgotScreen = readFileSync(
      join(mobileRoot, 'screens/ForgotPasswordScreen.tsx'),
      'utf8',
    );
    const authContext = readFileSync(
      join(mobileRoot, 'auth/AuthContext.tsx'),
      'utf8',
    );

    expect(forgotScreen).toContain(
      'Enter your email and we’ll send reset instructions if an account',
    );
    expect(forgotScreen).not.toMatch(/account does not exist/i);
    expect(authContext).toContain('deleteStoredToken');
    expect(authContext).toContain('signOutAllDevicesRequest');
  });
});
