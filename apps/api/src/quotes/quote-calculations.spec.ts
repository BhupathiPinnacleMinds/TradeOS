import {
  calculateQuoteTotals,
  formatAudCents,
  type QuoteCalculationInput,
} from '@tradieos/shared';

const base = (
  input: Partial<QuoteCalculationInput>,
): QuoteCalculationInput => ({
  depositType: 'NONE',
  discountType: 'NONE',
  gstRateBasisPoints: 1000,
  lineItems: [
    {
      name: 'Labour',
      quantity: '1',
      taxable: true,
      type: 'LABOUR',
      unit: 'hour',
      unitPriceCents: 10000,
    },
  ],
  pricingMode: 'GST_EXCLUSIVE',
  ...input,
});

describe('quote calculations', () => {
  it('calculates GST exclusive taxable items', () => {
    const result = calculateQuoteTotals(base({}));

    expect(result.subtotalCents).toBe(10000);
    expect(result.gstCents).toBe(1000);
    expect(result.totalCents).toBe(11000);
  });

  it('calculates GST inclusive taxable items', () => {
    const result = calculateQuoteTotals(
      base({
        lineItems: [
          {
            name: 'Service',
            quantity: '1',
            taxable: true,
            type: 'SERVICE',
            unit: 'fixed',
            unitPriceCents: 11000,
          },
        ],
        pricingMode: 'GST_INCLUSIVE',
      }),
    );

    expect(result.subtotalCents).toBe(10000);
    expect(result.gstCents).toBe(1000);
    expect(result.totalCents).toBe(11000);
  });

  it('supports mixed taxable and non-taxable lines', () => {
    const result = calculateQuoteTotals(
      base({
        lineItems: [
          {
            name: 'Taxable labour',
            quantity: '2',
            taxable: true,
            type: 'LABOUR',
            unit: 'hour',
            unitPriceCents: 10000,
          },
          {
            name: 'Non-taxable permit',
            quantity: '1',
            taxable: false,
            type: 'FEE',
            unit: 'item',
            unitPriceCents: 5000,
          },
        ],
      }),
    );

    expect(result.subtotalCents).toBe(25000);
    expect(result.gstCents).toBe(2000);
    expect(result.totalCents).toBe(27000);
  });

  it('applies fixed discounts before GST', () => {
    const result = calculateQuoteTotals(
      base({ discountType: 'FIXED', discountValue: 1000 }),
    );

    expect(result.discountCents).toBe(1000);
    expect(result.gstCents).toBe(900);
    expect(result.totalCents).toBe(9900);
  });

  it('applies percentage discounts in basis points', () => {
    const result = calculateQuoteTotals(
      base({ discountType: 'PERCENTAGE', discountValue: 2500 }),
    );

    expect(result.discountCents).toBe(2500);
    expect(result.gstCents).toBe(750);
    expect(result.totalCents).toBe(8250);
  });

  it('calculates fixed deposits', () => {
    const result = calculateQuoteTotals(
      base({ depositType: 'FIXED', depositValue: 5000 }),
    );

    expect(result.depositCents).toBe(5000);
  });

  it('calculates percentage deposits in basis points', () => {
    const result = calculateQuoteTotals(
      base({ depositType: 'PERCENTAGE', depositValue: 5000 }),
    );

    expect(result.depositCents).toBe(5500);
  });

  it('rounds cents deterministically for fractional quantities', () => {
    const result = calculateQuoteTotals(
      base({
        lineItems: [
          {
            name: 'Short labour',
            quantity: '1.333',
            taxable: true,
            type: 'LABOUR',
            unit: 'hour',
            unitPriceCents: 9999,
          },
        ],
      }),
    );

    expect(result.subtotalCents).toBe(13329);
    expect(result.gstCents).toBe(1333);
  });

  it('supports zero-price items', () => {
    const result = calculateQuoteTotals(
      base({
        lineItems: [
          {
            name: 'Warranty check',
            quantity: '1',
            taxable: true,
            type: 'SERVICE',
            unit: 'fixed',
            unitPriceCents: 0,
          },
        ],
      }),
    );

    expect(result.totalCents).toBe(0);
  });

  it('formats Australian dollars from cents', () => {
    expect(formatAudCents(123456)).toBe('$1,234.56');
  });
});
