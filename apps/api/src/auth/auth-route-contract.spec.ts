import { readFileSync } from 'fs';
import { join } from 'path';

describe('auth route contract', () => {
  const controller = readFileSync(
    join(__dirname, 'auth.controller.ts'),
    'utf8',
  );

  it('keeps account recovery and revocation endpoints on the strict auth rate-limit policy', () => {
    const protectedRoutes = [
      "Post('forgot-password')",
      "Post('reset-password')",
      "Post('change-password')",
      "Post('sign-out-all-devices')",
    ];

    for (const route of protectedRoutes) {
      const routeIndex = controller.indexOf(route);
      expect(routeIndex).toBeGreaterThan(0);
      const precedingDecorators = controller.slice(
        Math.max(0, routeIndex - 120),
        routeIndex,
      );
      expect(precedingDecorators).toContain("@RateLimitPolicy('auth')");
    }
  });

  it('keeps forgot/reset password public while requiring JWT for change/revoke', () => {
    const forgotPasswordBlock = controller.slice(
      controller.indexOf("Post('forgot-password')") - 120,
      controller.indexOf("Post('forgot-password')"),
    );
    const resetPasswordBlock = controller.slice(
      controller.indexOf("Post('reset-password')") - 120,
      controller.indexOf("Post('reset-password')"),
    );
    const changePasswordBlock = controller.slice(
      controller.indexOf("Post('change-password')") - 120,
      controller.indexOf("Post('change-password')"),
    );

    expect(forgotPasswordBlock).toContain('@Public()');
    expect(resetPasswordBlock).toContain('@Public()');
    expect(changePasswordBlock).not.toContain('@Public()');
  });
});
