import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..', '..');

function source(path: string) {
  return readFileSync(join(root, path), 'utf8');
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
    expect(service).toContain('paymentReferenceInstructions');
    expect(settings).toContain('Invoice payment details');
    expect(settings).toContain('businessPaymentInstructionsRequest');
    expect(settings).toContain('updateBusinessPaymentInstructionsRequest');
    expect(client).toContain("'/business/payment-instructions'");
  });
});
