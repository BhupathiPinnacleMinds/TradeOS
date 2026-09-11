import type { AuthenticatedUser } from '@tradieos/shared';
import { InvoicesService } from './invoices.service';
import type { InvoicePdfProvider } from './invoice-pdf.provider';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

const owner: AuthenticatedUser = {
  businessId: 'business-1',
  email: 'owner@demo-tradieos.com',
  id: 'owner-1',
  role: 'OWNER',
};

describe('InvoicesService PDF generation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends invoices through the configured Resend provider without enabling broader customer communications', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      json: () => Promise.resolve({ id: 'em_invoice_123' }),
      ok: true,
      status: 200,
    } as Response);
    const tx = createTransactionMock();
    const prisma = createPrismaMock(tx);
    prisma.invoice.findFirst
      .mockResolvedValueOnce(invoiceRecord())
      .mockResolvedValueOnce(
        invoiceRecord({
          sentAt: new Date('2026-09-11T01:00:00.000Z'),
          status: 'SENT',
        }),
      );
    const storage = createStorageMock();
    type InvoiceSentPayload = {
      businessId: string;
      createdBy: string;
      invoiceId: string;
      publicUrl: string;
    };
    const invoiceSent = jest
      .fn<Promise<void>, [InvoiceSentPayload]>()
      .mockResolvedValue(undefined);
    const service = new InvoicesService(
      prisma as never,
      createConfigMock({
        APP_PUBLIC_URL: 'https://staging.tradieos.com',
        CUSTOMER_COMMUNICATIONS_ENABLED: 'false',
        EMAIL_FROM_ADDRESS: 'accounts@tradieos.com',
        EMAIL_FROM_NAME: 'TradieOS Staging',
        EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_test_key',
      }) as never,
      storage as never,
      { invoiceSent } as never,
      {} as never,
    );

    const response = await service.send(owner, 'invoice-1', {
      message: 'Please review this invoice.',
      subject: 'Invoice INV-2026-000003 from Pioneer',
      to: 'sam@example.com',
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
    expect(body.text).toContain('https://staging.tradieos.com/invoice/');
    const invoiceUpdateCalls = tx.invoice.update.mock.calls as Array<
      [
        {
          data: { status?: string };
        },
      ]
    >;
    expect(invoiceUpdateCalls[0]?.[0].data.status).toBe('SENT');
    const invoiceSentPayload = invoiceSent.mock.calls[0]?.[0];
    expect(invoiceSentPayload).toEqual(
      expect.objectContaining({
        businessId: owner.businessId,
        createdBy: owner.id,
        invoiceId: 'invoice-1',
      }),
    );
    expect(invoiceSentPayload?.publicUrl).toContain(
      'https://staging.tradieos.com/invoice/',
    );
    expect(response.invoice.status).toBe('SENT');
  });

  it('does not report successful invoice delivery when the configured provider fails', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      json: () => Promise.resolve({ message: 'domain not verified' }),
      ok: false,
      status: 403,
    } as Response);
    const tx = createTransactionMock();
    const prisma = createPrismaMock(tx);
    const storage = createStorageMock();
    const invoiceSent = jest.fn().mockResolvedValue(undefined);
    const service = new InvoicesService(
      prisma as never,
      createConfigMock({
        APP_PUBLIC_URL: 'https://staging.tradieos.com',
        EMAIL_FROM_ADDRESS: 'accounts@tradieos.com',
        EMAIL_FROM_NAME: 'TradieOS Staging',
        EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_test_key',
      }) as never,
      storage as never,
      { invoiceSent } as never,
      {} as never,
    );

    await expect(
      service.send(owner, 'invoice-1', {
        message: 'Please review this invoice.',
        subject: 'Invoice INV-2026-000003 from Pioneer',
        to: 'sam@example.com',
      }),
    ).rejects.toMatchObject({
      response: { code: 'INVOICE_SEND_FAILED' },
    });
    expect(invoiceSent).not.toHaveBeenCalled();
  });

  it('uses the linked job service address when the invoice/source quote site is only a placeholder', async () => {
    const tx = createTransactionMock();
    const prisma = createPrismaMock(tx);
    const storage = createStorageMock();
    const { generateInvoicePdf, provider: pdfProvider } =
      createPdfProviderMock();
    const service = new InvoicesService(
      prisma as never,
      {} as never,
      storage as never,
      {} as never,
      {} as never,
    );
    (service as unknown as { pdfProvider: InvoicePdfProvider }).pdfProvider =
      pdfProvider;

    await service.pdf(owner, 'invoice-1');

    expect(generateInvoicePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceAddress: '21 Villite Ave, Tarneit, VIC, 3029',
      }),
    );
    expect(tx.invoicePdfDocument.create).toHaveBeenCalledTimes(1);
  });

  it('falls back to the source quote service address when the invoice has no usable job address', async () => {
    const tx = createTransactionMock();
    const prisma = createPrismaMock(tx, {
      customerSite: null,
      customerSiteId: null,
      job: null,
      jobId: null,
      sourceQuote: {
        customerSite: {
          addressLine1: '8 Market Lane',
          addressLine2: null,
          id: 'quote-site-1',
          label: 'Shop',
          postcode: '3000',
          state: 'VIC',
          suburb: 'Melbourne',
        },
        customerSiteId: 'quote-site-1',
        id: 'quote-1',
        quoteNumber: 'Q-2026-000005',
        status: 'CONVERTED',
        title: 'Plumbing quote',
        totalCents: 13200,
      },
    });
    const storage = createStorageMock();
    const { generateInvoicePdf, provider: pdfProvider } =
      createPdfProviderMock();
    const service = new InvoicesService(
      prisma as never,
      {} as never,
      storage as never,
      {} as never,
      {} as never,
    );
    (service as unknown as { pdfProvider: InvoicePdfProvider }).pdfProvider =
      pdfProvider;

    await service.pdf(owner, 'invoice-1');

    expect(generateInvoicePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceAddress: '8 Market Lane, Melbourne, VIC, 3000',
      }),
    );
  });

  it('updates the current draft PDF document instead of creating duplicate draft rows', async () => {
    const existingDocument = invoicePdfDocument({
      objectKey: 'invoices/old-draft.pdf',
    });
    const tx = createTransactionMock(existingDocument);
    const prisma = createPrismaMock(tx);
    const storage = createStorageMock();
    const { provider: pdfProvider } = createPdfProviderMock();
    const service = new InvoicesService(
      prisma as never,
      {} as never,
      storage as never,
      {} as never,
      {} as never,
    );
    (service as unknown as { pdfProvider: InvoicePdfProvider }).pdfProvider =
      pdfProvider;

    await service.pdf(owner, 'invoice-1');

    expect(tx.invoicePdfDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pdf-existing' },
      }),
    );
    expect(tx.invoicePdfDocument.create).not.toHaveBeenCalled();
  });

  it('reuses an existing non-draft PDF document instead of regenerating mutable content', async () => {
    const existingDocument = invoicePdfDocument({
      objectKey: 'invoices/existing.pdf',
    });
    const tx = createTransactionMock(existingDocument);
    const prisma = createPrismaMock(tx, { status: 'SENT' });
    const storage = createStorageMock();
    const { generateInvoicePdf, provider: pdfProvider } =
      createPdfProviderMock();
    const service = new InvoicesService(
      prisma as never,
      {} as never,
      storage as never,
      {} as never,
      {} as never,
    );
    (service as unknown as { pdfProvider: InvoicePdfProvider }).pdfProvider =
      pdfProvider;

    await service.pdf(owner, 'invoice-1');

    expect(generateInvoicePdf).not.toHaveBeenCalled();
    expect(tx.invoicePdfDocument.create).not.toHaveBeenCalled();
    expect(tx.invoicePdfDocument.update).not.toHaveBeenCalled();
    expect(storage.readObject).toHaveBeenCalledWith({
      objectKey: 'invoices/existing.pdf',
    });
  });
});

function createPrismaMock(
  tx: ReturnType<typeof createTransactionMock>,
  invoiceOverrides: Record<string, unknown> = {},
) {
  return {
    $transaction: jest.fn(
      (
        input: Array<Promise<unknown>> | ((transaction: typeof tx) => unknown),
      ) =>
        Array.isArray(input) ? Promise.all(input) : Promise.resolve(input(tx)),
    ),
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    business: {
      findUnique: jest.fn().mockResolvedValue(business),
    },
    invoice: {
      findFirst: jest.fn().mockResolvedValue(invoiceRecord(invoiceOverrides)),
    },
    invoicePayment: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    invoicePdfDocument: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function createTransactionMock(
  existingDocument: Record<string, unknown> | null = null,
) {
  return {
    auditLog: {
      create: jest.fn(),
    },
    invoice: {
      update: jest.fn().mockResolvedValue(
        invoiceRecord({
          sentAt: new Date('2026-09-11T01:00:00.000Z'),
          status: 'SENT',
        }),
      ),
    },
    invoicePdfDocument: {
      create: jest.fn().mockResolvedValue(invoicePdfDocument()),
      findFirst: jest.fn().mockResolvedValue(existingDocument),
      update: jest.fn().mockResolvedValue(invoicePdfDocument()),
    },
    invoicePublicAccessToken: {
      create: jest.fn().mockResolvedValue({
        id: 'public-token-1',
        rawToken: 'raw-invoice-token',
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

function createConfigMock(values: Record<string, string>) {
  return {
    get: jest.fn(
      (key: string, defaultValue?: string) => values[key] ?? defaultValue,
    ),
  };
}

function invoicePdfDocument(overrides: Record<string, unknown> = {}) {
  return {
    checksum: 'generated-checksum',
    fileName: 'Invoice-INV-2026-000003.pdf',
    fileSizeBytes: 99,
    generatedAt: new Date('2026-09-11T01:00:00.000Z'),
    id: 'pdf-existing',
    invoiceId: 'invoice-1',
    mimeType: 'application/pdf',
    objectKey: 'invoices/generated.pdf',
    version: 1,
    ...overrides,
  };
}

function createStorageMock() {
  return {
    createObjectKey: jest.fn().mockReturnValue('invoices/generated.pdf'),
    readObject: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
    uploadFile: jest.fn().mockResolvedValue({
      checksum: 'stored-checksum',
      contentLength: 99,
    }),
  };
}

function createPdfProviderMock() {
  const generateInvoicePdf = jest.fn().mockReturnValue({
    buffer: Buffer.from('%PDF-1.4'),
    checksum: 'generated-checksum',
    fileName: 'Invoice-INV-2026-000003.pdf',
    mimeType: 'application/pdf',
  });
  const provider: InvoicePdfProvider = {
    generateInvoicePdf,
    generateReceiptPdf: jest.fn(),
  };
  return {
    generateInvoicePdf,
    provider,
  };
}

const business = {
  abn: '12345678901',
  address: '1 Collins Street',
  email: 'accounts@tradieos.test',
  gstRegistered: true,
  id: 'business-1',
  name: 'TradieOS Test',
  phone: '0399990000',
  postcode: '3000',
  state: 'VIC',
  suburb: 'Melbourne',
  timezone: 'Australia/Melbourne',
};

function invoiceRecord(overrides: Record<string, unknown> = {}) {
  return {
    amountPaidCents: 0,
    balanceDueCents: 13200,
    business,
    businessId: 'business-1',
    createdAt: new Date('2026-09-11T00:00:00.000Z'),
    createdBy: 'owner-1',
    creditAppliedCents: 0,
    currency: 'AUD',
    customer: {
      companyName: null,
      displayName: 'Sam Donald',
      email: 'sam@example.com',
      id: 'customer-1',
      phone: '0414303343',
    },
    customerId: 'customer-1',
    customerNotes: null,
    customerSite: {
      addressLine1: 'Address to be confirmed',
      addressLine2: null,
      id: 'site-placeholder',
      label: 'Service address',
      postcode: '',
      state: '',
      suburb: '',
    },
    customerSiteId: 'site-placeholder',
    description: 'Accepted plumbing quote',
    discountCents: 0,
    discountType: 'NONE',
    discountValue: 0,
    dueDate: new Date('2026-09-17T14:00:00.000Z'),
    gstCents: 1200,
    gstRateBasisPoints: 1000,
    id: 'invoice-1',
    internalNotes: 'Internal notes must not be shown to customers.',
    invoiceNumber: 'INV-2026-000003',
    issueDate: new Date('2026-09-10T14:00:00.000Z'),
    job: {
      addressLine1: '21 Villite Ave',
      addressLine2: null,
      assignedToUserId: null,
      id: 'job-1',
      jobNumber: 'JOB-2026-000005',
      postcode: '3029',
      state: 'VIC',
      suburb: 'Tarneit',
      title: 'Plumbing job test',
    },
    jobId: 'job-1',
    lineItems: [
      {
        businessId: 'business-1',
        createdAt: new Date('2026-09-11T00:00:00.000Z'),
        description: null,
        id: 'invoice-line-1',
        invoiceId: 'invoice-1',
        lineGstCents: 1200,
        lineSubtotalCents: 12000,
        lineTotalCents: 13200,
        name: 'Labour',
        position: 0,
        quantity: { toString: () => '1' },
        taxable: true,
        type: 'LABOUR',
        unit: 'hour',
        unitPriceCents: 12000,
        updatedAt: new Date('2026-09-11T00:00:00.000Z'),
      },
    ],
    paidAt: null,
    paymentTerms: 'Payment due within 7 days.',
    pricingMode: 'GST_EXCLUSIVE',
    sentAt: null,
    sourceQuote: {
      customerSite: {
        addressLine1: 'Address to be confirmed',
        addressLine2: null,
        id: 'quote-site-placeholder',
        label: 'Service address',
        postcode: '',
        state: '',
        suburb: '',
      },
      customerSiteId: 'quote-site-placeholder',
      id: 'quote-1',
      quoteNumber: 'Q-2026-000005',
      status: 'CONVERTED',
      title: 'Plumbing quote',
      totalCents: 13200,
    },
    sourceQuoteId: 'quote-1',
    status: 'DRAFT',
    subtotalCents: 12000,
    title: 'Invoice for JOB-2026-000005',
    totalCents: 13200,
    updatedAt: new Date('2026-09-11T00:00:00.000Z'),
    updatedBy: 'owner-1',
    version: 1,
    viewedAt: null,
    voidedAt: null,
    ...overrides,
  };
}
