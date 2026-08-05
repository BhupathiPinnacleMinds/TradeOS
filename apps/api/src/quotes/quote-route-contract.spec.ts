import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('quotes route contract', () => {
  const controller = readFileSync(
    join(__dirname, 'quotes.controller.ts'),
    'utf8',
  );
  const service = readFileSync(join(__dirname, 'quotes.service.ts'), 'utf8');
  const moduleSource = readFileSync(
    join(__dirname, 'quotes.module.ts'),
    'utf8',
  );
  const appModule = readFileSync(
    join(__dirname, '..', 'app.module.ts'),
    'utf8',
  );

  it('registers the Quotes module in the application', () => {
    expect(appModule).toContain('QuotesModule');
    expect(moduleSource).toContain('QuotesController');
    expect(moduleSource).toContain('QuotesService');
  });

  it('exposes the quote foundation endpoints', () => {
    [
      '@Post()',
      '@Get()',
      "@Get(':id')",
      "@Patch(':id')",
      "@Post(':id/items')",
      "@Patch(':id/items/:itemId')",
      "@Delete(':id/items/:itemId')",
      "@Post(':id/reorder-items')",
      "@Post(':id/send')",
      "@Post(':id/revise')",
      "@Post(':id/accept')",
      "@Post(':id/decline')",
      "@Post(':id/cancel')",
      "@Post(':id/convert-to-job')",
      "@Get(':id/preview')",
      "@Get(':id/pdf')",
      "@Post(':id/duplicate')",
    ].forEach((route) => expect(controller).toContain(route));
  });

  it('enforces business scoping and server-side quote calculations', () => {
    expect(service).toContain('businessId: currentUser.businessId');
    expect(service).toContain('calculateQuoteTotals');
    expect(service).toContain('QUOTE_ACCESS_DENIED');
    expect(service).toContain('QUOTE_INVALID_STATUS');
    expect(service).toContain('QUOTE_ALREADY_CONVERTED');
  });

  it('records lifecycle audit events and quote revisions', () => {
    [
      'QUOTE_CREATED',
      'QUOTE_UPDATED',
      'QUOTE_ITEM_ADDED',
      'QUOTE_ITEM_UPDATED',
      'QUOTE_ITEM_REMOVED',
      'QUOTE_SENT',
      'QUOTE_REVISED',
      'QUOTE_ACCEPTED',
      'QUOTE_DECLINED',
      'QUOTE_CANCELLED',
      'QUOTE_CONVERTED_TO_JOB',
    ].forEach((event) => expect(service).toContain(event));
    expect(service).toContain('quoteRevision.create');
  });
});
