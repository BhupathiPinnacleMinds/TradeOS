import { statusCodeToErrorCode } from '../../../mobile/src/api/client';

describe('mobile API error mapping', () => {
  it('keeps 429 responses mapped to the rate-limit error code', () => {
    expect(statusCodeToErrorCode(429)).toBe('RATE_LIMIT_EXCEEDED');
  });
});
