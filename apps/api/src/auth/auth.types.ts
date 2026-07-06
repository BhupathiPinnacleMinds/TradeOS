import type { AuthenticatedUser } from '@tradieos/shared';
import type { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

export interface JwtPayload {
  sub: string;
  businessId: string;
}
