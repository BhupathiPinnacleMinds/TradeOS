import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import {
  RATE_LIMIT_POLICY_KEY,
  type RateLimitPolicyName,
  SKIP_RATE_LIMIT_KEY,
} from './rate-limit.decorator';
import { RateLimitGuard } from './rate-limit.guard';

describe('RateLimitGuard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-21T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows normal global traffic and returns 429 after the configured limit', () => {
    const guard = createGuard({ RATE_LIMIT_MAX_REQUESTS: '2' });

    expect(guard.canActivate(contextFor())).toBe(true);
    expect(guard.canActivate(contextFor())).toBe(true);
    expect(() => guard.canActivate(contextFor())).toThrow(HttpException);
  });

  it('resets the window after the configured retry period', () => {
    const guard = createGuard({
      RATE_LIMIT_MAX_REQUESTS: '1',
      RATE_LIMIT_WINDOW_SECONDS: '60',
    });

    expect(guard.canActivate(contextFor())).toBe(true);
    expect(() => guard.canActivate(contextFor())).toThrow(HttpException);

    jest.setSystemTime(new Date('2026-08-21T00:01:01.000Z'));
    expect(guard.canActivate(contextFor())).toBe(true);
  });

  it('uses a stricter auth policy than the global baseline', () => {
    const guard = createGuard({
      RATE_LIMIT_AUTH_MAX_REQUESTS: '1',
      RATE_LIMIT_MAX_REQUESTS: '100',
    });

    expect(guard.canActivate(contextFor({ policy: 'auth' }))).toBe(true);
    expectRateLimit(() => guard.canActivate(contextFor({ policy: 'auth' })));
  });

  it('throttles public quote and invoice token reads without exposing tokens in the key', () => {
    const guard = createGuard({
      RATE_LIMIT_PUBLIC_READ_MAX_REQUESTS: '1',
    });

    expect(
      guard.canActivate(contextFor({ policy: 'publicRead', route: '/:token' })),
    ).toBe(true);
    expectRateLimit(() =>
      guard.canActivate(contextFor({ policy: 'publicRead', route: '/:token' })),
    );
  });

  it('applies stricter public mutation policies for accept or decline actions', () => {
    const guard = createGuard({
      RATE_LIMIT_PUBLIC_MUTATION_MAX_REQUESTS: '1',
      RATE_LIMIT_PUBLIC_READ_MAX_REQUESTS: '100',
    });

    expect(
      guard.canActivate(
        contextFor({ policy: 'publicMutation', route: '/:token/accept' }),
      ),
    ).toBe(true);
    expectRateLimit(() =>
      guard.canActivate(
        contextFor({ policy: 'publicMutation', route: '/:token/accept' }),
      ),
    );
  });

  it('throttles flooded Tori chat while preserving the normal request path', () => {
    const guard = createGuard({
      RATE_LIMIT_TORI_CHAT_MAX_REQUESTS: '1',
    });

    expect(
      guard.canActivate(
        contextFor({
          policy: 'toriChat',
          route: '/chat',
          user: { businessId: 'business-a', id: 'user-a' },
        }),
      ),
    ).toBe(true);
    expectRateLimit(() =>
      guard.canActivate(
        contextFor({
          policy: 'toriChat',
          route: '/chat',
          user: { businessId: 'business-a', id: 'user-a' },
        }),
      ),
    );
  });

  it('isolates authenticated limiter state by business and user', () => {
    const guard = createGuard({
      RATE_LIMIT_TORI_ACTION_MAX_REQUESTS: '1',
    });

    expect(
      guard.canActivate(
        contextFor({
          policy: 'toriAction',
          route: '/actions/:draftId/confirm',
          user: { businessId: 'business-a', id: 'user-a' },
        }),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        contextFor({
          policy: 'toriAction',
          route: '/actions/:draftId/confirm',
          user: { businessId: 'business-b', id: 'user-a' },
        }),
      ),
    ).toBe(true);
  });

  it('does not allow spoofed forwarded headers to bypass limits when trust proxy is disabled', () => {
    const guard = createGuard({ RATE_LIMIT_MAX_REQUESTS: '1' });

    expect(
      guard.canActivate(
        contextFor({
          headers: { 'x-forwarded-for': '203.0.113.1' },
          remoteAddress: '10.0.0.5',
        }),
      ),
    ).toBe(true);
    expectRateLimit(() =>
      guard.canActivate(
        contextFor({
          headers: { 'x-forwarded-for': '203.0.113.2' },
          remoteAddress: '10.0.0.5',
        }),
      ),
    );
  });

  it('uses the trusted forwarded IP only when trust proxy is explicitly enabled', () => {
    const guard = createGuard({
      RATE_LIMIT_MAX_REQUESTS: '1',
      TRUST_PROXY: 'true',
    });

    expect(
      guard.canActivate(
        contextFor({
          headers: { 'x-forwarded-for': '203.0.113.1' },
          remoteAddress: '10.0.0.5',
        }),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        contextFor({
          headers: { 'x-forwarded-for': '203.0.113.2' },
          remoteAddress: '10.0.0.5',
        }),
      ),
    ).toBe(true);
  });

  it('keeps health checks exempt from request buckets', () => {
    const guard = createGuard({ RATE_LIMIT_MAX_REQUESTS: '1' });

    expect(guard.canActivate(contextFor({ skip: true }))).toBe(true);
    expect(guard.canActivate(contextFor({ skip: true }))).toBe(true);
  });

  it('returns a structured 429 payload with Retry-After', () => {
    const guard = createGuard({
      RATE_LIMIT_MAX_REQUESTS: '1',
      RATE_LIMIT_WINDOW_SECONDS: '60',
    });
    const response = { setHeader: jest.fn() };

    expect(guard.canActivate(contextFor({ response }))).toBe(true);

    try {
      guard.canActivate(contextFor({ response }));
      throw new Error('expected request to be throttled');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'RATE_LIMIT_EXCEEDED',
        details: { retryAfterSeconds: 60 },
        message: 'Too many requests. Please try again shortly.',
      });
      expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '60');
    }
  });
});

function expectRateLimit(received: () => unknown) {
  try {
    received();
    throw new Error('expected function to throw a 429 rate-limit error');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
  }
}

function createGuard(values: Record<string, string> = {}) {
  const config = {
    get: <T = string>(key: string, fallback?: T) =>
      (values[key] as T | undefined) ?? fallback,
  } as ConfigService;

  const reflector = {
    getAllAndOverride: (key: string) => {
      const metadata = currentMetadata();
      if (key === SKIP_RATE_LIMIT_KEY) return metadata.skip;
      if (key === RATE_LIMIT_POLICY_KEY) return metadata.policy;
      return undefined;
    },
  };

  return new RateLimitGuard(config, reflector as never);
}

let metadata: {
  policy?: RateLimitPolicyName;
  skip?: boolean;
} = {};

function currentMetadata() {
  return metadata;
}

function contextFor(
  options: {
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    method?: string;
    policy?: RateLimitPolicyName;
    remoteAddress?: string;
    response?: { setHeader: jest.Mock };
    route?: string;
    skip?: boolean;
    user?: { businessId: string; id: string };
  } = {},
) {
  metadata = {
    policy: options.policy,
    skip: options.skip,
  };

  const request = {
    body: options.body ?? {},
    connection: { remoteAddress: options.remoteAddress ?? '192.0.2.10' },
    headers: options.headers ?? {},
    method: options.method ?? 'GET',
    route: { path: options.route ?? '/test' },
    socket: { remoteAddress: options.remoteAddress ?? '192.0.2.10' },
    user: options.user,
  };
  const response = options.response ?? { setHeader: jest.fn() };

  return {
    getClass: () => class TestController {},
    getHandler: () => function testHandler() {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}
