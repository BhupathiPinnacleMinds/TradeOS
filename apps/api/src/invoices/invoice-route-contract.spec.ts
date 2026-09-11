import { readFileSync } from 'fs';
import { join } from 'path';

describe('invoice route contract', () => {
  const root = join(__dirname, '..', '..');
  const repoRoot = join(root, '..', '..');

  function mobileSource(relativePath: string) {
    return readFileSync(
      join(repoRoot, 'apps', 'mobile', 'src', relativePath),
      'utf8',
    );
  }

  it('registers protected invoice routes', () => {
    const controller = readFileSync(
      join(root, 'src', 'invoices', 'invoices.controller.ts'),
      'utf8',
    );

    expect(controller).toContain("@Controller('invoices')");
    expect(controller).toContain('@Get()');
    expect(controller).toContain('@Post()');
    expect(controller).toContain("@Get('accounts-receivable')");
    expect(controller).toContain("@Get('draft')");
    expect(controller).toContain("@Get(':id')");
    expect(controller).toContain("@Patch(':id')");
    expect(controller).toContain("@Post(':id/send')");
    expect(controller).toContain("@Post(':id/payments')");
    expect(controller).toContain("@Get(':id/payments/:paymentId/receipt')");
    expect(controller).toContain("@Post(':id/void')");
    expect(controller).toContain("@Get(':id/pdf')");
  });

  it('registers public customer-safe invoice routes', () => {
    const controller = readFileSync(
      join(root, 'src', 'invoices', 'public-invoices.controller.ts'),
      'utf8',
    );

    expect(controller).toContain('@Public()');
    expect(controller).toContain("@Controller('public/invoices')");
    expect(controller).toContain("@Get(':token')");
    expect(controller).toContain("@Post(':token/view')");
  });

  it('uses the documented public app URL setting for invoice links', () => {
    const service = readFileSync(
      join(root, 'src', 'invoices', 'invoices.service.ts'),
      'utf8',
    );

    expect(service).toContain("this.config.get<string>('APP_PUBLIC_URL')");
  });

  it('opens downloaded invoice PDFs through an Android content URI', () => {
    const helper = mobileSource('api/invoiceDocuments.ts');
    const screen = mobileSource('screens/InvoiceDetailsScreen.tsx');

    expect(helper).toContain(
      "import * as IntentLauncher from 'expo-intent-launcher';",
    );
    expect(helper).toContain('export async function openDownloadedInvoicePdf');
    expect(helper).toContain(
      'export async function openDownloadedInvoicePaymentReceipt',
    );
    expect(helper).toContain('FileSystem.getInfoAsync(localUri)');
    expect(helper).toContain('if (!fileInfo?.exists)');
    expect(helper).toContain('FileSystem.getContentUriAsync(localUri)');
    expect(helper).toContain('IntentLauncher.startActivityAsync');
    expect(helper).toContain('data: contentUri');
    expect(helper).toContain('flags: ANDROID_GRANT_READ_URI_PERMISSION');
    expect(helper).toContain('type: INVOICE_PDF_MIME_TYPE');
    expect(helper).toContain(
      "const INVOICE_PDF_MIME_TYPE = 'application/pdf';",
    );
    expect(helper).toContain('headers: buildAuthenticatedHeaders(token)');
    expect(screen).toContain(
      'await openDownloadedInvoicePdf(localUri, invoice.id);',
    );
    expect(screen).toContain('await openDownloadedInvoicePaymentReceipt(');
    expect(screen).toContain(
      'localUri,\n        invoice.id,\n        paymentId,',
    );
    expect(screen).toContain(
      "void mutate('pdf', () => openPdf(document.fileName))",
    );
    expect(screen).not.toContain('await Linking.openURL(localUri);');
  });
});
