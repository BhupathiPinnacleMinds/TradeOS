import type { NextFunction, Response } from 'express';
import { createRequestId, StructuredLogger } from './structured-logger';
import {
  ObservabilityRequest,
  REQUEST_ID_HEADER,
  requestIdFrom,
} from './request-context';

export function createRequestLoggingMiddleware(logger: StructuredLogger) {
  return (
    request: ObservabilityRequest,
    response: Response,
    next: NextFunction,
  ) => {
    const startedAt = Date.now();
    const requestId = requestIdFrom(request) ?? createRequestId();
    request.requestId = requestId;
    response.setHeader(REQUEST_ID_HEADER, requestId);

    response.on('finish', () => {
      const route = routeLabel(request);
      const statusCode = response.statusCode;
      logger.info('http_request_completed', {
        businessId: request.user?.businessId,
        category: 'http',
        durationMs: Date.now() - startedAt,
        event: 'http_request_completed',
        method: request.method,
        requestId,
        route,
        statusCode,
        userId: request.user?.id,
      });
    });

    next();
  };
}

function routeLabel(request: ObservabilityRequest) {
  const route = request.route as { path?: unknown } | undefined;
  const routePath = typeof route?.path === 'string' ? route.path : request.path;
  return `${request.baseUrl ?? ''}${routePath}`;
}
