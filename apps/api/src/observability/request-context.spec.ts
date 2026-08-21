import { isValidRequestId, requestIdFrom } from './request-context';

describe('request context', () => {
  it('accepts safe incoming request IDs', () => {
    expect(isValidRequestId('req-1234_ABC.def:5678')).toBe(true);
    expect(
      requestIdFrom({
        headers: { 'x-request-id': 'req-1234_ABC.def:5678' },
      } as never),
    ).toBe('req-1234_ABC.def:5678');
  });

  it('rejects invalid or oversized request IDs', () => {
    expect(isValidRequestId('short')).toBe(false);
    expect(isValidRequestId('x'.repeat(81))).toBe(false);
    expect(isValidRequestId('bad request id')).toBe(false);
    expect(
      requestIdFrom({
        headers: { 'x-request-id': 'bad request id' },
      } as never),
    ).toBeUndefined();
  });
});
