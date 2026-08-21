import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

describe('mobile idempotency contract', () => {
  const repoRoot = resolve(__dirname, '..', '..', '..', '..');

  function mobileSource(path: string) {
    return readFileSync(join(repoRoot, 'apps', 'mobile', 'src', path), 'utf8');
  }

  it('generates idempotency keys for high-risk mobile mutations', () => {
    const client = mobileSource('api/client.ts');

    expect(client).toContain('createIdempotencyKey');
    expect(client).toContain("'Idempotency-Key'");
    expect(client).toContain("'quote-create'");
    expect(client).toContain("'invoice-create'");
    expect(client).toContain("'invoice-record-payment'");
    expect(client).toContain("'appointment-create'");
    expect(client).toContain('`appointment-transition-${action}`');
    expect(client).toContain('`tori-confirm-${draftId}`');
    expect(client).toContain("'public-quote-accept'");
    expect(client).toContain("'public-quote-decline'");
    expect(client).toContain("'communications-manual'");
    expect(client).toContain('defaultIdempotencyKey');
    expect(client).toContain('activeIdempotencyKeys');
  });
});
