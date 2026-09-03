import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveMobileRuntimeConfig } from '@tradieos/shared';

const STAGING_API_URL = 'https://tradieos-staging-api.onrender.com/api';

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
        apiBaseUrl: `${STAGING_API_URL}/`,
        environment: 'staging',
      }),
    ).toEqual({
      apiBaseUrl: STAGING_API_URL,
      environment: 'staging',
    });
  });

  it('resolves the staging runtime config to the Render staging API', () => {
    const config = resolveMobileRuntimeConfig({
      apiBaseUrl: STAGING_API_URL,
      environment: 'staging',
    });

    expect(config.apiBaseUrl).toBe(STAGING_API_URL);
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

  it('rejects staging and production localhost, LAN and HTTP URLs', () => {
    expect(() =>
      resolveMobileRuntimeConfig({
        apiBaseUrl: 'http://localhost:3000/api',
        environment: 'staging',
      }),
    ).toThrow(/must use HTTPS/);

    expect(() =>
      resolveMobileRuntimeConfig({
        apiBaseUrl: 'https://192.168.0.234/api',
        environment: 'staging',
      }),
    ).toThrow(/local or private network host/);

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
      join(repoRoot, 'apps', 'mobile', 'eas.json'),
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

  it('keeps root and mobile staging EAS profiles pointed at the Render staging API', () => {
    const repoRoot = resolve(__dirname, '..', '..', '..', '..');
    const rootEas = readJson(join(repoRoot, 'eas.json')) as EasConfig;
    const mobileEas = readJson(
      join(repoRoot, 'apps', 'mobile', 'eas.json'),
    ) as EasConfig;

    expect(rootEas.build.staging.env.EXPO_PUBLIC_APP_ENV).toBe('staging');
    expect(rootEas.build.staging.env.EXPO_PUBLIC_API_URL).toBe(STAGING_API_URL);
    expect(mobileEas.build.staging.env.EXPO_PUBLIC_APP_ENV).toBe('staging');
    expect(mobileEas.build.staging.env.EXPO_PUBLIC_API_URL).toBe(
      STAGING_API_URL,
    );
  });

  it('keeps login, calendar appointments and job details on the shared mobile API client', () => {
    const repoRoot = resolve(__dirname, '..', '..', '..', '..');
    const client = readFileSync(
      join(repoRoot, 'apps', 'mobile', 'src', 'api', 'client.ts'),
      'utf8',
    );
    const calendar = readFileSync(
      join(repoRoot, 'apps', 'mobile', 'src', 'screens', 'CalendarScreen.tsx'),
      'utf8',
    );
    const jobDetails = readFileSync(
      join(
        repoRoot,
        'apps',
        'mobile',
        'src',
        'screens',
        'JobDetailsScreen.tsx',
      ),
      'utf8',
    );

    expect(client).toContain("import { apiUrl } from '../config/mobileConfig'");
    expect(client).toContain("apiRequest<AuthResponse>('/auth/login'");
    expect(client).toContain('apiRequest<JobDetailResponse>(`/jobs/${jobId}`');
    expect(client).toMatch(
      /apiRequest<AppointmentListResponse>\(\s*`\/appointments\$\{queryString\(params\)\}`/,
    );
    expect(calendar).toContain('appointmentsRequest(');
    expect(jobDetails).toContain('jobDetailRequest(token, jobId)');
    expect(jobDetails).toContain('buildApiRequestUrl(jobEndpoint)');
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

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

type EasConfig = {
  build: {
    staging: {
      env: {
        EXPO_PUBLIC_API_URL?: string;
        EXPO_PUBLIC_APP_ENV?: string;
      };
    };
  };
};
