import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..', '..');

function source(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

function section(text: string, start: string, end: string) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
}

describe('invoice customer payment experience contracts', () => {
  it('exposes public invoice PDF through the secure public invoice token route', () => {
    const controller = source(
      'apps/api/src/invoices/public-invoices.controller.ts',
    );
    const service = source('apps/api/src/invoices/invoices.service.ts');

    expect(controller).toContain("@Get(':token/pdf')");
    expect(controller).toContain('this.invoices.publicPdf(token)');
    expect(service).toContain('async publicPdf(rawToken: string)');
    expect(service).toContain('const context = await this.resolvePublicToken');
    expect(service).toContain('this.storage.readObject');
    expect(service).not.toContain('publicUrl: document.objectKey');
  });

  it('keeps public payment declarations pending until staff confirmation', () => {
    const service = source('apps/api/src/invoices/invoices.service.ts');
    const schema = source('apps/api/prisma/schema.prisma');

    expect(schema).toContain('model InvoicePaymentDeclaration');
    expect(schema).toContain('enum InvoicePaymentDeclarationStatus');
    expect(service).toContain('async publicDeclarePayment');
    expect(service).toContain("status: 'PENDING'");
    expect(service).toContain('INVOICE_PAYMENT_DECLARED');
    expect(service).toContain('async confirmPaymentDeclaration');
    expect(service).toContain('this.applyInvoicePayment');
    expect(service).toContain("status: 'CONFIRMED'");
    expect(service).toContain('async rejectPaymentDeclaration');
    expect(service).toContain("status: 'REJECTED'");
  });

  it('uses the existing invoice payment application path for confirmed declarations', () => {
    const service = source('apps/api/src/invoices/invoices.service.ts');

    expect(service).toContain('private async applyInvoicePayment');
    expect(service).toContain('async recordPayment');
    expect(service).toContain('const result = await this.applyInvoicePayment');
    expect(service).toContain('INVOICE_PAYMENT_RECORDED');
    expect(service).toContain('INVOICE_PAID');
  });

  it('returns payment instructions and declarations in authenticated and public invoice responses', () => {
    const shared = source('packages/shared/src/invoices.ts');
    const service = source('apps/api/src/invoices/invoices.service.ts');

    expect(shared).toContain('export interface InvoicePaymentInstructions');
    expect(shared).toContain('export interface InvoicePaymentDeclaration');
    expect(shared).toContain(
      'paymentInstructions?: InvoicePaymentInstructions',
    );
    expect(shared).toContain(
      'paymentDeclarations?: InvoicePaymentDeclaration[]',
    );
    expect(service).toContain('private toPaymentInstructions');
    expect(service).toContain('private toPaymentDeclaration');
    expect(service).toContain(
      'paymentInstructions: this.toPaymentInstructions',
    );
    expect(service).toContain(
      'paymentDeclarations: invoice.paymentDeclarations.map',
    );
  });

  it('adds public invoice mobile actions for View PDF and I have paid without exposing storage URLs', () => {
    const screen = source('apps/mobile/src/screens/PublicInvoiceScreen.tsx');
    const client = source('apps/mobile/src/api/client.ts');

    expect(client).toContain('publicInvoicePdfUrl');
    expect(client).toContain('/public/invoices/');
    expect(client).toContain('/payment-declarations');
    expect(screen).toContain('View PDF');
    expect(screen).toContain("I've paid");
    expect(screen).toContain('publicInvoicePaymentDeclarationRequest');
    expect(screen).not.toContain('objectKey');
    expect(screen).not.toContain('R2_');
  });

  it('lets authorised staff configure invoice payment instructions for future invoices', () => {
    const controller = source(
      'apps/api/src/businesses/businesses.controller.ts',
    );
    const service = source('apps/api/src/businesses/businesses.service.ts');
    const settings = source('apps/mobile/src/screens/SettingsScreen.tsx');
    const client = source('apps/mobile/src/api/client.ts');

    expect(controller).toContain("@Get('payment-instructions')");
    expect(controller).toContain("@Patch('payment-instructions')");
    expect(service).toContain('paymentAccountName');
    expect(settings).toContain('Invoice payment details');
    expect(settings).toContain('businessPaymentInstructionsRequest');
    expect(settings).toContain('updateBusinessPaymentInstructionsRequest');
    expect(settings).not.toContain('Payment reference instructions');
    expect(settings).not.toContain('referenceInstructions');
    expect(client).toContain("'/business/payment-instructions'");
  });

  it('uses each invoice number as the customer payment reference instead of a global business setting', () => {
    const service = source('apps/api/src/invoices/invoices.service.ts');
    const businessesService = source(
      'apps/api/src/businesses/businesses.service.ts',
    );
    const dto = source('apps/api/src/businesses/dto/businesses.dto.ts');
    const shared = source('packages/shared/src/invoices.ts');
    const paymentInstructions = section(
      service,
      'private toPaymentInstructions',
      'private sumBalances',
    );

    expect(paymentInstructions).toContain(
      'const reference = invoice.invoiceNumber;',
    );
    expect(paymentInstructions).not.toContain('paymentReferenceInstructions');
    expect(businessesService).not.toContain(
      'paymentReferenceInstructions: this.clean',
    );
    expect(dto).not.toContain('referenceInstructions');
    expect(shared).not.toContain('referenceInstructions');
  });

  it('renders customer notes separately from public payment instructions', () => {
    const publicScreen = source(
      'apps/mobile/src/screens/PublicInvoiceScreen.tsx',
    );
    const paymentInstructions = section(
      publicScreen,
      '<Card title="Payment instructions">',
      '{invoice.customerNotes ? (',
    );

    expect(publicScreen).toContain('<Card title="Customer notes">');
    expect(paymentInstructions).not.toContain('{invoice.customerNotes}');
    expect(paymentInstructions).not.toContain('invoice.internalNotes');
  });

  it('shows paid public invoices as paid in full instead of payable bank instructions', () => {
    const publicScreen = source(
      'apps/mobile/src/screens/PublicInvoiceScreen.tsx',
    );
    const paidSection = section(
      publicScreen,
      '{isPaid ? (',
      '{invoice.customerNotes ? (',
    );

    expect(publicScreen).toContain("const isPaid = invoice.status === 'PAID'");
    expect(paidSection).toContain('<Card title="Payment status">');
    expect(paidSection).toContain(
      'Paid in full. No further payment is required.',
    );
    expect(paidSection).toContain('!isVoid ? (');
    expect(paidSection).toContain('<Card title="Payment instructions">');
    expect(paidSection).toContain('Reference: {instructions.reference}');
    expect(paidSection).toContain('instructions.customInstructions');
  });

  it('keeps new invoice default payment terms concise without placeholder bank details', () => {
    const service = source('apps/api/src/invoices/invoices.service.ts');
    const form = source('apps/mobile/src/screens/InvoiceFormScreen.tsx');

    expect(service).toContain(
      "const DEFAULT_INVOICE_PAYMENT_TERMS = 'Payment due within 7 days.';",
    );
    expect(form).toContain(
      "const DEFAULT_INVOICE_PAYMENT_TERMS = 'Payment due within 7 days.';",
    );
    expect(service).not.toContain('Bank transfer details to be confirmed');
    expect(form).not.toContain('Bank transfer details to be confirmed');
  });

  it('refreshes the current invoice PDF revision after confirmed payments only', () => {
    const service = source('apps/api/src/invoices/invoices.service.ts');
    const recordPayment = section(
      service,
      'async recordPayment',
      'async publicDeclarePayment',
    );
    const publicDeclarePayment = section(
      service,
      'async publicDeclarePayment',
      'async confirmPaymentDeclaration',
    );
    const confirmPaymentDeclaration = section(
      service,
      'async confirmPaymentDeclaration',
      'async rejectPaymentDeclaration',
    );
    const applyInvoicePayment = section(
      service,
      'private async applyInvoicePayment',
      'async paymentReceipt',
    );

    expect(applyInvoicePayment).toContain('version: { increment: 1 }');
    expect(recordPayment).toContain(
      'await this.refreshCurrentInvoicePdf(currentUser, result.invoice.id);',
    );
    expect(confirmPaymentDeclaration).toContain(
      'await this.refreshCurrentInvoicePdf(currentUser, result.invoice.id);',
    );
    expect(publicDeclarePayment).not.toContain('refreshCurrentInvoicePdf');
  });

  it('requires explicit void reason, stores void metadata and does not revoke valid public tokens', () => {
    const controller = source('apps/api/src/invoices/invoices.controller.ts');
    const dto = source('apps/api/src/invoices/dto/invoices.dto.ts');
    const schema = source('apps/api/prisma/schema.prisma');
    const service = source('apps/api/src/invoices/invoices.service.ts');
    const client = source('apps/mobile/src/api/client.ts');
    const screen = source('apps/mobile/src/screens/InvoiceDetailsScreen.tsx');
    const voidMethod = section(
      service,
      'async void(currentUser',
      'async publicFindOne',
    );

    expect(controller).toContain('@Body() dto: VoidInvoiceDto');
    expect(dto).toContain('export class VoidInvoiceDto');
    expect(schema).toContain('voidReason');
    expect(schema).toContain('voidedBy');
    expect(voidMethod).toContain('INVOICE_VOID_REASON_REQUIRED');
    expect(voidMethod).toContain('INVOICE_PAYMENTS_EXIST');
    expect(voidMethod).toContain('voidReason: reason');
    expect(voidMethod).toContain('voidedBy: currentUser.id');
    expect(voidMethod).toContain('INVOICE_VOIDED');
    expect(voidMethod).not.toContain('invoicePublicAccessToken.updateMany');
    expect(client).toContain('input: { reason: string }');
    expect(screen).toContain('VoidInvoiceModal');
    expect(screen).toContain('This action cannot be undone.');
    expect(screen).toContain('Reason for voiding');
  });

  it('renders valid public VOID invoice links as read-only instead of unavailable', () => {
    const service = source('apps/api/src/invoices/invoices.service.ts');
    const publicScreen = source(
      'apps/mobile/src/screens/PublicInvoiceScreen.tsx',
    );
    const resolvePublicToken = section(
      service,
      'private async resolvePublicToken',
      'private async getBusiness',
    );

    expect(resolvePublicToken).toContain('token.revokedAt');
    expect(resolvePublicToken).toContain('token.expiresAt < new Date()');
    expect(resolvePublicToken).not.toContain("token.invoice.status === 'VOID'");
    expect(publicScreen).toContain("const isVoid = invoice.status === 'VOID'");
    expect(publicScreen).toContain('This invoice has been voided by');
    expect(publicScreen).toContain('No payment is required.');
    expect(publicScreen).toContain('Original invoice total');
    expect(publicScreen).toContain("invoice.status !== 'PAID'");
    expect(publicScreen).toContain('!isVoid');
    expect(publicScreen).toContain('publicInvoicePaymentDeclarationRequest');
  });
});
