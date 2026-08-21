import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';
import type { ErrorMonitoringService } from './error-monitoring';
import type { StructuredLogger } from './structured-logger';

describe('GlobalExceptionFilter', () => {
  it('returns expected 4xx responses without reporting to monitoring', () => {
    const { captureUnexpected, filter, json, loggerError, response, status } =
      setup();

    filter.catch(
      new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: ['name must be a string'],
      }),
      host(response),
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      code: 'VALIDATION_ERROR',
      message: ['name must be a string'],
      requestId: 'req-123456',
    });
    expect(loggerError).not.toHaveBeenCalled();
    expect(captureUnexpected).not.toHaveBeenCalled();
  });

  it('returns safe 500 responses and reports unexpected errors', () => {
    const { captureUnexpected, filter, json, loggerError, response, status } =
      setup();

    filter.catch(
      new Error('PrismaClientKnownRequestError: DATABASE_URL password leaked'),
      host(response),
    );

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong. Please try again.',
      requestId: 'req-123456',
    });
    expect(JSON.stringify(json.mock.calls)).not.toContain('Prisma');
    expect(JSON.stringify(json.mock.calls)).not.toContain('DATABASE_URL');
    expect(loggerError).toHaveBeenCalledWith(
      'request_failed',
      expect.objectContaining({
        requestId: 'req-123456',
        statusCode: 500,
      }),
    );
    expect(captureUnexpected).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-123456',
        statusCode: 500,
      }),
    );
  });
});

function setup() {
  const loggerError = jest.fn();
  const captureUnexpected = jest.fn();
  const logger = { error: loggerError } as unknown as StructuredLogger;
  const monitoring = {
    captureUnexpected,
  } as unknown as ErrorMonitoringService;
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const response = {
    json,
    status,
  };
  return {
    captureUnexpected,
    filter: new GlobalExceptionFilter(logger, monitoring),
    json,
    loggerError,
    response,
    status,
  };
}

function host(response: { json: jest.Mock; status: jest.Mock }): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'GET',
        path: '/api/fail',
        requestId: 'req-123456',
        user: { businessId: 'business-1', id: 'user-1' },
      }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
}
