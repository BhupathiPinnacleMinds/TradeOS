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
  const mobilePublicQuote = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'mobile',
      'src',
      'screens',
      'PublicQuoteScreen.tsx',
    ),
    'utf8',
  );
  const mobileApiClient = readFileSync(
    join(__dirname, '..', '..', '..', 'mobile', 'src', 'api', 'client.ts'),
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
      "@Get(':token/pdf')",
      "@Post(':token/view')",
      "@Post(':token/accept')",
      "@Post(':token/decline')",
    ].forEach((route) => expect(publicController).toContain(route));
  });

  it('uses PDF, hash-only token and configuration-driven email provider seams', () => {
    expect(service).toContain('generateAndStorePdf');
    expect(service).toContain('publicPdf');
    expect(service).toContain('publicQuoteDocuments');
    expect(pdfProvider).toContain('application/pdf');
    expect(service).toContain('hashToken');
    expect(service).toContain('tokenHash');
    expect(service).not.toContain('rawToken: tokenHash');
    expect(service).toContain('QUOTE_EMAIL_REQUIRED');
    expect(service).toContain('QUOTE_PUBLIC_TOKEN_INVALID');
    expect(service).toContain('QUOTE_ACCEPTANCE_CONFIRMATION_REQUIRED');
    expect(service).toContain("this.config.get<string>('APP_PUBLIC_URL')");
    expect(service).toContain('createQuoteEmailProvider');
    expect(service).not.toContain('new ConsoleQuoteEmailProvider()');
  });

  it('keeps quote PDF opening authenticated and document-driven in mobile', () => {
    expect(mobileQuoteDocuments).toContain('downloadAuthenticatedQuotePdf');
    expect(mobileQuoteDocuments).toContain('openDownloadedQuotePdf');
    expect(mobileQuoteDocuments).toContain('buildAuthenticatedHeaders(token)');
    expect(mobileQuoteDocuments).toContain(
      "import * as IntentLauncher from 'expo-intent-launcher';",
    );
    expect(mobileQuoteDocuments).toContain(
      'FileSystem.getContentUriAsync(localUri)',
    );
    expect(mobileQuoteDocuments).toContain('IntentLauncher.startActivityAsync');
    expect(mobileQuoteDocuments).toContain('data: contentUri');
    expect(mobileQuoteDocuments).toContain(
      'flags: ANDROID_GRANT_READ_URI_PERMISSION',
    );
    expect(mobileQuoteDetails).toContain(
      'await openDownloadedQuotePdf(localUri, quote.id);',
    );
    expect(mobileQuoteDetails).not.toContain('await Linking.openURL(localUri)');
    expect(mobileQuoteDetails).toContain(
      "label={activeDocument ? 'View PDF' : 'Generate PDF'}",
    );
    expect(mobileQuoteDetails).toContain('View PDF');
    expect(mobileQuoteDetails).toContain('Related Job');
    expect(mobileQuoteDetails).toContain('Converted to Job');
    expect(mobileQuoteDetails).not.toContain('objectKey');
    expect(mobileQuoteDetails).not.toContain('storageProvider');
  });

  it('keeps quote form and send modal keyboard-safe on mobile', () => {
    expect(mobileQuoteForm).toContain('<KeyboardAvoidingView');
    expect(mobileQuoteForm).toContain('keyboardAvoidingBehavior');
    expect(mobileQuoteForm).toContain('keyboardShouldPersistTaps="handled"');
    expect(mobileQuoteForm).toContain('keyboardDismissMode={');
    expect(mobileQuoteForm).toContain('paddingBottom: Math.max(insets.bottom');
    expect(mobileQuoteForm).toContain('style={styles.scroll}');
    expect(mobileQuoteForm).toContain('ref={scrollRef}');

    expect(mobileQuoteDetails).toContain('<KeyboardAvoidingView');
    expect(mobileQuoteDetails).toContain('modalKeyboardAvoider');
    expect(mobileQuoteDetails).toContain('modalScrollContent');
    expect(mobileQuoteDetails).toContain('keyboardShouldPersistTaps="handled"');
    expect(mobileQuoteDetails).toContain('keyboardDismissMode={');
  });

  it('scrolls the New Quote Description field into view when focused', () => {
    expect(mobileQuoteForm).toContain('function scrollDescriptionIntoView()');
    expect(mobileQuoteForm).toContain('descriptionOffsetYRef');
    expect(mobileQuoteForm).toContain('scrollRef.current?.scrollTo');
    expect(mobileQuoteForm).toContain('clearTimeout(descriptionFocusTimerRef');
    expect(mobileQuoteForm).toContain('label="Title"');
    expect(mobileQuoteForm).toContain('label="Description"');
    expect(mobileQuoteForm).toContain('onFocus={scrollDescriptionIntoView}');
    expect(mobileQuoteForm).toContain(
      'descriptionOffsetYRef.current = event.nativeEvent.layout.y',
    );
  });

  it('does not persist untouched default quote line-item placeholders', () => {
    expect(mobileQuoteForm).toContain('const placeholderLineItem');
    expect(mobileQuoteForm).toContain('isUntouchedPlaceholderLineItem');
    expect(mobileQuoteForm).toContain(
      'if (isUntouchedPlaceholderLineItem(item))',
    );
    expect(mobileQuoteForm).toContain('lineItems.activeItemCount === 0');
    expect(mobileQuoteForm).toContain(
      'lineItems.validItems.length < lineItems.activeItemCount',
    );
    expect(mobileQuoteForm).toContain('lineItems: parsedLineItems.validItems');
  });

  it('shows public quote expiry and token-scoped PDF access to customers', () => {
    expect(mobilePublicQuote).toContain('Valid until');
    expect(mobilePublicQuote).toContain('formatBusinessDate');
    expect(mobilePublicQuote).toContain('response.documents?.[0]');
    expect(mobilePublicQuote).toContain('View PDF');
    expect(mobilePublicQuote).toContain('publicQuotePdfUrl(token)');
    expect(mobileApiClient).toContain('publicQuotePdfUrl');
    expect(mobileApiClient).toContain('/public/quotes/');
    expect(mobileApiClient).toContain('/pdf');
    expect(mobilePublicQuote).not.toContain('objectKey');
    expect(mobilePublicQuote).not.toContain('storageProvider');
  });

  it('labels quote discounts in customer-facing units before converting to stored values', () => {
    expect(mobileQuoteForm).toContain('Fixed amount ($)');
    expect(mobileQuoteForm).toContain('Percentage (%)');
    expect(mobileQuoteForm).toContain('parseAdjustmentInput');
    expect(mobileQuoteForm).not.toContain('Fixed cents');
    expect(mobileQuoteForm).not.toContain('Percentage basis points');
  });
});
