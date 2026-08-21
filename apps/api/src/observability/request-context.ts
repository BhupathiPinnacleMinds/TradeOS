import type { Request } from 'express';
import type { AuthenticatedUser } from '@tradieos/shared';

export const REQUEST_ID_HEADER = 'x-request-id';

export interface ObservabilityRequest extends Request {
  requestId?: string;
  user?: AuthenticatedUser;
}

export function requestIdFrom(request: Pick<Request, 'headers'>) {
  const incoming = request.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  return isValidRequestId(candidate) ? candidate : undefined;
}

export function isValidRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 8 &&
    value.length <= 80 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}
