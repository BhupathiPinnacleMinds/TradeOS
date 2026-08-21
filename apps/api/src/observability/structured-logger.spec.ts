import { ConfigService } from '@nestjs/config';
import { redact, StructuredLogger } from './structured-logger';

describe('StructuredLogger', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('emits JSON-compatible logs without leaking Authorization headers or secrets', () => {
    const spy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const logger = new StructuredLogger(
      config({ LOG_FORMAT: 'json', LOG_LEVEL: 'debug' }),
    );

    logger.info('safe_event', {
      Authorization: 'Bearer jwt-secret-token',
      DATABASE_URL: 'postgresql://user:password@example/db',
      JWT_SECRET: 'super-secret',
      category: 'test',
      requestId: 'request-123',
    });

    const line = spy.mock.calls[0]?.[0] as string;
    expect(line).toContain('"message":"safe_event"');
    expect(line).toContain('[redacted]');
    expect(line).not.toContain('jwt-secret-token');
    expect(line).not.toContain('postgresql://user:password@example/db');
    expect(line).not.toContain('super-secret');
  });

  it('redacts public tokens, payload hashes, communication bodies and Tori conversations', () => {
    expect(
      redact({
        communicationBody: 'Full SMS body',
        conversation: 'Customer said their address is 1 Secret Street',
        publicToken: 'raw-public-token',
        publicTokenHash: 'hash-value',
        requestHash: 'request-hash',
      }),
    ).toEqual({
      communicationBody: '[redacted]',
      conversation: '[redacted]',
      publicToken: '[redacted]',
      publicTokenHash: '[redacted]',
      requestHash: '[redacted]',
    });
  });
});

function config(values: Record<string, string>) {
  return {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  } as unknown as ConfigService;
}
