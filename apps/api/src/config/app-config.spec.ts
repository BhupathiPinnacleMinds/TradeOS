import { validateEnvironment } from './app-config';

describe('validateEnvironment', () => {
  it('allows local development defaults', () => {
    expect(
      validateEnvironment({
        NODE_ENV: 'development',
        JWT_SECRET: 'replace-with-at-least-32-random-characters',
      }),
    ).toMatchObject({ NODE_ENV: 'development' });
  });

  it('rejects unsafe production defaults', () => {
    expect(() =>
      validateEnvironment({
        APP_PUBLIC_URL: 'http://localhost:8081',
        CORS_ORIGINS: 'http://localhost:8081',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/tradieos',
        EMAIL_PROVIDER: 'console',
        JWT_SECRET: 'replace-with-at-least-32-random-characters',
        NODE_ENV: 'production',
      }),
    ).toThrow(/Invalid TradieOS production configuration/);
  });

  it('allows a complete production configuration without exposing secrets', () => {
    expect(
      validateEnvironment({
        APP_PUBLIC_URL: 'https://app.tradieos.example',
        CORS_ORIGINS: 'https://app.tradieos.example',
        DATABASE_URL: 'postgresql://prod-host/tradieos',
        EMAIL_FROM_ADDRESS: 'hello@tradieos.example',
        EMAIL_PROVIDER: 'resend',
        JWT_SECRET: 'production-secret-value-with-at-least-32-chars',
        NODE_ENV: 'production',
        RESEND_API_KEY: 're_test_key',
        S3_ACCESS_KEY_ID: 'access-key',
        S3_BUCKET: 'tradieos-prod',
        S3_REGION: 'ap-southeast-2',
        S3_SECRET_ACCESS_KEY: 'secret-key',
        STORAGE_PROVIDER: 's3',
        CUSTOMER_EMAIL_PROVIDER: 'resend',
        CUSTOMER_COMMUNICATION_WORKER_BATCH_SIZE: '50',
        CUSTOMER_COMMUNICATION_WORKER_ENABLED: 'true',
        CUSTOMER_COMMUNICATION_WORKER_INTERVAL_SECONDS: '300',
        CUSTOMER_SMS_PROVIDER: 'twilio',
        TWILIO_ACCOUNT_SID: 'AC123456789',
        TWILIO_AUTH_TOKEN: 'twilio-secret',
        TWILIO_MESSAGING_FROM: '+61400000000',
      }),
    ).toMatchObject({ NODE_ENV: 'production' });
  });

  it('requires an OpenAI key only when the OpenAI provider is selected', () => {
    expect(() =>
      validateEnvironment({
        AI_PROVIDER: 'openai',
        APP_PUBLIC_URL: 'https://app.tradieos.example',
        CORS_ORIGINS: 'https://app.tradieos.example',
        DATABASE_URL: 'postgresql://prod-host/tradieos',
        EMAIL_FROM_ADDRESS: 'hello@tradieos.example',
        EMAIL_PROVIDER: 'resend',
        JWT_SECRET: 'production-secret-value-with-at-least-32-chars',
        NODE_ENV: 'production',
        RESEND_API_KEY: 're_test_key',
        S3_ACCESS_KEY_ID: 'access-key',
        S3_BUCKET: 'tradieos-prod',
        S3_REGION: 'ap-southeast-2',
        S3_SECRET_ACCESS_KEY: 'secret-key',
        STORAGE_PROVIDER: 's3',
        CUSTOMER_EMAIL_PROVIDER: 'resend',
        CUSTOMER_COMMUNICATION_WORKER_ENABLED: 'true',
        CUSTOMER_SMS_PROVIDER: 'twilio',
        TWILIO_ACCOUNT_SID: 'AC123456789',
        TWILIO_AUTH_TOKEN: 'twilio-secret',
        TWILIO_MESSAGING_FROM: '+61400000000',
      }),
    ).toThrow(/OPENAI_API_KEY/);
  });

  it('requires durable S3-compatible storage in production', () => {
    expect(() =>
      validateEnvironment({
        APP_PUBLIC_URL: 'https://app.tradieos.example',
        CORS_ORIGINS: 'https://app.tradieos.example',
        DATABASE_URL: 'postgresql://prod-host/tradieos',
        EMAIL_FROM_ADDRESS: 'hello@tradieos.example',
        EMAIL_PROVIDER: 'resend',
        JWT_SECRET: 'production-secret-value-with-at-least-32-chars',
        NODE_ENV: 'production',
        RESEND_API_KEY: 're_test_key',
        STORAGE_PROVIDER: 'local',
      }),
    ).toThrow(/STORAGE_PROVIDER must be s3/);
  });

  it('requires real customer email and SMS providers in production', () => {
    expect(() =>
      validateEnvironment({
        APP_PUBLIC_URL: 'https://app.tradieos.example',
        CORS_ORIGINS: 'https://app.tradieos.example',
        DATABASE_URL: 'postgresql://prod-host/tradieos',
        EMAIL_FROM_ADDRESS: 'hello@tradieos.example',
        EMAIL_PROVIDER: 'resend',
        JWT_SECRET: 'production-secret-value-with-at-least-32-chars',
        NODE_ENV: 'production',
        RESEND_API_KEY: 're_test_key',
        S3_ACCESS_KEY_ID: 'access-key',
        S3_BUCKET: 'tradieos-prod',
        S3_REGION: 'ap-southeast-2',
        S3_SECRET_ACCESS_KEY: 'secret-key',
        STORAGE_PROVIDER: 's3',
      }),
    ).toThrow(/CUSTOMER_EMAIL_PROVIDER/);
  });

  it('requires the customer communication worker in production', () => {
    expect(() =>
      validateEnvironment({
        APP_PUBLIC_URL: 'https://app.tradieos.example',
        CORS_ORIGINS: 'https://app.tradieos.example',
        CUSTOMER_EMAIL_PROVIDER: 'resend',
        CUSTOMER_SMS_PROVIDER: 'twilio',
        DATABASE_URL: 'postgresql://prod-host/tradieos',
        EMAIL_FROM_ADDRESS: 'hello@tradieos.example',
        EMAIL_PROVIDER: 'resend',
        JWT_SECRET: 'production-secret-value-with-at-least-32-chars',
        NODE_ENV: 'production',
        RESEND_API_KEY: 're_test_key',
        S3_ACCESS_KEY_ID: 'access-key',
        S3_BUCKET: 'tradieos-prod',
        S3_REGION: 'ap-southeast-2',
        S3_SECRET_ACCESS_KEY: 'secret-key',
        STORAGE_PROVIDER: 's3',
        TWILIO_ACCOUNT_SID: 'AC123456789',
        TWILIO_AUTH_TOKEN: 'twilio-secret',
        TWILIO_MESSAGING_FROM: '+61400000000',
      }),
    ).toThrow(/CUSTOMER_COMMUNICATION_WORKER_ENABLED/);
  });

  it('rejects unsafe customer communication worker cadence in production', () => {
    expect(() =>
      validateEnvironment({
        APP_PUBLIC_URL: 'https://app.tradieos.example',
        CORS_ORIGINS: 'https://app.tradieos.example',
        CUSTOMER_COMMUNICATION_WORKER_BATCH_SIZE: '500',
        CUSTOMER_COMMUNICATION_WORKER_ENABLED: 'true',
        CUSTOMER_COMMUNICATION_WORKER_INTERVAL_SECONDS: '5',
        CUSTOMER_EMAIL_PROVIDER: 'resend',
        CUSTOMER_SMS_PROVIDER: 'twilio',
        DATABASE_URL: 'postgresql://prod-host/tradieos',
        EMAIL_FROM_ADDRESS: 'hello@tradieos.example',
        EMAIL_PROVIDER: 'resend',
        JWT_SECRET: 'production-secret-value-with-at-least-32-chars',
        NODE_ENV: 'production',
        RESEND_API_KEY: 're_test_key',
        S3_ACCESS_KEY_ID: 'access-key',
        S3_BUCKET: 'tradieos-prod',
        S3_REGION: 'ap-southeast-2',
        S3_SECRET_ACCESS_KEY: 'secret-key',
        STORAGE_PROVIDER: 's3',
        TWILIO_ACCOUNT_SID: 'AC123456789',
        TWILIO_AUTH_TOKEN: 'twilio-secret',
        TWILIO_MESSAGING_FROM: '+61400000000',
      }),
    ).toThrow(/CUSTOMER_COMMUNICATION_WORKER_INTERVAL_SECONDS/);
  });
});
