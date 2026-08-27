const baseConfig = require('./app.json');

const PRODUCTION_BUNDLE_IDENTIFIER = 'au.com.tradieos.mobile';
const STAGING_BUNDLE_IDENTIFIER = 'au.com.tradieos.mobile.staging';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

function normaliseEnvironment(value) {
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
    `Unsupported EXPO_PUBLIC_APP_ENV "${value}". Use development, staging or production.`,
  );
}

function validateApiUrl(environment, value) {
  const apiUrl = value?.trim();
  if (!apiUrl) {
    if (environment === 'development') {
      return 'http://localhost:3000/api';
    }
    throw new Error(
      `EXPO_PUBLIC_API_URL is required for ${environment} mobile builds.`,
    );
  }

  let parsed;
  try {
    parsed = new URL(apiUrl);
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

  const normalised = apiUrl.replace(/\/+$/, '');
  if (!/\/api$/i.test(normalised)) {
    throw new Error('EXPO_PUBLIC_API_URL must include the /api base path.');
  }
  return normalised;
}

function isDevelopmentHost(hostname) {
  const host = hostname.trim().toLowerCase();
  if (LOCAL_HOSTS.has(host) || host.endsWith('.local')) {
    return true;
  }

  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;

  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet > 255)) {
    return true;
  }

  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    first === 0 ||
    first === 169 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function numericVersionCode(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const environment = normaliseEnvironment(process.env.EXPO_PUBLIC_APP_ENV);
const apiUrl = validateApiUrl(environment, process.env.EXPO_PUBLIC_API_URL);
const isStaging = environment === 'staging';
const isProduction = environment === 'production';
const expo = baseConfig.expo;

module.exports = {
  expo: {
    ...expo,
    extra: {
      ...expo.extra,
      appEnvironment: environment,
      apiUrl,
      eas: {
        ...expo.extra?.eas,
        projectId: '86e42f2d-7d6b-4910-9e34-7ac51f0e4928',
      },
    },
    name: isStaging ? 'TradieOS Staging' : expo.name,
    scheme: isStaging ? 'tradieos-staging' : expo.scheme,
    ios: {
      ...expo.ios,
      buildNumber: process.env.IOS_BUILD_NUMBER ?? expo.ios?.buildNumber ?? '1',
      bundleIdentifier: isStaging
        ? STAGING_BUNDLE_IDENTIFIER
        : PRODUCTION_BUNDLE_IDENTIFIER,
    },
    android: {
      ...expo.android,
      package: isStaging
        ? STAGING_BUNDLE_IDENTIFIER
        : PRODUCTION_BUNDLE_IDENTIFIER,
      versionCode: numericVersionCode(
        process.env.ANDROID_VERSION_CODE,
        expo.android?.versionCode ?? 1,
      ),
    },
    ...(process.env.EXPO_OWNER || expo.owner
      ? { owner: process.env.EXPO_OWNER ?? expo.owner }
      : {}),
    ...(isProduction ? { runtimeVersion: { policy: 'appVersion' } } : {}),
  },
};
