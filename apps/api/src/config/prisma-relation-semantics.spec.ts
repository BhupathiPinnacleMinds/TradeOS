import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Prisma relation deletion semantics', () => {
  it('does not use SetNull on compound tenant relations with required businessId', () => {
    const schema = readFileSync(
      join(__dirname, '../../prisma/schema.prisma'),
      'utf8',
    );
    const unsafeCompoundSetNullRelations = schema
      .split(/\r?\n/)
      .filter(
        (line) =>
          line.includes('@relation') &&
          line.includes('onDelete: SetNull') &&
          line.includes('businessId'),
      );

    expect(unsafeCompoundSetNullRelations).toEqual([]);
  });
});
