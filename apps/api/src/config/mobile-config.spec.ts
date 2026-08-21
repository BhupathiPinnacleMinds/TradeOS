import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveMobileRuntimeConfig } from '@tradieos/shared';

describe('mobile environment configuration', () => {
  it('accepts a development local API URL', () => {
    expect(
      resolveMobileRuntimeConfig({
        apiBaseUrl: 'http://localhost:3000/api',
        environment: 'development',
      }),
    ).toEqual({
      apiBaseUrl: 'http://localhost:3000/api',
      environment: 'development',
    });
  });

  it('keeps the localhost fallback development-only', () => {
    expect(resolveMobileRuntimeConfig()).toEqual({
      apiBaseUrl: 'http://localhost:3000/api',
      environment: 'development',
    });
  });

  it('requires an explicit staging API URL', () => {
    expect(() =>
      resolveMobileRuntimeConfig({ environment: 'staging' }),
    ).toThrow(/EXPO_PUBLIC_API_URL is required for staging/);
  });

  it('requires an explicit production API URL', () => {
    expect(() =>
      resolveMobileRuntimeConfig({ environment: 'production' }),
    ).toThrow(/EXPO_PUBLIC_API_URL is required for production/);
  });

  it('accepts staging HTTPS API URLs', () => {
    expect(
      resolveMobileRuntimeConfig({
        apiBaseUrl: 'https://staging-api.tradieos.example/api/',
        environment: 'staging',
      }),
    ).toEqual({
      apiBaseUrl: 'https://staging-api.tradieos.example/api',
      environment: 'staging',
    });
  });

  it('accepts production HTTPS API URLs', () => {
    expect(
      resolveMobileRuntimeConfig({
        apiBaseUrl: 'https://api.tradieos.example/api',
        environment: 'production',
      }),
    ).toEqual({
      apiBaseUrl: 'https://api.tradieos.example/api',
      environment: 'production',
    });
  });

  it('rejects production localhost, LAN and HTTP URLs', () => {
    expect(() =>
      resolveMobileRuntimeConfig({
        apiBaseUrl: 'https://localhost/api',
        environment: 'production',
      }),
    ).toThrow(/local or private network host/);

    expect(() =>
      resolveMobileRuntimeConfig({
        apiBaseUrl: 'https://192.168.0.234/api',
        environment: 'production',
      }),
    ).toThrow(/local or private network host/);

    expect(() =>
      resolveMobileRuntimeConfig({
        apiBaseUrl: 'http://api.tradieos.example/api',
        environment: 'production',
      }),
    ).toThrow(/must use HTTPS/);
  });

  it('rejects API URLs that omit the /api base path', () => {
    expect(() =>
      resolveMobileRuntimeConfig({
        apiBaseUrl: 'https://api.tradieos.example',
        environment: 'production',
      }),
    ).toThrow(/must include the \/api base path/);
  });

  it('does not reference server-only secrets from mobile source or EAS config', () => {
    const repoRoot = resolve(__dirname, '..', '..', '..', '..');
    const files = [
      ...listFiles(join(repoRoot, 'apps', 'mobile', 'src')),
      join(repoRoot, 'apps', 'mobile', '.env.example'),
      join(repoRoot, 'apps', 'mobile', 'app.config.js'),
      join(repoRoot, 'apps', 'mobile', 'app.json'),
      join(repoRoot, 'apps', 'mobile', 'package.json'),
      join(repoRoot, 'eas.json'),
    ];
    const forbidden = [
      'DATABASE_URL',
      'JWT_SECRET',
      'RESEND_API_KEY',
      'TWILIO_AUTH_TOKEN',
      'S3_SECRET_ACCESS_KEY',
      'OPENAI_API_KEY',
      'CRON_SECRET',
    ];

    const offenders = files.flatMap((file) => {
      const content = readFileSync(file, 'utf8');
      return forbidden
        .filter((secretName) => content.includes(secretName))
        .map((secretName) => `${file}:${secretName}`);
    });

    expect(offenders).toEqual([]);
  });
});

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return listFiles(path);
    }
    return [path];
  });
}
