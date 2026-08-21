import { ConfigService } from '@nestjs/config';
import { ErrorMonitoringService } from './error-monitoring';
import type { StructuredLogger } from './structured-logger';

describe('ErrorMonitoringService', () => {
  it('ignores expected 4xx errors', () => {
    const loggerError = jest.fn();
    const logger = loggerMock(loggerError);
    const service = new ErrorMonitoringService(config(), logger);

    service.captureUnexpected({
      error: new Error('validation failed'),
      requestId: 'req-123456',
      statusCode: 400,
    });

    expect(loggerError).not.toHaveBeenCalled();
  });

  it('captures unexpected 500 errors through the adapter seam', () => {
    const loggerError = jest.fn();
    const logger = loggerMock(loggerError);
    const service = new ErrorMonitoringService(config(), logger);

    service.captureUnexpected({
      error: new Error('provider Authorization: Bearer secret-token failed'),
      requestId: 'req-123456',
      statusCode: 500,
    });

    expect(loggerError).toHaveBeenCalledWith(
      'unexpected_error_captured',
      expect.objectContaining({
        errorCode: 'Error',
        requestId: 'req-123456',
      }),
    );
    expect(JSON.stringify(loggerError.mock.calls)).not.toContain(
      'secret-token',
    );
  });
});

function config() {
  return {
    get: jest.fn((key: string, fallback?: string) => fallback),
  } as unknown as ConfigService;
}

function loggerMock(loggerError: jest.Mock) {
  return {
    error: loggerError,
  } as unknown as jest.Mocked<StructuredLogger>;
}
