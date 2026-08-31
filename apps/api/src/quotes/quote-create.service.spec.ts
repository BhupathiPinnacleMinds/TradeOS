import { HttpException } from '@nestjs/common';
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

function createPrismaMock(quoteOverrides: Record<string, unknown> = {}) {
  const createdQuote = quoteRecord({ ...quoteOverrides, lineItems: [] });
  const quoteWithItems = quoteRecord(quoteOverrides);
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
      update: jest.fn().mockResolvedValue(
        quoteRecord({
          ...quoteOverrides,
          convertedAt: new Date('2026-08-10T00:00:00.000Z'),
          convertedJobId: 'job-converted-1',
          jobId: 'job-converted-1',
          status: 'CONVERTED',
        }),
      ),
    },
    quoteLineItem: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
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
    customer: { findFirst: jest.fn().mockResolvedValue({ id: 'customer-1' }) },
    customerSite: { findFirst: jest.fn().mockResolvedValue({ id: 'site-1' }) },
    job: { findFirst: jest.fn().mockResolvedValue({ id: 'job-1' }) },
    quote: { findFirst: jest.fn().mockResolvedValue(quoteWithItems) },
    quotePdfDocument: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { prisma, quoteCreate, tx };
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
) {
  return new QuotesService(
    prisma as never,
    { get: jest.fn() } as never,
    {
      createObjectKey: jest.fn(),
      createUploadTarget: jest.fn(),
      deleteObject: jest.fn(),
      completeUpload: jest.fn(),
      getObjectMetadata: jest.fn(),
      getSignedDownloadUrl: jest.fn(),
      getSignedPreviewUrl: jest.fn(),
      name: 'local',
      objectExists: jest.fn(),
      readObject: jest.fn(),
      uploadFile: jest.fn(),
    },
    communications as never,
    { createForRoles: jest.fn() } as never,
  );
}

describe('QuotesService create', () => {
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
    const { prisma, tx } = createPrismaMock();
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
});
