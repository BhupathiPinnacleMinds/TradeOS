import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { ErrorMonitoringService } from './error-monitoring';
import type { ObservabilityRequest } from './request-context';
import { StructuredLogger, safeErrorCode } from './structured-logger';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: StructuredLogger,
    private readonly monitoring: ErrorMonitoringService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<ObservabilityRequest>();
    const response = http.getResponse<Response>();
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const requestId = request.requestId;
    const body =
      exception instanceof HttpException
        ? this.expectedBody(exception, requestId)
        : {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Something went wrong. Please try again.',
            requestId,
          };

    if (statusCode >= 500) {
      this.logger.error('request_failed', {
        businessId: request.user?.businessId,
        category: 'http',
        errorCode: this.errorCode(exception),
        event: 'request_failed',
        method: request.method,
        requestId,
        route: request.path,
        statusCode,
        userId: request.user?.id,
      });
      this.monitoring.captureUnexpected({
        businessId: request.user?.businessId,
        category: 'http',
        error: exception,
        errorCode: this.errorCode(exception),
        requestId,
        route: request.path,
        statusCode,
        userId: request.user?.id,
      });
    }

    response.status(statusCode).json(body);
  }

  private expectedBody(exception: HttpException, requestId?: string) {
    const response = exception.getResponse();
    if (typeof response === 'string') {
      return {
        code: this.statusCode(exception.getStatus()),
        message: response,
        requestId,
      };
    }
    if (typeof response === 'object' && response !== null) {
      return {
        ...response,
        requestId,
      };
    }
    return {
      code: this.statusCode(exception.getStatus()),
      message: 'Request failed.',
      requestId,
    };
  }

  private statusCode(statusCode: number) {
    if (statusCode === 400) return 'VALIDATION_ERROR';
    if (statusCode === 401) return 'UNAUTHENTICATED';
    if (statusCode === 403) return 'FORBIDDEN';
    if (statusCode === 404) return 'NOT_FOUND';
    if (statusCode === 409) return 'CONFLICT';
    if (statusCode === 429) return 'RATE_LIMIT_EXCEEDED';
    return `HTTP_${statusCode}`;
  }

  private errorCode(exception: unknown) {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (
        typeof response === 'object' &&
        response !== null &&
        'code' in response &&
        typeof response.code === 'string'
      ) {
        return response.code;
      }
    }
    return safeErrorCode(exception);
  }
}
