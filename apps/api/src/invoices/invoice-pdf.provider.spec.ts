import type { Invoice, InvoicePayment } from '@tradieos/shared';
import { DeterministicInvoicePdfProvider } from './invoice-pdf.provider';

const invoice: Invoice = {
  amountPaidCents: 12500,
  balanceDueCents: 7500,
  businessId: 'business-1',
  createdAt: '2026-08-11T00:00:00.000Z',
  createdBy: 'user-1',
  creditAppliedCents: 0,
  currency: 'AUD',
  customer: {
    companyName: null,
    displayName: 'Raj Electrical',
    email: 'raj@example.com',
    id: 'customer-1',
    phone: '0400000000',
  },
  customerId: 'customer-1',
  customerNotes: 'Thank you.',
  customerSite: {
    addressLine1: '12 Collins Street',
    addressLine2: null,
    id: 'site-1',
    label: 'Shop',
    postcode: '3000',
    state: 'VIC',
    suburb: 'Melbourne',
  },
  customerSiteId: 'site-1',
  description: 'Switchboard repair',
  discountCents: 0,
  discountType: 'NONE',
  discountValue: 0,
  displayStatus: 'PARTIALLY_PAID',
  dueDate: '2026-08-25T00:00:00.000Z',
  gstCents: 1818,
  gstRateBasisPoints: 1000,
  id: 'invoice-internal-id',
  internalNotes: null,
  invoiceNumber: 'INV-2026-000123',
  issueDate: '2026-08-11T00:00:00.000Z',
  job: { id: 'job-1', jobNumber: 'JOB-2026-000045', title: 'Switchboard' },
  jobId: 'job-1',
  lineItems: [],
  paidAt: null,
  paymentTerms: 'Pay within 14 days.',
  pricingMode: 'GST_EXCLUSIVE',
  sentAt: '2026-08-11T00:00:00.000Z',
  sourceQuote: null,
  sourceQuoteId: null,
  status: 'PARTIALLY_PAID',
  subtotalCents: 20000,
  title: 'Switchboard repair',
  totalCents: 20000,
  updatedAt: '2026-08-11T00:00:00.000Z',
  updatedBy: 'user-1',
  version: 1,
  viewedAt: null,
  voidedAt: null,
};

const payment: InvoicePayment = {
  amountCents: 12500,
  businessId: 'business-1',
  createdAt: '2026-08-11T01:00:00.000Z',
  createdBy: 'user-1',
  createdByName: 'Demo Owner',
  id: 'payment-internal-id',
  invoiceId: 'invoice-internal-id',
  method: 'BANK_TRANSFER',
  notes: null,
  receiptDocument: null,
  receivedAt: '2026-08-11T01:00:00.000Z',
  reference: 'EFT-123',
  reversalReason: null,
  reversedAt: null,
};

const business = {
  abn: '12345678901',
  address: '1 Collins Street',
  email: 'accounts@demo-tradieos.com',
  gstRegistered: true,
  name: 'Demo Tradie Co',
  phone: '0399990000',
  postcode: '3000',
  state: 'VIC',
  suburb: 'Melbourne',
  timezone: 'Australia/Melbourne',
};

describe('DeterministicInvoicePdfProvider invoices', () => {
  it('formats invoice issue and due dates in the business timezone', () => {
    const provider = new DeterministicInvoicePdfProvider();
    const result = provider.generateInvoicePdf({
      business,
      invoice: {
        ...invoice,
        dueDate: '2026-09-17T14:00:00.000Z',
        issueDate: '2026-09-10T14:00:00.000Z',
      },
    });
    const text = result.buffer.toString('utf8');

    expect(text).toContain('Issue: 11/09/2026');
    expect(text).toContain('Due: 18/09/2026');
    expect(text).not.toContain('Issue: 10/09/2026');
    expect(text).not.toContain('Due: 17/09/2026');
  });

  it('uses the resolved service address supplied by the invoice service', () => {
    const provider = new DeterministicInvoicePdfProvider();
    const result = provider.generateInvoicePdf({
      business,
      invoice,
      serviceAddress: '21 Villite Ave, Tarneit, VIC, 3029',
    });
    const text = result.buffer.toString('utf8');

    expect(text).toContain(
      'Service address: 21 Villite Ave, Tarneit, VIC, 3029',
    );
    expect(text).not.toContain('Service address to be confirmed');
  });

  it('keeps internal invoice notes out of the customer-facing PDF', () => {
    const provider = new DeterministicInvoicePdfProvider();
    const result = provider.generateInvoicePdf({
      business,
      invoice: {
        ...invoice,
        internalNotes: 'Internal margin and scheduling notes.',
      },
    });
    const text = result.buffer.toString('utf8');

    expect(text).not.toContain('Internal margin and scheduling notes.');
  });
});

describe('DeterministicInvoicePdfProvider receipts', () => {
  it('generates deterministic customer-safe payment receipt PDFs', () => {
    const provider = new DeterministicInvoicePdfProvider();
    const input = {
      business,
      invoice,
      payment,
      receiptNumber: 'RCT-2026-000001',
    };

    const first = provider.generateReceiptPdf(input);
    const second = provider.generateReceiptPdf(input);
    const text = first.buffer.toString('utf8');

    expect(first.mimeType).toBe('application/pdf');
    expect(first.fileName).toBe('Receipt-RCT-2026-000001.pdf');
    expect(first.buffer.subarray(0, 8).toString('utf8')).toBe('%PDF-1.4');
    expect(first.checksum).toBe(second.checksum);
    expect(text).toContain('Payment Receipt');
    expect(text).toContain('Receipt: RCT-2026-000001');
    expect(text).toContain('Invoice: INV-2026-000123');
    expect(text).toContain('Payment amount: $125.00');
    expect(text).not.toContain('invoice-internal-id');
    expect(text).not.toContain('payment-internal-id');
  });
});
