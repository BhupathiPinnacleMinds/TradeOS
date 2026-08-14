import {
  calculateInvoiceTotals,
  getInvoiceDisplayStatus,
  getInvoiceAvailableActions,
  validateInvoicePaymentAmount,
} from '@tradieos/shared';

describe('invoice calculations', () => {
  it('calculates GST exclusive taxable and non-taxable lines', () => {
    const result = calculateInvoiceTotals({
      lineItems: [
        {
          name: 'Labour',
          quantity: '2',
          taxable: true,
          type: 'LABOUR',
          unit: 'hour',
          unitPriceCents: 10000,
        },
        {
          name: 'Permit',
          quantity: '1',
          taxable: false,
          type: 'FEE',
          unit: 'item',
          unitPriceCents: 5000,
        },
      ],
      pricingMode: 'GST_EXCLUSIVE',
    });

    expect(result.subtotalCents).toBe(25000);
    expect(result.gstCents).toBe(2000);
    expect(result.totalCents).toBe(27000);
    expect(result.balanceDueCents).toBe(27000);
  });

  it('supports discounts, credits and partial payments', () => {
    const result = calculateInvoiceTotals({
      amountPaidCents: 4000,
      creditAppliedCents: 1000,
      discountType: 'FIXED',
      discountValue: 2000,
      lineItems: [
        {
          name: 'Service',
          quantity: '1',
          taxable: true,
          type: 'SERVICE',
          unit: 'item',
          unitPriceCents: 10000,
        },
      ],
      pricingMode: 'GST_EXCLUSIVE',
    });

    expect(result.discountCents).toBe(2000);
    expect(result.gstCents).toBe(800);
    expect(result.totalCents).toBe(8800);
    expect(result.balanceDueCents).toBe(3800);
  });

  it('derives overdue display status without persisting it', () => {
    expect(
      getInvoiceDisplayStatus(
        {
          balanceDueCents: 100,
          dueDate: '2026-01-01T00:00:00.000Z',
          status: 'SENT',
        },
        new Date('2026-01-03T00:00:00.000Z'),
      ),
    ).toBe('OVERDUE');
  });

  it.each([
    ['', 'Enter a payment amount.'],
    ['0', 'Payment amount must be greater than $0.'],
    ['-10', 'Payment amount must be greater than $0.'],
    ['abc', 'Enter a valid payment amount.'],
    ['.', 'Enter a valid payment amount.'],
    ['10.', 'Enter a valid payment amount.'],
  ])('blocks invalid payment amount "%s"', (amount, error) => {
    expect(
      validateInvoicePaymentAmount({
        amount,
        balanceDueCents: 88000,
        invoiceStatus: 'SENT',
      }),
    ).toEqual({ amountCents: null, error });
  });

  it('allows partial and exact-balance payments', () => {
    expect(
      validateInvoicePaymentAmount({
        amount: '100',
        balanceDueCents: 88000,
        invoiceStatus: 'SENT',
      }),
    ).toEqual({ amountCents: 10000, error: null });
    expect(
      validateInvoicePaymentAmount({
        amount: '880',
        balanceDueCents: 88000,
        invoiceStatus: 'SENT',
      }),
    ).toEqual({ amountCents: 88000, error: null });
  });

  it('blocks overpayment with the formatted remaining balance', () => {
    expect(
      validateInvoicePaymentAmount({
        amount: '1000',
        balanceDueCents: 88000,
        invoiceStatus: 'SENT',
      }),
    ).toEqual({
      amountCents: null,
      error: 'Payment cannot exceed the remaining balance of $880.00.',
    });
  });

  it.each([
    ['PAID' as const, 'This invoice has already been paid.'],
    ['VOID' as const, 'Payments cannot be recorded against a void invoice.'],
  ])('blocks %s invoices before payment submission', (invoiceStatus, error) => {
    expect(
      validateInvoicePaymentAmount({
        amount: '100',
        balanceDueCents: 88000,
        invoiceStatus,
      }),
    ).toEqual({ amountCents: null, error });
  });

  it('centralises available invoice actions by role, status and balance', () => {
    expect(
      getInvoiceAvailableActions({
        balanceDueCents: 88000,
        role: 'OWNER',
        status: 'DRAFT',
      }),
    ).toEqual(['EDIT', 'SEND', 'VIEW_PDF', 'VOID']);

    expect(
      getInvoiceAvailableActions({
        balanceDueCents: 44000,
        role: 'ACCOUNTANT',
        status: 'SENT',
      }),
    ).toEqual(['VIEW_PDF', 'RECORD_PAYMENT', 'VOID']);

    expect(
      getInvoiceAvailableActions({
        balanceDueCents: 0,
        role: 'ACCOUNTANT',
        status: 'PAID',
      }),
    ).toEqual(['VIEW_PDF']);

    expect(
      getInvoiceAvailableActions({
        balanceDueCents: 44000,
        role: 'TECHNICIAN',
        status: 'SENT',
      }),
    ).toEqual(['VIEW_PDF']);
  });
});
