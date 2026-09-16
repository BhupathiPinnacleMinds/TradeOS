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

  it('routes password reset links to the public reset screen without requiring login', () => {
    const navigator = readFileSync(
      join(mobileRoot, 'navigation/RootNavigator.tsx'),
      'utf8',
    );

    expect(navigator).toContain("pathname === '/reset-password'");
    expect(navigator).toContain(
      'pathname.match(/^\\/reset-password\\/([^/]+)$/)',
    );
    expect(navigator).toContain(
      "resetPasswordToken\n          ? 'ResetPassword'",
    );
    expect(navigator).toContain('token && !resetPasswordToken');
    expect(navigator).toContain('name="ResetPassword"');
  });

  it('uses the reset token from the link and shows safe reset outcomes', () => {
    const resetScreen = readFileSync(
      join(mobileRoot, 'screens/ResetPasswordScreen.tsx'),
      'utf8',
    );

    expect(resetScreen).toContain('const tokenFromLink');
    expect(resetScreen).toContain('{!tokenFromLink ? (');
    expect(resetScreen).toContain('Passwords do not match.');
    expect(resetScreen).toContain(
      'Password reset successfully. You can now sign in.',
    );
    expect(resetScreen).toContain(
      'This password reset link is invalid or has expired. Please request a new password reset link.',
    );
    expect(resetScreen).not.toContain('Paste the reset token');
  });

  it('shows a business workspace creation success toast after registration succeeds', () => {
    const registerScreen = readFileSync(
      join(mobileRoot, 'screens/RegisterScreen.tsx'),
      'utf8',
    );

    expect(registerScreen).toContain('await register(form)');
    expect(registerScreen).toContain('showToast');
    expect(registerScreen).toContain(
      'Business workspace created successfully. Welcome to TradeOS.',
    );
    expect(registerScreen).toContain(
      'has been created successfully. Welcome to TradeOS.',
    );
  });
});
