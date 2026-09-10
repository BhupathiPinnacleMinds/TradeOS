import { HttpException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { AuthenticatedUser } from '@tradieos/shared';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { QuotesService } from './quotes.service';
import type { UpsertQuoteDto } from './dto/quotes.dto';

const user: AuthenticatedUser = {
  businessId: 'business-1',
  email: 'owner@example.com',
  id: 'user-1',
  role: 'OWNER',
};
const TEST_NOW = new Date('2026-08-12T00:00:00.000Z');

const payload: UpsertQuoteDto = {
  customerId: 'customer-1',
  customerNotes: 'Please approve before work starts.',
  customerSiteId: 'site-1',
  depositType: 'NONE',
  depositValue: 0,
  description: 'Replace leaking tap.',
  discountType: 'NONE',
  discountValue: 0,
  expiryDate: '2026-08-24T00:00:00.000Z',
  issueDate: '2026-08-10T00:00:00.000Z',
  jobId: 'job-1',
  lineItems: [
    {
      name: 'Labour',
      quantity: '2.5',
      taxable: true,
      type: 'LABOUR',
      unit: 'hour',
      unitPriceCents: 10000,
    },
    {
      name: 'Material',
      quantity: '1',
      taxable: true,
      type: 'MATERIAL',
      unit: 'item',
      unitPriceCents: 8000,
    },
  ],
  pricingMode: 'GST_EXCLUSIVE',
  termsAndConditions: 'Valid for 14 days.',
  title: 'Tap repair',
};

function quoteRecord(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-08-10T00:00:00.000Z');
  return {
    acceptedAt: null,
    acceptedByEmail: null,
    acceptedByName: null,
    acceptedQuoteVersion: null,
    archivedAt: null,
    businessId: user.businessId,
    cancelledAt: null,
    convertedAt: null,
    convertedJob: null,
    convertedJobId: null,
    createdAt: now,
    createdBy: user.id,
    currency: 'AUD',
    customer: {
      companyName: null,
      displayName: 'GB',
      email: 'gb@example.com',
      id: payload.customerId,
      phone: '0400000000',
    },
    customerId: payload.customerId,
    customerNotes: payload.customerNotes,
    customerSite: {
      addressLine1: '1 Main St',
      addressLine2: null,
      businessId: user.businessId,
      createdAt: now,
      customerId: payload.customerId,
      id: payload.customerSiteId,
      isArchived: false,
      label: 'Appointment address',
      postcode: '3000',
      state: 'VIC',
      suburb: 'Melbourne',
      updatedAt: now,
    },
    customerSiteId: payload.customerSiteId,
    declinedAt: null,
    declineComment: null,
    declineReason: null,
    depositCents: 0,
    depositType: 'NONE',
    depositValue: 0,
    description: payload.description,
    discountCents: 0,
    discountType: 'NONE',
    discountValue: 0,
    expiredAt: null,
    expiryDate: new Date(payload.expiryDate ?? ''),
    gstCents: 3300,
    gstRateBasisPoints: 1000,
    id: 'quote-1',
    internalNotes: null,
    issueDate: new Date(payload.issueDate),
    job: { id: payload.jobId, jobNumber: 'JOB-2026-000012', title: 'Leak' },
    jobId: payload.jobId,
    latestViewedAt: null,
    lineItems: [
      {
        businessId: user.businessId,
        createdAt: now,
        description: null,
        id: 'line-1',
        lineGstCents: 2500,
        lineSubtotalCents: 25000,
        lineTotalCents: 27500,
        name: 'Labour',
        position: 0,
        quantity: '1',
        quoteId: 'quote-1',
        taxable: true,
        type: 'LABOUR',
        unit: 'hour',
        unitPriceCents: 10000,
        updatedAt: now,
      },
      {
        businessId: user.businessId,
        createdAt: now,
        description: null,
        id: 'line-2',
        lineGstCents: 800,
        lineSubtotalCents: 8000,
        lineTotalCents: 8800,
        name: 'Material',
        position: 1,
        quantity: '1',
        quoteId: 'quote-1',
        taxable: true,
        type: 'MATERIAL',
        unit: 'item',
        unitPriceCents: 8000,
        updatedAt: now,
      },
    ],
    pricingMode: 'GST_EXCLUSIVE',
    quoteNumber: 'Q-2026-000001',
    relatedJob: {
      id: payload.jobId,
      jobNumber: 'JOB-2026-000012',
      title: 'Leak',
    },
    relatedJobId: payload.jobId,
    sentAt: null,
    sourceAppointmentId: null,
    status: 'DRAFT',
    subtotalCents: 33000,
    termsAndConditions: payload.termsAndConditions,
    title: payload.title,
    totalCents: 36300,
    updatedAt: now,
    updatedBy: user.id,
    version: 1,
    viewCount: 0,
    viewedAt: null,
    ...overrides,
  };
}

function jsonSnapshot(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function publicTokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function createPrismaMock(quoteOverrides: Record<string, unknown> = {}) {
  const createdQuote = quoteRecord({ ...quoteOverrides, lineItems: [] });
  const quoteWithItems = quoteRecord(quoteOverrides);
  const sentQuote = quoteRecord({
    ...quoteOverrides,
    sentAt: new Date('2026-08-10T00:00:00.000Z'),
    status: 'SENT',
  });
  const pdfDocument = {
    businessId: user.businessId,
    checksum: 'pdf-checksum',
    fileName: 'Q-2026-000001-v1.pdf',
    fileSizeBytes: 1200,
    generatedAt: new Date('2026-08-10T00:00:00.000Z'),
    id: 'pdf-1',
    mimeType: 'application/pdf',
    objectKey: 'quotes/quote-1/pdf.pdf',
    quoteId: 'quote-1',
    quoteRevisionId: 'revision-1',
    storageProvider: 'local',
    version: 1,
  };
  type QuotePdfFindFirstInput = {
    orderBy?: { generatedAt: 'desc' };
    where: {
      businessId?: string;
      quoteId?: string;
      quoteRevisionId?: string;
      version?: number;
    };
  };
  const transactionQuotePdfFindFirst = jest
    .fn<Promise<typeof pdfDocument | null>, [QuotePdfFindFirstInput]>()
    .mockResolvedValue(null);
  const publicQuotePdfFindFirst = jest
    .fn<Promise<typeof pdfDocument | null>, [QuotePdfFindFirstInput]>()
    .mockResolvedValue(pdfDocument);
  const quoteRevision = {
    businessId: user.businessId,
    createdAt: new Date('2026-08-10T00:00:00.000Z'),
    createdBy: user.id,
    id: 'revision-1',
    quoteId: 'quote-1',
    reason: 'Customer-facing send',
    snapshot: jsonSnapshot(quoteWithItems),
    snapshotHash: 'snapshot-hash',
    status: 'DRAFT',
    version: 1,
  };
  const publicToken = {
    acceptedAt: null,
    businessId: user.businessId,
    declinedAt: null,
    expiresAt: new Date('2026-09-10T00:00:00.000Z'),
    id: 'public-token-1',
    lastViewedAt: null,
    quote: quoteWithItems,
    quoteId: 'quote-1',
    quoteRevision,
    quoteRevisionId: 'revision-1',
    revokedAt: null,
    tokenHash: publicTokenHash('public-token'),
    version: 1,
    viewCount: 0,
  };
  const quoteCreate = jest.fn((input: { data: Record<string, unknown> }) => {
    void input;
    return Promise.resolve(createdQuote);
  });
  const tx = {
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    business: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ timezone: 'Australia/Melbourne' }),
    },
    job: {
      create: jest.fn().mockResolvedValue({ id: 'job-converted-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    jobSequence: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue({ nextNumber: 15 }),
      update: jest.fn().mockResolvedValue({ nextNumber: 15 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    quote: {
      create: quoteCreate,
      findUniqueOrThrow: jest.fn().mockResolvedValue(quoteWithItems),
      update: jest.fn((input: { data?: { status?: string } }) =>
        Promise.resolve(
          input.data?.status === 'SENT'
            ? sentQuote
            : quoteRecord({
                ...quoteOverrides,
                convertedAt: new Date('2026-08-10T00:00:00.000Z'),
                convertedJobId: 'job-converted-1',
                jobId: 'job-converted-1',
                status: 'CONVERTED',
              }),
        ),
      ),
    },
    quoteLineItem: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    quotePdfDocument: {
      create: jest.fn().mockResolvedValue(pdfDocument),
      findFirst: transactionQuotePdfFindFirst,
      update: jest.fn().mockResolvedValue(pdfDocument),
    },
    quotePublicAccessToken: {
      create: jest.fn().mockResolvedValue({
        businessId: user.businessId,
        expiresAt: new Date('2026-09-10T00:00:00.000Z'),
        id: 'public-token-1',
        quoteId: 'quote-1',
        quoteRevisionId: 'revision-1',
        tokenHash: 'hashed-token',
        version: 1,
      }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    quoteRevision: {
      upsert: jest.fn().mockResolvedValue(quoteRevision),
    },
    quoteSequence: {
      update: jest.fn().mockResolvedValue({ nextNumber: 1 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
  const transaction = jest.fn(
    async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );
  const prisma = {
    $transaction: transaction,
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    business: {
      findUnique: jest.fn().mockResolvedValue({
        abn: '12345678901',
        address: '1 Main St',
        email: 'hello@tradieos.test',
        id: user.businessId,
        name: 'Demo Tradie Co',
        phone: '0400000000',
        postcode: '3000',
        state: 'VIC',
        suburb: 'Melbourne',
        timezone: 'Australia/Melbourne',
      }),
    },
    customer: { findFirst: jest.fn().mockResolvedValue({ id: 'customer-1' }) },
    customerSite: { findFirst: jest.fn().mockResolvedValue({ id: 'site-1' }) },
    job: { findFirst: jest.fn().mockResolvedValue({ id: 'job-1' }) },
    quote: { findFirst: jest.fn().mockResolvedValue(quoteWithItems) },
    quotePdfDocument: {
      findFirst: publicQuotePdfFindFirst,
      findMany: jest.fn().mockResolvedValue([]),
    },
    quotePublicAccessToken: {
      findUnique: jest.fn().mockResolvedValue(publicToken),
    },
  };
  return {
    pdfDocument,
    prisma,
    publicToken,
    publicQuotePdfFindFirst,
    quoteCreate,
    quoteRevision,
    quoteWithItems,
    sentQuote,
    tx,
  };
}

function createService(
  prisma: unknown,
  communications: {
    quoteFinalised: jest.Mock;
    quoteSent: jest.Mock;
  } = {
    quoteFinalised: jest.fn(),
    quoteSent: jest.fn(),
  },
  configValues: Record<string, string | undefined> = {},
) {
  const storage = {
    createObjectKey: jest.fn().mockReturnValue('quotes/quote-1/pdf.pdf'),
    createUploadTarget: jest.fn(),
    deleteObject: jest.fn(),
    completeUpload: jest.fn(),
    getObjectMetadata: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
    getSignedPreviewUrl: jest.fn(),
    name: 'local',
    objectExists: jest.fn(),
    readObject: jest.fn().mockResolvedValue(Buffer.from('%PDF-quote')),
    uploadFile: jest.fn().mockResolvedValue({
      checksum: 'pdf-checksum',
      contentLength: 1200,
    }),
  };
  return new QuotesService(
    prisma as never,
    {
      get: jest.fn(
        (key: string, fallback?: string) => configValues[key] ?? fallback,
      ),
    } as never,
    storage,
    communications as never,
    { createForRoles: jest.fn() } as never,
  );
}

describe('QuotesService create', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(TEST_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('creates the quote and line items separately inside one transaction', async () => {
    const { prisma, quoteCreate, tx } = createPrismaMock();
    const communications = {
      quoteFinalised: jest.fn(),
      quoteSent: jest.fn(),
    };
    const service = createService(prisma, communications);

    await service.create(user, payload);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const createQuoteCall = quoteCreate.mock.calls[0]?.[0];
    expect(createQuoteCall?.data).toBeDefined();
    expect(createQuoteCall?.data).not.toHaveProperty('lineItems');
    expect(tx.quoteLineItem.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            businessId: user.businessId,
            quoteId: 'quote-1',
            quantity: '2.5',
            unitPriceCents: 10000,
          }),
          expect.objectContaining({
            businessId: user.businessId,
            quoteId: 'quote-1',
            quantity: '1',
            unitPriceCents: 8000,
          }),
        ],
      }),
    );
    expect(communications.quoteSent).not.toHaveBeenCalled();
    expect(communications.quoteFinalised).not.toHaveBeenCalled();
  });

  it('returns a structured validation error for invalid quantities before persistence', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = createService(prisma);

    try {
      await service.create(user, {
        ...payload,
        lineItems: [{ ...payload.lineItems[0], quantity: '1.2345' }],
      });
      throw new Error('Expected invalid quantity to be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(400);
      expect((error as HttpException).getResponse()).toEqual({
        code: 'QUOTE_QUANTITY_INVALID',
        message: 'Quantity can have up to 3 decimal places.',
      });
    }
    expect(tx.quote.create).not.toHaveBeenCalled();
  });

  it('persists fixed dollar discounts as cents through the API save path', async () => {
    const { prisma, quoteCreate } = createPrismaMock({
      discountCents: 5000,
      discountType: 'FIXED',
      discountValue: 5000,
      gstCents: 2800,
      totalCents: 30800,
    });
    const service = createService(prisma);

    const response = await service.create(user, {
      ...payload,
      discountType: 'FIXED',
      discountValue: 5000,
    });

    const createQuoteCall = quoteCreate.mock.calls[0]?.[0];
    expect(createQuoteCall?.data).toEqual(
      expect.objectContaining({
        discountCents: 5000,
        discountType: 'FIXED',
        discountValue: 5000,
        gstCents: 2800,
        subtotalCents: 33000,
        totalCents: 30800,
      }),
    );
    expect(response.quote).toEqual(
      expect.objectContaining({
        discountCents: 5000,
        discountType: 'FIXED',
        discountValue: 5000,
        totalCents: 30800,
      }),
    );
  });

  it('stores existing job context as relatedJobId rather than convertedJobId', async () => {
    const { prisma, quoteCreate } = createPrismaMock();
    const service = createService(prisma);

    await service.create(user, {
      ...payload,
      jobId: undefined,
      relatedJobId: 'job-1',
    });

    const createQuoteCall = quoteCreate.mock.calls[0]?.[0];
    expect(createQuoteCall?.data).toEqual(
      expect.objectContaining({
        jobId: 'job-1',
        relatedJobId: 'job-1',
      }),
    );
    expect(createQuoteCall?.data).not.toHaveProperty('convertedJobId');
  });

  it('blocks conversion when an accepted quote is already related to an existing job', async () => {
    const { prisma, tx } = createPrismaMock({
      acceptedAt: new Date('2026-08-10T00:00:00.000Z'),
      relatedJobId: 'job-1',
      status: 'ACCEPTED',
    });
    const service = createService(prisma);

    try {
      await service.convertToJob(user, 'quote-1');
      throw new Error('Expected related quote conversion to be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(409);
      expect((error as HttpException).getResponse()).toEqual({
        code: 'QUOTE_ALREADY_RELATED_TO_JOB',
        message: 'This accepted quote is already related to an existing job.',
      });
    }
    expect(tx.job.create).not.toHaveBeenCalled();
  });

  it('converts independent accepted quotes into a new source job once', async () => {
    const { prisma, tx } = createPrismaMock({
      acceptedAt: new Date('2026-08-10T00:00:00.000Z'),
      job: null,
      jobId: null,
      relatedJob: null,
      relatedJobId: null,
      status: 'ACCEPTED',
    });
    const communications = {
      quoteFinalised: jest.fn(),
      quoteSent: jest.fn(),
    };
    const service = createService(prisma, communications);

    await service.convertToJob(user, 'quote-1');

    const jobCreateCalls = tx.job.create.mock.calls as unknown as Array<
      [{ data: { sourceQuoteId: string } }]
    >;
    expect(jobCreateCalls[0]?.[0].data.sourceQuoteId).toBe('quote-1');
    const quoteUpdateCalls = tx.quote.update.mock.calls as unknown as Array<
      [
        {
          data: {
            convertedJobId: string;
            jobId: string;
            status: string;
          };
        },
      ]
    >;
    expect(quoteUpdateCalls[0]?.[0].data).toMatchObject({
      convertedJobId: 'job-converted-1',
      jobId: 'job-converted-1',
      status: 'CONVERTED',
    });
    expect(communications.quoteFinalised).toHaveBeenCalledWith(
      user.businessId,
      'quote-1',
    );
  });

  it('uses meaningful quote scope instead of generic quote title when converting to a job', async () => {
    const { prisma, tx } = createPrismaMock({
      acceptedAt: new Date('2026-08-10T00:00:00.000Z'),
      description: 'Replace switchboard safety fuse',
      job: null,
      jobId: null,
      relatedJob: null,
      relatedJobId: null,
      status: 'ACCEPTED',
      title: 'Quote for Archer',
    });
    const service = createService(prisma);

    await service.convertToJob(user, 'quote-1');

    const jobCreateCalls = tx.job.create.mock.calls as unknown as Array<
      [{ data: { title: string } }]
    >;
    expect(jobCreateCalls[0]?.[0].data.title).toBe(
      'Replace switchboard safety fuse',
    );
  });

  it('blocks technicians from creating quote drafts', async () => {
    const { prisma, quoteWithItems, sentQuote, tx } = createPrismaMock();
    prisma.quote.findFirst
      .mockResolvedValueOnce(quoteWithItems)
      .mockResolvedValueOnce(sentQuote);
    const service = createService(prisma);

    try {
      await service.create({ ...user, role: 'TECHNICIAN' }, payload);
      throw new Error('Expected technician quote creation to be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(403);
      expect((error as HttpException).getResponse()).toEqual({
        code: 'QUOTE_ACCESS_DENIED',
        message: 'You do not have permission to manage quotes.',
      });
    }
    expect(tx.quote.create).not.toHaveBeenCalled();
  });

  it('sends direct quote emails through configured Resend without customer communications being enabled', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      json: () => Promise.resolve({ id: 'em_quote_123' }),
      ok: true,
      status: 200,
    } as Response);
    type QuoteSentPayload = {
      businessId: string;
      createdBy: string;
      publicUrl: string;
      quoteId: string;
    };
    const { prisma, quoteWithItems, sentQuote, tx } = createPrismaMock();
    prisma.quote.findFirst
      .mockResolvedValueOnce(quoteWithItems)
      .mockResolvedValueOnce(sentQuote);
    const quoteSent = jest
      .fn<Promise<void>, [QuoteSentPayload]>()
      .mockResolvedValue(undefined);
    const communications = {
      quoteFinalised: jest.fn(),
      quoteSent,
    };
    const service = createService(prisma, communications, {
      APP_PUBLIC_URL: 'https://staging.tradieos.com',
      CUSTOMER_COMMUNICATIONS_ENABLED: 'false',
      EMAIL_FROM_ADDRESS: 'quotes@tradieos.com',
      EMAIL_FROM_NAME: 'TradieOS Staging',
      EMAIL_PROVIDER: ' resend ',
      RESEND_API_KEY: 're_test_key',
    });

    const response = await service.send(user, 'quote-1', {
      message: 'Please review this quote.',
      subject: 'Your quote is ready',
      to: 'sam@example.com',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
      }),
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
      from: 'TradieOS Staging <quotes@tradieos.com>',
      subject: 'Your quote is ready',
      to: 'sam@example.com',
    });
    expect(body.text).toContain('https://staging.tradieos.com/quote/');
    expect(
      tx.quote.update.mock.calls.some(
        ([input]) => input.data?.status === 'SENT',
      ),
    ).toBe(true);
    expect(tx.quotePdfDocument.create).toHaveBeenCalled();
    expect(tx.quotePublicAccessToken.create).toHaveBeenCalled();
    expect(quoteSent).toHaveBeenCalledTimes(1);
    const quoteSentPayload = quoteSent.mock.calls[0]?.[0];
    expect(quoteSentPayload).toEqual(
      expect.objectContaining({
        businessId: user.businessId,
        createdBy: user.id,
        quoteId: 'quote-1',
      }),
    );
    expect(quoteSentPayload?.publicUrl).toContain(
      'https://staging.tradieos.com/quote/',
    );
    expect(response.quote.status).toBe('SENT');
    expect(response.publicQuoteUrl).toContain(
      'https://staging.tradieos.com/quote/',
    );
  });

  it('keeps direct quote email local when console is configured outside production', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      json: () => Promise.resolve({ id: 'em_should_not_send' }),
      ok: true,
      status: 200,
    } as Response);
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    const { prisma } = createPrismaMock();
    const service = createService(prisma, undefined, {
      EMAIL_PROVIDER: 'console',
    });

    await service.send(user, 'quote-1', {
      message: 'Please review this quote.',
      subject: 'Quote Q-2026-000001 from Demo Tradie Co',
      to: 'sam@example.com',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      '[TradieOS email:TRANSACTIONAL]',
      expect.objectContaining({
        subject: 'Quote Q-2026-000001 from Demo Tradie Co',
        to: 'sam@example.com',
      }),
    );
  });

  it('fails safely for invalid direct quote email providers in production', () => {
    const { prisma } = createPrismaMock();

    expect(() =>
      createService(prisma, undefined, {
        EMAIL_FROM_ADDRESS: 'quotes@tradieos.com',
        EMAIL_PROVIDER: 'mailgun',
        NODE_ENV: 'production',
        RESEND_API_KEY: 're_test_key',
      }),
    ).toThrow(/Unsupported EMAIL_PROVIDER/);
  });

  it('shows public quote expiry and PDF metadata before customer response', async () => {
    const { prisma, pdfDocument } = createPrismaMock({
      expiryDate: new Date('2026-09-24T00:00:00.000Z'),
    });
    const service = createService(prisma);

    const response = await service.publicPreview('public-token', false);

    expect(response.quote.expiryDate).toBe('2026-09-24T00:00:00.000Z');
    expect(response.documents).toEqual([
      expect.objectContaining({
        fileName: pdfDocument.fileName,
        id: pdfDocument.id,
        mimeType: 'application/pdf',
      }),
    ]);
    expect(response.state).toBe('ACTIVE');
  });

  it('keeps public quote expiry and PDF metadata visible after acceptance', async () => {
    const acceptedAt = new Date('2026-08-12T00:00:00.000Z');
    const { prisma, publicToken, quoteWithItems } = createPrismaMock({
      acceptedAt,
      status: 'ACCEPTED',
    });
    prisma.quotePublicAccessToken.findUnique.mockResolvedValue({
      ...publicToken,
      acceptedAt,
      quote: quoteWithItems,
    });
    const service = createService(prisma);

    const response = await service.publicPreview('public-token', false);

    expect(response.state).toBe('ACCEPTED');
    expect(response.quote.expiryDate).toBe('2026-08-24T00:00:00.000Z');
    expect(response.documents).toHaveLength(1);
  });

  it('keeps public quote expiry visible after decline', async () => {
    const declinedAt = new Date('2026-08-12T00:00:00.000Z');
    const { prisma, publicToken, quoteWithItems } = createPrismaMock({
      declinedAt,
      status: 'DECLINED',
    });
    prisma.quotePublicAccessToken.findUnique.mockResolvedValue({
      ...publicToken,
      declinedAt,
      quote: quoteWithItems,
    });
    const service = createService(prisma);

    const response = await service.publicPreview('public-token', false);

    expect(response.state).toBe('DECLINED');
    expect(response.quote.expiryDate).toBe('2026-08-24T00:00:00.000Z');
  });

  it('serves public quote PDFs only after resolving the secure token', async () => {
    const { pdfDocument, prisma, publicQuotePdfFindFirst } = createPrismaMock();
    const service = createService(prisma);

    const pdf = await service.publicPdf('public-token');

    expect(prisma.quotePublicAccessToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenHash: publicTokenHash('public-token') },
      }),
    );
    const pdfLookup = publicQuotePdfFindFirst.mock.calls[0]?.[0];
    expect(pdfLookup?.where).toMatchObject({
      businessId: user.businessId,
      quoteId: 'quote-1',
      quoteRevisionId: 'revision-1',
      version: 1,
    });
    expect(pdf).toEqual({
      buffer: Buffer.from('%PDF-quote'),
      fileName: pdfDocument.fileName,
      mimeType: pdfDocument.mimeType,
    });
  });

  it('rejects public PDF access for invalid or expired tokens', async () => {
    const { prisma } = createPrismaMock();
    prisma.quotePublicAccessToken.findUnique.mockResolvedValueOnce(null);
    const service = createService(prisma);

    await expect(service.publicPdf('bad-token')).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.quotePdfDocument.findFirst).not.toHaveBeenCalled();
  });

  it('hides public View PDF metadata when no generated PDF exists', async () => {
    const { prisma } = createPrismaMock();
    prisma.quotePdfDocument.findFirst.mockResolvedValue(null);
    const service = createService(prisma);

    const response = await service.publicPreview('public-token', false);

    expect(response.documents).toEqual([]);
  });
});
