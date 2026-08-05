import type { BusinessRole } from './auth';
import type { AuditLogEntry } from './members';
import type { SortOrder } from './customers';

export const QUOTE_STATUSES = [
  'DRAFT',
  'SENT',
  'VIEWED',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'CONVERTED',
] as const;

export const QUOTE_LINE_ITEM_TYPES = [
  'LABOUR',
  'MATERIAL',
  'SERVICE',
  'FEE',
  'DISCOUNT',
  'OTHER',
] as const;

export const QUOTE_PRICING_MODES = ['GST_EXCLUSIVE', 'GST_INCLUSIVE'] as const;

export const QUOTE_DISCOUNT_TYPES = ['NONE', 'FIXED', 'PERCENTAGE'] as const;
export const QUOTE_DEPOSIT_TYPES = ['NONE', 'FIXED', 'PERCENTAGE'] as const;

export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export type QuoteLineItemType = (typeof QUOTE_LINE_ITEM_TYPES)[number];
export type QuotePricingMode = (typeof QUOTE_PRICING_MODES)[number];
export type QuoteDiscountType = (typeof QUOTE_DISCOUNT_TYPES)[number];
export type QuoteDepositType = (typeof QUOTE_DEPOSIT_TYPES)[number];

export type QuoteSortBy = 'createdAt' | 'expiryDate' | 'totalCents' | 'status';

export const DEFAULT_QUOTE_GST_RATE_BASIS_POINTS = 1000;
export const QUOTE_TERMINAL_STATUSES: QuoteStatus[] = [
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'CONVERTED',
];

export const QUOTE_STATUS_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['VIEWED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'DRAFT'],
  VIEWED: ['ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'DRAFT'],
  ACCEPTED: ['CONVERTED'],
  DECLINED: [],
  EXPIRED: [],
  CANCELLED: [],
  CONVERTED: [],
};

export const QUOTE_VIEW_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
  'TECHNICIAN',
  'ACCOUNTANT',
  'SALES',
  'READ_ONLY',
];

export const QUOTE_CREATE_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
  'TECHNICIAN',
  'SALES',
];

export const QUOTE_EDIT_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SALES',
];

export const QUOTE_SEND_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SALES',
];

export const QUOTE_CONVERT_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SALES',
];

export const QUOTE_CANCEL_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
];

export function roleCanViewQuotes(role: BusinessRole) {
  return QUOTE_VIEW_ROLES.includes(role);
}

export function roleCanCreateQuotes(role: BusinessRole) {
  return QUOTE_CREATE_ROLES.includes(role);
}

export function roleCanEditQuote(role: BusinessRole, status: QuoteStatus) {
  return QUOTE_EDIT_ROLES.includes(role) && status === 'DRAFT';
}

export function roleCanSendQuote(role: BusinessRole, status: QuoteStatus) {
  return QUOTE_SEND_ROLES.includes(role) && status === 'DRAFT';
}

export function roleCanReviseQuote(role: BusinessRole, status: QuoteStatus) {
  return QUOTE_EDIT_ROLES.includes(role) && ['SENT', 'VIEWED'].includes(status);
}

export function roleCanConvertQuote(role: BusinessRole, status: QuoteStatus) {
  return QUOTE_CONVERT_ROLES.includes(role) && status === 'ACCEPTED';
}

export function roleCanCancelQuote(role: BusinessRole, status: QuoteStatus) {
  return (
    QUOTE_CANCEL_ROLES.includes(role) &&
    ['DRAFT', 'SENT', 'VIEWED'].includes(status)
  );
}

export function canTransitionQuoteStatus(from: QuoteStatus, to: QuoteStatus) {
  return QUOTE_STATUS_TRANSITIONS[from].includes(to);
}

export interface QuoteCustomerSummary {
  id: string;
  displayName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
}

export interface QuoteJobSummary {
  id: string;
  jobNumber: string;
  title: string;
}

export interface QuoteSiteSummary {
  id: string;
  label: string;
  addressLine1: string;
  addressLine2: string | null;
  suburb: string;
  state: string;
  postcode: string;
}

export interface QuoteLineItem {
  id: string;
  businessId: string;
  quoteId: string;
  position: number;
  type: QuoteLineItemType;
  name: string;
  description: string | null;
  quantity: string;
  unit: string;
  unitPriceCents: number;
  taxable: boolean;
  lineSubtotalCents: number;
  lineGstCents: number;
  lineTotalCents: number;
  createdAt: string;
  updatedAt: string;
}

export interface Quote {
  id: string;
  businessId: string;
  quoteNumber: string;
  customerId: string;
  customerSiteId: string | null;
  jobId: string | null;
  sourceAppointmentId: string | null;
  status: QuoteStatus;
  title: string;
  description: string | null;
  issueDate: string;
  expiryDate: string | null;
  currency: 'AUD';
  pricingMode: QuotePricingMode;
  gstRateBasisPoints: number;
  subtotalCents: number;
  discountType: QuoteDiscountType;
  discountValue: number;
  discountCents: number;
  gstCents: number;
  totalCents: number;
  depositType: QuoteDepositType;
  depositValue: number;
  depositCents: number;
  customerNotes: string | null;
  internalNotes: string | null;
  termsAndConditions: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  expiredAt: string | null;
  cancelledAt: string | null;
  convertedAt: string | null;
  acceptedByName: string | null;
  acceptedByEmail: string | null;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  customer: QuoteCustomerSummary;
  customerSite: QuoteSiteSummary | null;
  job: QuoteJobSummary | null;
  lineItems: QuoteLineItem[];
}

export interface QuoteListResponse {
  records: Quote[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface QuoteDetailResponse {
  quote: Quote;
  activity: AuditLogEntry[];
}

export interface QuoteLineItemPayload {
  id?: string;
  type: QuoteLineItemType;
  name: string;
  description?: string;
  quantity: string | number;
  unit: string;
  unitPriceCents: number;
  taxable: boolean;
}

export interface QuotePayload {
  customerId: string;
  customerSiteId?: string | null;
  jobId?: string | null;
  sourceAppointmentId?: string | null;
  title: string;
  description?: string;
  issueDate: string;
  expiryDate?: string | null;
  pricingMode: QuotePricingMode;
  gstRateBasisPoints?: number;
  discountType?: QuoteDiscountType;
  discountValue?: number;
  depositType?: QuoteDepositType;
  depositValue?: number;
  customerNotes?: string;
  internalNotes?: string;
  termsAndConditions?: string;
  lineItems: QuoteLineItemPayload[];
}

export interface QuoteListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: QuoteStatus;
  customerId?: string;
  createdBy?: string;
  dateFrom?: string;
  dateTo?: string;
  expired?: string;
  sortBy?: QuoteSortBy;
  sortOrder?: SortOrder;
}

export interface QuoteCalculationInput {
  lineItems: QuoteLineItemPayload[];
  pricingMode: QuotePricingMode;
  gstRateBasisPoints?: number;
  discountType?: QuoteDiscountType;
  discountValue?: number;
  depositType?: QuoteDepositType;
  depositValue?: number;
}

export interface CalculatedQuoteLineItem extends QuoteLineItemPayload {
  quantity: string;
  lineSubtotalCents: number;
  lineGstCents: number;
  lineTotalCents: number;
}

export interface QuoteCalculationResult {
  lineItems: CalculatedQuoteLineItem[];
  subtotalCents: number;
  discountCents: number;
  gstCents: number;
  totalCents: number;
  depositCents: number;
}

export function formatAudCents(cents: number) {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}$${Math.floor(absolute / 100).toLocaleString('en-AU')}.${String(
    absolute % 100,
  ).padStart(2, '0')}`;
}

export function calculateQuoteTotals(
  input: QuoteCalculationInput,
): QuoteCalculationResult {
  const gstRateBasisPoints =
    input.gstRateBasisPoints ?? DEFAULT_QUOTE_GST_RATE_BASIS_POINTS;
  const lines = input.lineItems.map((item) =>
    calculateQuoteLine(item, input.pricingMode, gstRateBasisPoints),
  );
  const subtotalCents = lines.reduce(
    (sum, item) => sum + item.lineSubtotalCents,
    0,
  );
  const taxableBaseCents = lines
    .filter((item) => item.taxable)
    .reduce((sum, item) => sum + item.lineSubtotalCents, 0);
  const discountCents = calculateAdjustmentCents(
    input.discountType ?? 'NONE',
    input.discountValue ?? 0,
    subtotalCents,
  );
  const taxableDiscountCents =
    subtotalCents === 0
      ? 0
      : roundDiv(discountCents * taxableBaseCents, subtotalCents);
  const discountedTaxableBase = Math.max(
    0,
    taxableBaseCents - taxableDiscountCents,
  );
  const gstCents = roundDiv(discountedTaxableBase * gstRateBasisPoints, 10000);
  const totalCents = Math.max(0, subtotalCents - discountCents + gstCents);
  const depositCents = calculateAdjustmentCents(
    input.depositType ?? 'NONE',
    input.depositValue ?? 0,
    totalCents,
  );

  return {
    depositCents: Math.min(depositCents, totalCents),
    discountCents: Math.min(discountCents, subtotalCents),
    gstCents: Math.max(0, gstCents),
    lineItems: lines,
    subtotalCents,
    totalCents,
  };
}

function calculateQuoteLine(
  item: QuoteLineItemPayload,
  pricingMode: QuotePricingMode,
  gstRateBasisPoints: number,
): CalculatedQuoteLineItem {
  const quantity = normaliseQuantity(item.quantity);
  const quantityMillis = quantityToMillis(quantity);
  const subtotalOrInclusiveCents = roundDiv(
    quantityMillis * item.unitPriceCents,
    1000,
  );
  const lineGstCents =
    item.taxable && pricingMode === 'GST_INCLUSIVE'
      ? roundDiv(
          subtotalOrInclusiveCents * gstRateBasisPoints,
          10000 + gstRateBasisPoints,
        )
      : item.taxable
        ? roundDiv(subtotalOrInclusiveCents * gstRateBasisPoints, 10000)
        : 0;
  const lineSubtotalCents =
    pricingMode === 'GST_INCLUSIVE'
      ? subtotalOrInclusiveCents - lineGstCents
      : subtotalOrInclusiveCents;
  const lineTotalCents =
    pricingMode === 'GST_INCLUSIVE'
      ? subtotalOrInclusiveCents
      : lineSubtotalCents + lineGstCents;

  return {
    ...item,
    lineGstCents,
    lineSubtotalCents,
    lineTotalCents,
    quantity,
  };
}

function calculateAdjustmentCents(
  type: QuoteDiscountType | QuoteDepositType,
  value: number,
  baseCents: number,
) {
  if (type === 'NONE' || value <= 0) return 0;
  if (type === 'FIXED') return Math.min(Math.round(value), baseCents);
  return Math.min(roundDiv(baseCents * value, 10000), baseCents);
}

function normaliseQuantity(value: string | number) {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,3})?$/.test(text)) {
    throw new Error(
      'Quantity must be a positive number with up to 3 decimals.',
    );
  }
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

function quantityToMillis(value: string) {
  const [whole, decimal = ''] = value.split('.');
  return Number(whole) * 1000 + Number(decimal.padEnd(3, '0'));
}

function roundDiv(numerator: number, denominator: number) {
  return Math.floor((numerator + denominator / 2) / denominator);
}
