import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '@tradieos/shared';
import {
  RATE_LIMIT_POLICY_KEY,
  type RateLimitPolicyName,
  SKIP_RATE_LIMIT_KEY,
} from './rate-limit.decorator';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

interface RateLimitPolicyConfig {
  limit: number;
  windowSeconds: number;
}

interface RateLimitedRequest extends Request {
  user?: AuthenticatedUser;
}

interface RouteWithPath {
  path?: unknown;
}

const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_GLOBAL_LIMIT = 120;
const POLICY_DEFAULT_LIMITS: Record<RateLimitPolicyName, number> = {
  auth: 10,
  global: DEFAULT_GLOBAL_LIMIT,
  internal: 10,
  media: 120,
  publicMutation: 10,
  publicRead: 60,
  toriAction: 20,
  toriChat: 60,
};

const POLICY_ENV_KEYS: Record<RateLimitPolicyName, string> = {
  auth: 'RATE_LIMIT_AUTH_MAX_REQUESTS',
  global: 'RATE_LIMIT_MAX_REQUESTS',
  internal: 'RATE_LIMIT_INTERNAL_MAX_REQUESTS',
  media: 'RATE_LIMIT_MEDIA_MAX_REQUESTS',
  publicMutation: 'RATE_LIMIT_PUBLIC_MUTATION_MAX_REQUESTS',
  publicRead: 'RATE_LIMIT_PUBLIC_READ_MAX_REQUESTS',
  toriAction: 'RATE_LIMIT_TORI_ACTION_MAX_REQUESTS',
  toriChat: 'RATE_LIMIT_TORI_CHAT_MAX_REQUESTS',
};

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.isEnabled()) {
      return true;
    }

    const skipRateLimit = this.reflector.getAllAndOverride<boolean>(
      SKIP_RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (skipRateLimit) {
      return true;
    }

    const policyName =
      this.reflector.getAllAndOverride<RateLimitPolicyName>(
        RATE_LIMIT_POLICY_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? 'global';
    const policy = this.policyConfig(policyName);
    const now = Date.now();
    const key = this.bucketKey(context, policyName);
    const existing = this.buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, {
        count: 1,
        resetAt: now + policy.windowSeconds * 1000,
      });
      this.pruneExpiredBuckets(now);
      return true;
    }

    if (existing.count >= policy.limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((existing.resetAt - now) / 1000),
      );
      const response = context.switchToHttp().getResponse<Response>();
      response.setHeader('Retry-After', String(retryAfterSeconds));
      this.logger.warn(
        `Rate limit exceeded policy=${policyName} route=${this.safeRouteLabel(
          context,
        )} identity=${this.safeIdentityHash(key)} retryAfterSeconds=${retryAfterSeconds}`,
      );
      throw new HttpException(
        {
          code: 'RATE_LIMIT_EXCEEDED',
          details: { retryAfterSeconds },
          message: 'Too many requests. Please try again shortly.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    existing.count += 1;
    return true;
  }

  private isEnabled() {
    return this.config.get<string>('RATE_LIMIT_ENABLED', 'true') !== 'false';
  }

  private policyConfig(policyName: RateLimitPolicyName): RateLimitPolicyConfig {
    return {
      limit: this.positiveInteger(
        POLICY_ENV_KEYS[policyName],
        POLICY_DEFAULT_LIMITS[policyName],
      ),
      windowSeconds: this.positiveInteger(
        'RATE_LIMIT_WINDOW_SECONDS',
        DEFAULT_WINDOW_SECONDS,
      ),
    };
  }

  private positiveInteger(key: string, fallback: number) {
    const raw = this.config.get<string | number>(key);
    const parsed = Number(raw ?? fallback);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private bucketKey(
    context: ExecutionContext,
    policyName: RateLimitPolicyName,
  ) {
    const request = context.switchToHttp().getRequest<RateLimitedRequest>();
    const route = this.safeRouteLabel(context);
    const identity = this.identity(request, policyName);
    return `${policyName}:${route}:${identity}`;
  }

  private identity(
    request: RateLimitedRequest,
    policyName: RateLimitPolicyName,
  ) {
    if (request.user?.businessId && request.user.id) {
      return `user:${request.user.businessId}:${request.user.id}`;
    }

    if (policyName === 'auth') {
      const accountHint = this.normalizedAuthAccountHint(request);
      if (accountHint) {
        return `ip-account:${this.clientIp(request)}:${this.sha256(
          accountHint,
        )}`;
      }
    }

    return `ip:${this.clientIp(request)}`;
  }

  private normalizedAuthAccountHint(request: RateLimitedRequest) {
    const body = request.body as { email?: unknown } | undefined;
    return typeof body?.email === 'string' && body.email.trim()
      ? body.email.trim().toLowerCase()
      : undefined;
  }

  private clientIp(request: RateLimitedRequest) {
    if (this.trustProxy()) {
      const forwardedFor = request.headers['x-forwarded-for'];
      const forwardedIp = Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor?.split(',')[0];
      if (forwardedIp?.trim()) {
        return forwardedIp.trim();
      }
    }

    return (
      request.socket?.remoteAddress ??
      request.ip ??
      request.connection?.remoteAddress ??
      'unknown'
    );
  }

  private trustProxy() {
    return this.config.get<string>('TRUST_PROXY', 'false') === 'true';
  }

  private safeRouteLabel(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method ?? 'UNKNOWN';
    const route = request.route as RouteWithPath | undefined;
    const routePath =
      route && typeof route.path === 'string'
        ? route.path
        : context.getHandler().name || 'unknown';
    return `${method}:${routePath}`;
  }

  private pruneExpiredBuckets(now: number) {
    if (this.buckets.size < 5000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }

  private safeIdentityHash(value: string) {
    return this.sha256(value).slice(0, 16);
  }

  private sha256(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
}
