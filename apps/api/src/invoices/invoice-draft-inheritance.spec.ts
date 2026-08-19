import type { AuthenticatedUser } from '@tradieos/shared';
import { calculateInvoiceTotals } from '@tradieos/shared';
import { InvoicesService } from './invoices.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

const owner: AuthenticatedUser = {
  businessId: 'business-1',
  email: 'owner@demo-tradieos.com',
  id: 'owner-1',
  role: 'OWNER',
};

const job = {
  customerId: 'customer-archer',
  id: 'job-40',
  jobNumber: 'JOB-2026-000040',
  sourceQuoteId: 'quote-1018',
  title: 'Kitchen tap replacement',
};

const customer = {
  displayName: 'Archer',
  id: 'customer-archer',
};

const sourceQuote = {
  businessId: 'business-1',
  convertedJobId: 'job-40',
  customerId: 'customer-archer',
  customerNotes: 'Please invoice accepted scope.',
  customerSiteId: 'site-archer',
  description: 'Replace kitchen mixer tap.',
  discountType: 'NONE',
  discountValue: 0,
  gstRateBasisPoints: 1000,
  id: 'quote-1018',
  jobId: 'job-40',
  lineItems: [
    {
      description: null,
      name: 'Labour',
      quantity: '1.5',
      taxable: true,
      type: 'LABOUR',
      unit: 'hour',
      unitPriceCents: 15000,
    },
    {
      description: null,
      name: 'Materials',
      quantity: '1',
      taxable: true,
      type: 'MATERIAL',
      unit: 'item',
      unitPriceCents: 12000,
    },
  ],
  pricingMode: 'GST_EXCLUSIVE',
  quoteNumber: 'Q-2026-001018',
  relatedJobId: null,
  status: 'CONVERTED',
  title: 'Kitchen tap replacement',
  totalCents: 37950,
};

describe('InvoicesService draft source quote inheritance', () => {
  let prisma: MockPrisma;
  let service: InvoicesService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-18T00:00:00.000Z'));
    prisma = createPrismaMock();
    service = new InvoicesService(
      prisma as never,
      {} as never,
      {} as never,
      {
        invoiceClosed: jest.fn(),
        invoiceSent: jest.fn(),
        paymentRecorded: jest.fn(),
      } as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('initialises invoice draft commercial data from the accepted converted source quote', async () => {
    const result = await service.draft(owner, {
      customerId: 'customer-archer',
      jobId: 'job-40',
      sourceQuoteId: 'quote-1018',
    });

    expect(result.source).toBe('SOURCE_QUOTE');
    expect(result.job).toEqual({
      id: 'job-40',
      jobNumber: 'JOB-2026-000040',
      title: 'Kitchen tap replacement',
    });
    expect(result.sourceQuote).toMatchObject({
      id: 'quote-1018',
      quoteNumber: 'Q-2026-001018',
    });
    expect(result.draft).toMatchObject({
      customerId: 'customer-archer',
      customerSiteId: 'site-archer',
      jobId: 'job-40',
      pricingMode: 'GST_EXCLUSIVE',
      sourceQuoteId: 'quote-1018',
    });
    expect(result.draft.lineItems).toEqual([
      {
        description: undefined,
        name: 'Labour',
        quantity: '1.5',
        taxable: true,
        type: 'LABOUR',
        unit: 'hour',
        unitPriceCents: 15000,
      },
      {
        description: undefined,
        name: 'Materials',
        quantity: '1',
        taxable: true,
        type: 'MATERIAL',
        unit: 'item',
        unitPriceCents: 12000,
      },
    ]);
    expect(
      calculateInvoiceTotals({
        discountType: result.draft.discountType,
        discountValue: result.draft.discountValue,
        gstRateBasisPoints: result.draft.gstRateBasisPoints,
        lineItems: result.draft.lineItems,
        pricingMode: result.draft.pricingMode,
      }),
    ).toMatchObject({
      gstCents: 3450,
      subtotalCents: 34500,
      totalCents: 37950,
    });
  });

  it('preserves decimal quantities and separate material lines', async () => {
    const result = await service.draft(owner, {
      customerId: 'customer-archer',
      jobId: 'job-40',
    });

    expect(result.draft.lineItems).toHaveLength(2);
    expect(result.draft.lineItems[0]).toMatchObject({
      name: 'Labour',
      quantity: '1.5',
      unitPriceCents: 15000,
    });
    expect(result.draft.lineItems[1]).toMatchObject({
      name: 'Materials',
      quantity: '1',
      type: 'MATERIAL',
      unitPriceCents: 12000,
    });
  });

  it('keeps normal non-quote job invoice defaults available', async () => {
    prisma.job.findFirst.mockResolvedValueOnce({
      ...job,
      sourceQuoteId: null,
    });

    const result = await service.draft(owner, {
      customerId: 'customer-archer',
      jobId: 'job-40',
    });

    expect(result.source).toBe('JOB_DEFAULT');
    expect(result.sourceQuote).toBeNull();
    expect(result.draft.lineItems).toEqual([
      {
        name: 'Labour',
        quantity: '1',
        taxable: true,
        type: 'LABOUR',
        unit: 'hour',
        unitPriceCents: 12000,
      },
    ]);
  });

  it('rejects source quotes that do not belong to the selected job chain', async () => {
    prisma.job.findFirst.mockResolvedValueOnce({
      ...job,
      sourceQuoteId: null,
    });
    prisma.quote.findFirst.mockResolvedValueOnce({
      ...sourceQuote,
      convertedJobId: 'other-job',
      jobId: null,
    });

    await expect(
      service.draft(owner, {
        customerId: 'customer-archer',
        jobId: 'job-40',
        sourceQuoteId: 'quote-1018',
      }),
    ).rejects.toMatchObject({
      response: { code: 'INVOICE_SOURCE_MISMATCH' },
    });
  });

  it('tenant-scopes customer, job and source quote resolution', async () => {
    await service.draft(owner, {
      customerId: 'customer-archer',
      jobId: 'job-40',
      sourceQuoteId: 'quote-1018',
    });

    expect(prisma.job.findFirst).toHaveBeenCalledWith({
      where: {
        businessId: 'business-1',
        customerId: 'customer-archer',
        id: 'job-40',
        isArchived: false,
      },
      select: {
        customerId: true,
        id: true,
        jobNumber: true,
        sourceQuoteId: true,
        title: true,
      },
    });
    expect(prisma.customer.findFirst).toHaveBeenCalledWith({
      where: {
        businessId: 'business-1',
        id: 'customer-archer',
        isArchived: false,
      },
      select: { displayName: true, id: true },
    });
    expect(prisma.quote.findFirst).toHaveBeenCalledWith({
      include: { lineItems: { orderBy: { position: 'asc' } } },
      where: {
        businessId: 'business-1',
        customerId: 'customer-archer',
        id: 'quote-1018',
        status: { in: ['ACCEPTED', 'CONVERTED'] },
      },
    });
  });
});

function createPrismaMock(): MockPrisma {
  return {
    customer: {
      findFirst: jest.fn().mockResolvedValue(customer),
    },
    job: {
      findFirst: jest.fn().mockResolvedValue(job),
    },
    quote: {
      findFirst: jest.fn().mockResolvedValue(sourceQuote),
    },
  };
}

type MockPrisma = {
  customer: {
    findFirst: jest.Mock;
  };
  job: {
    findFirst: jest.Mock;
  };
  quote: {
    findFirst: jest.Mock;
  };
};
