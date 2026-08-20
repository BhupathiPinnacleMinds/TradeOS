const LOCAL_HOST_PATTERN = /\b(localhost|127\.0\.0\.1|0\.0\.0\.0)\b/i;
const PLACEHOLDER_SECRET_PATTERN =
  /^(change-me|changeme|secret|test-secret|replace-with|replace-me)/i;

export function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const nodeEnv = stringValue(config.NODE_ENV) ?? 'development';

  if (nodeEnv !== 'production') {
    return config;
  }

  const failures: string[] = [];
  const jwtSecret = requiredString(config, 'JWT_SECRET', failures);
  requiredString(config, 'DATABASE_URL', failures);
  const corsOrigins = requiredString(config, 'CORS_ORIGINS', failures);
  const appPublicUrl =
    stringValue(config.APP_PUBLIC_URL) ?? stringValue(config.PUBLIC_APP_URL);
  const emailProvider = stringValue(config.EMAIL_PROVIDER) ?? 'console';
  const aiProvider = stringValue(config.AI_PROVIDER) ?? 'local';
  const storageProvider = stringValue(config.STORAGE_PROVIDER) ?? 'local';
  const customerCommunicationsEnabled =
    stringValue(config.CUSTOMER_COMMUNICATIONS_ENABLED) !== 'false';
  const customerEmailProvider =
    stringValue(config.CUSTOMER_EMAIL_PROVIDER) ?? 'local';
  const customerSmsProvider =
    stringValue(config.CUSTOMER_SMS_PROVIDER) ?? 'local';
  const customerCommunicationWorkerEnabled = stringValue(
    config.CUSTOMER_COMMUNICATION_WORKER_ENABLED,
  );
  const customerCommunicationWorkerInterval = optionalInteger(
    config.CUSTOMER_COMMUNICATION_WORKER_INTERVAL_SECONDS,
  );
  const customerCommunicationWorkerBatchSize = optionalInteger(
    config.CUSTOMER_COMMUNICATION_WORKER_BATCH_SIZE,
  );

  if (!appPublicUrl) {
    failures.push('APP_PUBLIC_URL is required in production.');
  }

  if (
    jwtSecret &&
    (jwtSecret.length < 32 || PLACEHOLDER_SECRET_PATTERN.test(jwtSecret))
  ) {
    failures.push(
      'JWT_SECRET must be at least 32 characters and must not be a placeholder in production.',
    );
  }

  if (corsOrigins && containsLocalhost(corsOrigins)) {
    failures.push(
      'CORS_ORIGINS must not include localhost, 127.0.0.1 or 0.0.0.0 in production.',
    );
  }

  if (appPublicUrl && isUnsafeProductionUrl(appPublicUrl)) {
    failures.push(
      'APP_PUBLIC_URL/PUBLIC_APP_URL must be an HTTPS public URL in production.',
    );
  }

  if (emailProvider !== 'resend') {
    failures.push('EMAIL_PROVIDER must be resend in production.');
  } else {
    requiredString(config, 'RESEND_API_KEY', failures);
    requiredString(config, 'EMAIL_FROM_ADDRESS', failures);
  }

  if (aiProvider === 'openai') {
    requiredString(config, 'OPENAI_API_KEY', failures);
  }

  if (storageProvider !== 's3') {
    failures.push('STORAGE_PROVIDER must be s3 in production.');
  } else {
    requiredString(config, 'S3_BUCKET', failures);
    requiredString(config, 'S3_REGION', failures);
    requiredString(config, 'S3_ACCESS_KEY_ID', failures);
    requiredString(config, 'S3_SECRET_ACCESS_KEY', failures);
  }

  if (customerCommunicationsEnabled) {
    if (customerCommunicationWorkerEnabled !== 'true') {
      failures.push(
        'CUSTOMER_COMMUNICATION_WORKER_ENABLED must be true in production when customer communications are enabled.',
      );
    }

    if (
      customerCommunicationWorkerInterval !== undefined &&
      (!Number.isInteger(customerCommunicationWorkerInterval) ||
        customerCommunicationWorkerInterval < 60)
    ) {
      failures.push(
        'CUSTOMER_COMMUNICATION_WORKER_INTERVAL_SECONDS must be at least 60 in production.',
      );
    }

    if (
      customerCommunicationWorkerBatchSize !== undefined &&
      (!Number.isInteger(customerCommunicationWorkerBatchSize) ||
        customerCommunicationWorkerBatchSize < 1 ||
        customerCommunicationWorkerBatchSize > 250)
    ) {
      failures.push(
        'CUSTOMER_COMMUNICATION_WORKER_BATCH_SIZE must be between 1 and 250 in production.',
      );
    }

    if (customerEmailProvider !== 'resend') {
      failures.push(
        'CUSTOMER_EMAIL_PROVIDER must be resend in production when customer communications are enabled.',
      );
    } else {
      requiredString(config, 'RESEND_API_KEY', failures);
      requiredString(config, 'EMAIL_FROM_ADDRESS', failures);
    }

    if (customerSmsProvider !== 'twilio') {
      failures.push(
        'CUSTOMER_SMS_PROVIDER must be twilio in production when customer communications are enabled.',
      );
    } else {
      requiredString(config, 'TWILIO_ACCOUNT_SID', failures);
      requiredString(config, 'TWILIO_AUTH_TOKEN', failures);
      requiredString(config, 'TWILIO_MESSAGING_FROM', failures);
    }
  }

  if (failures.length) {
    throw new Error(
      `Invalid TradieOS production configuration:\n- ${failures.join('\n- ')}`,
    );
  }

  return config;
}

function requiredString(
  config: Record<string, unknown>,
  key: string,
  failures: string[],
) {
  const value = stringValue(config[key]);
  if (!value) {
    failures.push(`${key} is required in production.`);
  }
  return value;
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalInteger(value: unknown) {
  const stringified = stringValue(value);
  if (!stringified) return undefined;
  const parsed = Number(stringified);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function containsLocalhost(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .some((item) => LOCAL_HOST_PATTERN.test(item));
}

function isUnsafeProductionUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol !== 'https:' || LOCAL_HOST_PATTERN.test(url.hostname);
  } catch {
    return true;
  }
}
