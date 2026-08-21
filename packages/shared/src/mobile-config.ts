export type MobileAppEnvironment = 'development' | 'staging' | 'production';

export interface MobileRuntimeConfigInput {
  apiBaseUrl?: string | null;
  environment?: string | null;
}

export interface MobileRuntimeConfig {
  apiBaseUrl: string;
  environment: MobileAppEnvironment;
}

const DEVELOPMENT_API_URL = 'http://localhost:3000/api';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

export function resolveMobileRuntimeConfig(
  input: MobileRuntimeConfigInput = {},
): MobileRuntimeConfig {
  const environment = normaliseMobileEnvironment(input.environment);
  const rawApiBaseUrl = input.apiBaseUrl?.trim();

  if (!rawApiBaseUrl) {
    if (environment === 'development') {
      return {
        apiBaseUrl: DEVELOPMENT_API_URL,
        environment,
      };
    }

    throw new Error(
      `EXPO_PUBLIC_API_URL is required for ${environment} mobile builds.`,
    );
  }

  const apiBaseUrl = normaliseApiBaseUrl(rawApiBaseUrl, environment);
  return { apiBaseUrl, environment };
}

export function normaliseMobileEnvironment(
  value?: string | null,
): MobileAppEnvironment {
  const normalised = value?.trim().toLowerCase();
  if (!normalised || normalised === 'dev' || normalised === 'local') {
    return 'development';
  }
  if (normalised === 'preview' || normalised === 'beta') {
    return 'staging';
  }
  if (
    normalised === 'development' ||
    normalised === 'staging' ||
    normalised === 'production'
  ) {
    return normalised;
  }

  throw new Error(
    `Unsupported mobile environment "${value}". Use development, staging or production.`,
  );
}

function normaliseApiBaseUrl(
  rawApiBaseUrl: string,
  environment: MobileAppEnvironment,
) {
  let parsed: URL;
  try {
    parsed = new URL(rawApiBaseUrl);
  } catch {
    throw new Error('EXPO_PUBLIC_API_URL must be a valid absolute URL.');
  }

  if (environment !== 'development') {
    if (parsed.protocol !== 'https:') {
      throw new Error(
        `EXPO_PUBLIC_API_URL must use HTTPS for ${environment} mobile builds.`,
      );
    }

    if (isDevelopmentHost(parsed.hostname)) {
      throw new Error(
        `EXPO_PUBLIC_API_URL must not point to a local or private network host for ${environment} mobile builds.`,
      );
    }
  }

  const withoutTrailingSlash = rawApiBaseUrl.replace(/\/+$/, '');
  if (!/\/api$/i.test(withoutTrailingSlash)) {
    throw new Error('EXPO_PUBLIC_API_URL must include the /api base path.');
  }

  return withoutTrailingSlash;
}

function isDevelopmentHost(hostname: string) {
  const host = hostname.trim().toLowerCase();
  if (LOCAL_HOSTS.has(host) || host.endsWith('.local')) {
    return true;
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;

  const octets = ipv4.slice(1).map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet > 255)) {
    return true;
  }

  const [first = 0, second = 0] = octets;
  return (
    first === 10 ||
    first === 127 ||
    first === 0 ||
    first === 169 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}
