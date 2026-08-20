import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('quotes route contract', () => {
  const controller = readFileSync(
    join(__dirname, 'quotes.controller.ts'),
    'utf8',
  );
  const service = readFileSync(join(__dirname, 'quotes.service.ts'), 'utf8');
  const pdfProvider = readFileSync(
    join(__dirname, 'quote-pdf.provider.ts'),
    'utf8',
  );
  const moduleSource = readFileSync(
    join(__dirname, 'quotes.module.ts'),
    'utf8',
  );
  const publicController = readFileSync(
    join(__dirname, 'public-quotes.controller.ts'),
    'utf8',
  );
  const appModule = readFileSync(
    join(__dirname, '..', 'app.module.ts'),
    'utf8',
  );
  const mobileQuoteDetails = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'mobile',
      'src',
      'screens',
      'QuoteDetailsScreen.tsx',
    ),
    'utf8',
  );
  const mobileQuoteDocuments = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'mobile',
      'src',
      'api',
      'quoteDocuments.ts',
    ),
    'utf8',
  );
  const mobileQuoteForm = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'mobile',
      'src',
      'screens',
      'QuoteFormScreen.tsx',
    ),
    'utf8',
  );

  it('registers the Quotes module in the application', () => {
    expect(appModule).toContain('QuotesModule');
    expect(moduleSource).toContain('QuotesController');
    expect(moduleSource).toContain('PublicQuotesController');
    expect(moduleSource).toContain('MediaModule');
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
    expect(service).toContain('QUOTE_ALREADY_RELATED_TO_JOB');
    expect(service).toContain('relatedJobId');
    expect(service).toContain('convertedJobId');
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
    expect(service).toContain('quoteRevision.upsert');
  });

  it('exposes public customer quote routes without staff JWT access', () => {
    expect(publicController).toContain('@Public()');
    expect(publicController).toContain("@Controller('public/quotes')");
    [
      "@Get(':token')",
      "@Post(':token/view')",
      "@Post(':token/accept')",
      "@Post(':token/decline')",
    ].forEach((route) => expect(publicController).toContain(route));
  });

  it('uses PDF, hash-only token and local email provider seams', () => {
    expect(service).toContain('generateAndStorePdf');
    expect(pdfProvider).toContain('application/pdf');
    expect(service).toContain('hashToken');
    expect(service).toContain('tokenHash');
    expect(service).not.toContain('rawToken: tokenHash');
    expect(service).toContain('QUOTE_EMAIL_REQUIRED');
    expect(service).toContain('QUOTE_PUBLIC_TOKEN_INVALID');
    expect(service).toContain('QUOTE_ACCEPTANCE_CONFIRMATION_REQUIRED');
    expect(service).toContain("this.config.get<string>('APP_PUBLIC_URL')");
  });

  it('keeps quote PDF opening authenticated and document-driven in mobile', () => {
    expect(mobileQuoteDocuments).toContain('downloadAuthenticatedQuotePdf');
    expect(mobileQuoteDocuments).toContain('buildAuthenticatedHeaders(token)');
    expect(mobileQuoteDetails).toContain(
      "label={activeDocument ? 'View PDF' : 'Generate PDF'}",
    );
    expect(mobileQuoteDetails).toContain('View PDF');
    expect(mobileQuoteDetails).toContain('Related Job');
    expect(mobileQuoteDetails).toContain('Converted to Job');
    expect(mobileQuoteDetails).not.toContain('objectKey');
    expect(mobileQuoteDetails).not.toContain('storageProvider');
  });

  it('labels quote discounts in customer-facing units before converting to stored values', () => {
    expect(mobileQuoteForm).toContain('Fixed amount ($)');
    expect(mobileQuoteForm).toContain('Percentage (%)');
    expect(mobileQuoteForm).toContain('parseAdjustmentInput');
    expect(mobileQuoteForm).not.toContain('Fixed cents');
    expect(mobileQuoteForm).not.toContain('Percentage basis points');
  });
});
