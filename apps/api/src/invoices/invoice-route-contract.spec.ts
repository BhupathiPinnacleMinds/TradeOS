import { readFileSync } from 'fs';
import { join } from 'path';

describe('invoice route contract', () => {
  const root = join(__dirname, '..', '..');

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
});
