import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_POLICY_KEY = 'rateLimitPolicy';
export const SKIP_RATE_LIMIT_KEY = 'skipRateLimit';

export type RateLimitPolicyName =
  | 'global'
  | 'auth'
  | 'publicRead'
  | 'publicMutation'
  | 'toriChat'
  | 'toriAction'
  | 'media'
  | 'internal';

export const RateLimitPolicy = (policy: RateLimitPolicyName) =>
  SetMetadata(RATE_LIMIT_POLICY_KEY, policy);

export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT_KEY, true);
