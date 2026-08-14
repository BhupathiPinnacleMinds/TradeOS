import type { Quote } from '@tradieos/shared';
import { DeterministicQuotePdfProvider } from './quote-pdf.provider';

const quote: Quote = {
  acceptedAt: null,
  acceptedByEmail: null,
  acceptedByName: null,
  acceptedQuoteVersion: null,
  archivedAt: null,
  businessId: 'business-1',
  cancelledAt: null,
  convertedAt: null,
  convertedJob: null,
  convertedJobId: null,
  createdAt: '2026-08-10T00:00:00.000Z',
  createdBy: 'user-1',
  currency: 'AUD',
  customer: {
    companyName: null,
    displayName: 'GB',
    email: 'gb@example.com',
    id: 'customer-1',
    phone: '0400000000',
  },
  customerId: 'customer-1',
  customerNotes: 'Please approve before work starts.',
  customerSite: {
    addressLine1: '16 Coffey Street',
    addressLine2: null,
    id: 'site-1',
    label: 'Appointment address',
    postcode: '3029',
    state: 'VIC',
    suburb: 'Tarneit',
  },
  customerSiteId: 'site-1',
  declinedAt: null,
  declineComment: null,
  declineReason: null,
  depositCents: 0,
  depositType: 'NONE',
  depositValue: 0,
  description: 'Please fix laundry leak.',
  discountCents: 0,
  discountType: 'NONE',
  discountValue: 0,
  expiredAt: null,
  expiryDate: '2026-08-24T00:00:00.000Z',
  firstViewedAt: null,
  gstCents: 3300,
  gstRateBasisPoints: 1000,
  id: 'quote-1',
  internalNotes: null,
  issueDate: '2026-08-10T00:00:00.000Z',
  job: { id: 'job-1', jobNumber: 'JOB-2026-000012', title: 'Laundry Leak' },
  jobId: 'job-1',
  latestViewedAt: null,
  lineItems: [
    {
      businessId: 'business-1',
      createdAt: '2026-08-10T00:00:00.000Z',
      description: null,
      id: 'line-1',
      lineGstCents: 2500,
      lineSubtotalCents: 25000,
      lineTotalCents: 27500,
      name: 'Labour',
      position: 0,
      quantity: '2.5',
      quoteId: 'quote-1',
      taxable: true,
      type: 'LABOUR',
      unit: 'hour',
      unitPriceCents: 10000,
      updatedAt: '2026-08-10T00:00:00.000Z',
    },
    {
      businessId: 'business-1',
      createdAt: '2026-08-10T00:00:00.000Z',
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
      updatedAt: '2026-08-10T00:00:00.000Z',
    },
  ],
  pricingMode: 'GST_EXCLUSIVE',
  quoteNumber: 'Q-2026-001006',
  relatedJob: {
    id: 'job-1',
    jobNumber: 'JOB-2026-000012',
    title: 'Laundry Leak',
  },
  relatedJobId: 'job-1',
  sentAt: null,
  sourceAppointmentId: null,
  status: 'DRAFT',
  subtotalCents: 33000,
  termsAndConditions: 'Valid for 14 days. '.repeat(80),
  title: 'Laundry leak',
  totalCents: 36300,
  updatedAt: '2026-08-10T00:00:00.000Z',
  updatedBy: 'user-1',
  version: 1,
  viewCount: 0,
  viewedAt: null,
};

describe('DeterministicQuotePdfProvider', () => {
  it('generates deterministic application/pdf bytes from a frozen quote', () => {
    const provider = new DeterministicQuotePdfProvider();
    const input = {
      business: {
        abn: '12345678901',
        address: '1 Collins Street',
        email: 'hello@example.com',
        name: 'Demo Tradie Co',
        phone: '0399990000',
        postcode: '3000',
        state: 'VIC',
        suburb: 'Melbourne',
      },
      quote,
    };

    const first = provider.generateQuotePdf(input);
    const second = provider.generateQuotePdf(input);

    expect(first.mimeType).toBe('application/pdf');
    expect(first.fileName).toBe('Quote-Q-2026-001006.pdf');
    expect(first.buffer.subarray(0, 8).toString('utf8')).toBe('%PDF-1.4');
    expect(first.checksum).toBe(second.checksum);
    expect(first.buffer.equals(second.buffer)).toBe(true);
  });

  it('renders saved discounted totals from the frozen quote snapshot', () => {
    const provider = new DeterministicQuotePdfProvider();
    const result = provider.generateQuotePdf({
      business: {
        abn: '12345678901',
        address: '1 Collins Street',
        email: 'hello@example.com',
        name: 'Demo Tradie Co',
        phone: '0399990000',
        postcode: '3000',
        state: 'VIC',
        suburb: 'Melbourne',
      },
      quote: {
        ...quote,
        discountCents: 5000,
        discountType: 'FIXED',
        discountValue: 5000,
        gstCents: 2800,
        totalCents: 30800,
      },
    });
    const pdfText = result.buffer.toString('utf8');

    expect(pdfText).toContain('Discount: $50.00');
    expect(pdfText).toContain('GST: $28.00');
    expect(pdfText).toContain('Total: $308.00');
  });

  it('supports multi-page quote PDFs for long terms', () => {
    const provider = new DeterministicQuotePdfProvider();
    const result = provider.generateQuotePdf({
      business: {
        abn: '12345678901',
        address: '1 Collins Street',
        email: 'hello@example.com',
        name: 'Demo Tradie Co',
        phone: '0399990000',
        postcode: '3000',
        state: 'VIC',
        suburb: 'Melbourne',
      },
      quote: {
        ...quote,
        termsAndConditions: 'Detailed customer-facing terms. '.repeat(300),
      },
    });
    const pdfText = result.buffer.toString('utf8');

    const pageCount = pdfText.match(/\/Type \/Page\b/g)?.length ?? 0;

    expect(pdfText).toContain('/Type /Pages');
    expect(pageCount).toBeGreaterThan(1);
  });
});
