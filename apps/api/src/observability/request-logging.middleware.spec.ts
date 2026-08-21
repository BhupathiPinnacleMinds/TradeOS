import type { NextFunction, Response } from 'express';
import { createRequestLoggingMiddleware } from './request-logging.middleware';
import {
  REQUEST_ID_HEADER,
  type ObservabilityRequest,
} from './request-context';
import type { StructuredLogger } from './structured-logger';

describe('request logging middleware', () => {
  it('generates a request ID and returns it in the response header', () => {
    const logger = loggerMock();
    const request = requestMock({});
    const { response, setHeader } = responseMock();
    const next = jest.fn() as NextFunction;

    createRequestLoggingMiddleware(logger)(request, response, next);

    expect(request.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      request.requestId,
    );
    expect(next).toHaveBeenCalled();
  });

  it('keeps safe incoming request IDs', () => {
    const request = requestMock({ 'x-request-id': 'client-req-1234' });
    const { response, setHeader } = responseMock();

    createRequestLoggingMiddleware(loggerMock())(
      request,
      response,
      jest.fn() as NextFunction,
    );

    expect(request.requestId).toBe('client-req-1234');
    expect(setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      'client-req-1234',
    );
  });

  it('replaces invalid or oversized incoming request IDs', () => {
    const request = requestMock({ 'x-request-id': 'x'.repeat(200) });
    const { response } = responseMock();

    createRequestLoggingMiddleware(loggerMock())(
      request,
      response,
      jest.fn() as NextFunction,
    );

    expect(request.requestId).not.toBe('x'.repeat(200));
    expect(request.requestId).toBeDefined();
  });
});

function requestMock(headers: Record<string, string>) {
  return {
    baseUrl: '/api',
    headers,
    method: 'GET',
    path: '/health',
  } as ObservabilityRequest;
}

function responseMock() {
  const on = jest.fn();
  const setHeader = jest.fn();
  return {
    response: {
      on,
      setHeader,
      statusCode: 200,
    } as unknown as Response,
    setHeader,
  };
}

function loggerMock() {
  return {
    info: jest.fn(),
  } as unknown as StructuredLogger;
}
