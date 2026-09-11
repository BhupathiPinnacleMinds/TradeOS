import { createInvoiceEmailProvider } from './invoice-email.provider';

describe('createInvoiceEmailProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends direct invoice emails through configured Resend', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      json: () => Promise.resolve({ id: 'em_invoice_123' }),
      ok: true,
      status: 200,
    } as Response);
    const provider = createInvoiceEmailProvider({
      apiKey: 're_test_key',
      fromAddress: 'accounts@tradieos.com',
      fromName: 'TradieOS Staging',
      isProduction: true,
      provider: 'resend',
    });

    const result = await provider.sendInvoice({
      businessName: 'Pioneer',
      invoiceNumber: 'INV-2026-000003',
      invoiceUrl: 'https://staging.tradieos.com/invoice/token',
      message: 'Please review invoice INV-2026-000003.',
      pdfFileName: 'Invoice-INV-2026-000003.pdf',
      subject: 'Invoice INV-2026-000003 from Pioneer',
      to: 'sam@example.com',
    });

    expect(result).toMatchObject({
      messageId: 'em_invoice_123',
      provider: 'resend',
      status: 'SENT',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({ method: 'POST' }),
    );
    const request = fetchMock.mock.calls[0]?.[1];
    const rawBody = request?.body;
    if (typeof rawBody !== 'string') {
      throw new Error('Expected Resend request body to be serialized JSON.');
    }
    const body = JSON.parse(rawBody) as {
      from: string;
      subject: string;
      text: string;
      to: string;
    };
    expect(body).toMatchObject({
      from: 'TradieOS Staging <accounts@tradieos.com>',
      subject: 'Invoice INV-2026-000003 from Pioneer',
      to: 'sam@example.com',
    });
    expect(body.text).toContain('https://staging.tradieos.com/invoice/token');
  });

  it('keeps direct invoice email local when console is configured outside production', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      json: () => Promise.resolve({ id: 'em_should_not_send' }),
      ok: true,
      status: 200,
    } as Response);
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    const provider = createInvoiceEmailProvider({
      isProduction: false,
      provider: 'console',
    });

    const result = await provider.sendInvoice({
      businessName: 'Pioneer',
      invoiceNumber: 'INV-2026-000003',
      invoiceUrl: 'https://staging.tradieos.com/invoice/token',
      message: 'Please review invoice INV-2026-000003.',
      pdfFileName: 'Invoice-INV-2026-000003.pdf',
      subject: 'Invoice INV-2026-000003 from Pioneer',
      to: 'sam@example.com',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      '[TradieOS email:TRANSACTIONAL]',
      expect.objectContaining({
        subject: 'Invoice INV-2026-000003 from Pioneer',
        to: 'sam@example.com',
      }),
    );
    expect(result).toMatchObject({ provider: 'console', status: 'SENT' });
  });

  it('fails safely for invalid direct invoice email providers in production', () => {
    expect(() =>
      createInvoiceEmailProvider({
        apiKey: 're_test_key',
        fromAddress: 'accounts@tradieos.com',
        isProduction: true,
        provider: 'mailgun',
      }),
    ).toThrow(/Unsupported EMAIL_PROVIDER/);
  });
});
