import type { BusinessRole } from './auth';
import type { SortOrder } from './customers';
import type {
  QuoteDiscountType,
  QuoteLineItemType,
  QuotePricingMode,
} from './quotes';
import {
  DEFAULT_QUOTE_GST_RATE_BASIS_POINTS,
  formatAudCents,
  parseQuoteMoneyInput,
  parseQuoteQuantityInput,
} from './quotes';

export const INVOICE_STATUSES = [
  'DRAFT',
  'SENT',
  'VIEWED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'VOID',
] as const;

export const INVOICE_LINE_ITEM_TYPES = [
  'LABOUR',
  'MATERIAL',
  'SERVICE',
  'FEE',
  'OTHER',
] as const;

export const INVOICE_PAYMENT_METHODS = [
  'CASH',
  'CARD',
  'BANK_TRANSFER',
  'EFTPOS',
  'CHEQUE',
  'OTHER',
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type InvoiceDisplayStatus = InvoiceStatus;
export type InvoiceLineItemType = (typeof INVOICE_LINE_ITEM_TYPES)[number];
export type InvoicePaymentMethod = (typeof INVOICE_PAYMENT_METHODS)[number];
export type InvoicePricingMode = QuotePricingMode;
export type InvoiceDiscountType = QuoteDiscountType;
export type InvoiceSortBy = 'createdAt' | 'dueDate' | 'totalCents' | 'status';

export const INVOICE_PRICING_MODES = [
  'GST_EXCLUSIVE',
  'GST_INCLUSIVE',
] as const;
export const INVOICE_DISCOUNT_TYPES = ['NONE', 'FIXED', 'PERCENTAGE'] as const;
export const DEFAULT_INVOICE_GST_RATE_BASIS_POINTS =
  DEFAULT_QUOTE_GST_RATE_BASIS_POINTS;

export const INVOICE_MUTABLE_STATUSES: InvoiceStatus[] = ['DRAFT'];
export const INVOICE_OPEN_STATUSES: InvoiceStatus[] = [
  'SENT',
  'VIEWED',
  'PARTIALLY_PAID',
  'OVERDUE',
];

export const INVOICE_STATUS_TRANSITIONS: Record<
  InvoiceStatus,
  InvoiceStatus[]
> = {
  DRAFT: ['SENT', 'VOID'],
  SENT: ['VIEWED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID'],
  VIEWED: ['PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID'],
  PARTIALLY_PAID: ['PAID', 'OVERDUE', 'VOID'],
  PAID: [],
  OVERDUE: ['PARTIALLY_PAID', 'PAID', 'VOID'],
  VOID: [],
};

export const INVOICE_VIEW_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
  'TECHNICIAN',
  'ACCOUNTANT',
  'SALES',
  'READ_ONLY',
];

export const INVOICE_CREATE_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'ACCOUNTANT',
  'SALES',
];

export const INVOICE_EDIT_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'ACCOUNTANT',
  'SALES',
];

export const INVOICE_SEND_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'ACCOUNTANT',
  'SALES',
];

export const INVOICE_PAYMENT_WRITE_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'ACCOUNTANT',
];

export const ACCOUNTS_RECEIVABLE_VIEW_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'ACCOUNTANT',
  'READ_ONLY',
];

export const INVOICE_VOID_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'ACCOUNTANT',
];

export interface InvoiceCustomerSummary {
  id: string;
  displayName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
}

export interface InvoiceJobSummary {
  id: string;
  jobNumber: string;
  title: string;
}

export interface InvoiceQuoteSummary {
  id: string;
  quoteNumber: string;
  title: string;
  totalCents: number;
  status: string;
}

export interface InvoiceSiteSummary {
  id: string;
  label: string;
  addressLine1: string;
  addressLine2: string | null;
  suburb: string;
  state: string;
  postcode: string;
}

export interface InvoiceLineItem {
  id: string;
  businessId: string;
  invoiceId: string;
  position: number;
  type: InvoiceLineItemType;
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

export interface InvoicePayment {
  id: string;
  businessId: string;
  invoiceId: string;
  amountCents: number;
  method: InvoicePaymentMethod;
  reference: string | null;
  receivedAt: string;
  notes: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  reversedAt: string | null;
  reversalReason: string | null;
  receiptDocument: InvoiceReceiptDocumentSummary | null;
}

export interface InvoiceReceiptDocumentSummary {
  id: string;
  paymentId: string;
  invoiceId: string;
  receiptNumber: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  generatedAt: string;
}

export interface Invoice {
  id: string;
  businessId: string;
  invoiceNumber: string;
  customerId: string;
  customerSiteId: string | null;
  jobId: string | null;
  sourceQuoteId: string | null;
  status: InvoiceStatus;
  displayStatus: InvoiceDisplayStatus;
  title: string;
  description: string | null;
  issueDate: string;
  dueDate: string;
  currency: 'AUD';
  pricingMode: InvoicePricingMode;
  gstRateBasisPoints: number;
  subtotalCents: number;
  discountType: InvoiceDiscountType;
  discountValue: number;
  discountCents: number;
  gstCents: number;
  totalCents: number;
  creditAppliedCents: number;
  amountPaidCents: number;
  balanceDueCents: number;
  customerNotes: string | null;
  internalNotes: string | null;
  paymentTerms: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  customer: InvoiceCustomerSummary;
  customerSite: InvoiceSiteSummary | null;
  job: InvoiceJobSummary | null;
  sourceQuote: InvoiceQuoteSummary | null;
  lineItems: InvoiceLineItem[];
}

export interface InvoiceDocumentSummary {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  generatedAt: string;
  version: number;
}

export interface InvoiceListResponse {
  records: Invoice[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface InvoiceDetailResponse {
  invoice: Invoice;
  activity: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    createdAt: string;
    metadata: Record<string, unknown> | null;
  }>;
  documents?: InvoiceDocumentSummary[];
  payments?: InvoicePayment[];
  publicInvoiceUrl?: string;
}

export interface AccountsReceivableSummary {
  totalOutstandingCents: number;
  totalOverdueCents: number;
  dueSoonCents: number;
  paidThisMonthCents: number;
  overdueInvoiceCount: number;
  outstandingInvoiceCount: number;
  dueSoonInvoiceCount: number;
  paidInvoiceCount: number;
}

export interface AccountsReceivableResponse {
  summary: AccountsReceivableSummary;
  sections: {
    outstanding: Invoice[];
    overdue: Invoice[];
    dueSoon: Invoice[];
    paid: Invoice[];
  };
}

export interface CustomerFinancialSummary {
  outstandingCents: number;
  overdueCents: number;
  paidCents: number;
  invoiceCount: number;
  overdueInvoiceCount: number;
}

export interface JobFinancialSummary {
  acceptedQuoteCents: number;
  invoicedCents: number;
  paidCents: number;
  outstandingCents: number;
  invoiceCount: number;
}

export interface PublicInvoiceResponse {
  business: {
    name: string;
    abn: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    suburb: string | null;
    state: string | null;
    postcode: string | null;
  };
  invoice: {
    invoiceNumber: string;
    status: InvoiceDisplayStatus;
    title: string;
    description: string | null;
    issueDate: string;
    dueDate: string;
    customer: InvoiceCustomerSummary;
    customerSite: InvoiceSiteSummary | null;
    lineItems: Array<{
      lineTotalCents: number;
      name: string;
      quantity: string;
      taxable: boolean;
      type: InvoiceLineItemType;
      unit: string;
      unitPriceCents: number;
    }>;
    pricingMode: InvoicePricingMode;
    subtotalCents: number;
    discountCents: number;
    gstCents: number;
    totalCents: number;
    creditAppliedCents: number;
    amountPaidCents: number;
    balanceDueCents: number;
    paymentTerms: string | null;
    customerNotes: string | null;
    version: number;
  };
}

export interface InvoiceLineItemPayload {
  id?: string;
  type: InvoiceLineItemType;
  name: string;
  description?: string;
  quantity: string | number;
  unit: string;
  unitPriceCents: number;
  taxable: boolean;
}

export interface InvoicePayload {
  customerId: string;
  customerSiteId?: string | null;
  jobId?: string | null;
  sourceQuoteId?: string | null;
  title: string;
  description?: string;
  issueDate: string;
  dueDate: string;
  pricingMode: InvoicePricingMode;
  gstRateBasisPoints?: number;
  discountType?: InvoiceDiscountType;
  discountValue?: number;
  creditAppliedCents?: number;
  customerNotes?: string;
  internalNotes?: string;
  paymentTerms?: string;
  lineItems: InvoiceLineItemPayload[];
}

export interface InvoiceListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: InvoiceStatus | 'OUTSTANDING';
  customerId?: string;
  jobId?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: InvoiceSortBy;
  sortOrder?: SortOrder;
}

export interface AccountsReceivableQuery {
  search?: string;
  customerId?: string;
  status?: 'OUTSTANDING' | 'OVERDUE' | 'DUE_SOON' | 'PAID';
  dateFrom?: string;
  dateTo?: string;
}

export interface InvoiceCalculationInput {
  lineItems: InvoiceLineItemPayload[];
  pricingMode: InvoicePricingMode;
  gstRateBasisPoints?: number;
  discountType?: InvoiceDiscountType;
  discountValue?: number;
  creditAppliedCents?: number;
  amountPaidCents?: number;
}

export interface CalculatedInvoiceLineItem extends InvoiceLineItemPayload {
  quantity: string;
  lineSubtotalCents: number;
  lineGstCents: number;
  lineTotalCents: number;
}

export interface InvoiceCalculationResult {
  lineItems: CalculatedInvoiceLineItem[];
  subtotalCents: number;
  discountCents: number;
  gstCents: number;
  totalCents: number;
  creditAppliedCents: number;
  amountPaidCents: number;
  balanceDueCents: number;
}

export interface InvoicePaymentValidationResult {
  amountCents: number | null;
  error: string | null;
}

export type InvoiceAvailableAction =
  'EDIT' | 'SEND' | 'VIEW_PDF' | 'RECORD_PAYMENT' | 'VOID';

export interface InvoiceAvailableActionInput {
  role: BusinessRole;
  status: InvoiceStatus;
  balanceDueCents?: number | null;
}

export function roleCanViewInvoices(role: BusinessRole) {
  return INVOICE_VIEW_ROLES.includes(role);
}

export function roleCanViewAccountsReceivable(role: BusinessRole) {
  return ACCOUNTS_RECEIVABLE_VIEW_ROLES.includes(role);
}

export function roleCanCreateInvoices(role: BusinessRole) {
  return INVOICE_CREATE_ROLES.includes(role);
}

export function roleCanEditInvoice(role: BusinessRole, status: InvoiceStatus) {
  return INVOICE_EDIT_ROLES.includes(role) && status === 'DRAFT';
}

export function roleCanSendInvoice(role: BusinessRole, status: InvoiceStatus) {
  return INVOICE_SEND_ROLES.includes(role) && status === 'DRAFT';
}

export function roleCanRecordInvoicePayment(
  role: BusinessRole,
  status: InvoiceStatus,
) {
  return (
    INVOICE_PAYMENT_WRITE_ROLES.includes(role) &&
    !['DRAFT', 'PAID', 'VOID'].includes(status)
  );
}

export function roleCanVoidInvoice(role: BusinessRole, status: InvoiceStatus) {
  return (
    INVOICE_VOID_ROLES.includes(role) && !['PAID', 'VOID'].includes(status)
  );
}

export function canTransitionInvoiceStatus(
  from: InvoiceStatus,
  to: InvoiceStatus,
) {
  return INVOICE_STATUS_TRANSITIONS[from].includes(to);
}

export function getInvoiceAvailableActions(
  input: InvoiceAvailableActionInput,
): InvoiceAvailableAction[] {
  const actions: InvoiceAvailableAction[] = [];
  const balanceDueCents = input.balanceDueCents ?? 0;

  if (roleCanEditInvoice(input.role, input.status)) {
    actions.push('EDIT');
  }
  if (roleCanSendInvoice(input.role, input.status)) {
    actions.push('SEND');
  }
  if (roleCanViewInvoices(input.role)) {
    actions.push('VIEW_PDF');
  }
  if (
    roleCanRecordInvoicePayment(input.role, input.status) &&
    balanceDueCents > 0
  ) {
    actions.push('RECORD_PAYMENT');
  }
  if (roleCanVoidInvoice(input.role, input.status)) {
    actions.push('VOID');
  }

  return actions;
}

export function getInvoiceDisplayStatus(
  invoice: Pick<Invoice, 'status' | 'dueDate' | 'balanceDueCents'>,
  now = new Date(),
): InvoiceDisplayStatus {
  if (
    ['SENT', 'VIEWED', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status) &&
    invoice.balanceDueCents > 0 &&
    new Date(invoice.dueDate).getTime() < startOfToday(now).getTime()
  ) {
    return 'OVERDUE';
  }
  return invoice.status;
}

export function calculateInvoiceTotals(
  input: InvoiceCalculationInput,
): InvoiceCalculationResult {
  const gstRateBasisPoints =
    input.gstRateBasisPoints ?? DEFAULT_INVOICE_GST_RATE_BASIS_POINTS;
  const lines = input.lineItems.map((item) =>
    calculateInvoiceLine(item, input.pricingMode, gstRateBasisPoints),
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
  const creditAppliedCents = Math.min(
    Math.max(0, input.creditAppliedCents ?? 0),
    totalCents,
  );
  const amountPaidCents = Math.max(0, input.amountPaidCents ?? 0);
  const balanceDueCents = Math.max(
    0,
    totalCents - creditAppliedCents - amountPaidCents,
  );

  return {
    amountPaidCents,
    balanceDueCents,
    creditAppliedCents,
    discountCents: Math.min(discountCents, subtotalCents),
    gstCents: Math.max(0, gstCents),
    lineItems: lines,
    subtotalCents,
    totalCents,
  };
}

export function parseInvoiceQuantityInput(value: string) {
  return parseQuoteQuantityInput(value);
}

export function parseInvoiceMoneyInput(value: string) {
  return parseQuoteMoneyInput(value);
}

export function validateInvoicePaymentAmount(input: {
  amount: string;
  balanceDueCents: number;
  invoiceStatus: InvoiceStatus;
}): InvoicePaymentValidationResult {
  if (input.invoiceStatus === 'PAID') {
    return {
      amountCents: null,
      error: 'This invoice has already been paid.',
    };
  }
  if (input.invoiceStatus === 'VOID') {
    return {
      amountCents: null,
      error: 'Payments cannot be recorded against a void invoice.',
    };
  }

  const text = input.amount.trim();
  if (!text) {
    return { amountCents: null, error: 'Enter a payment amount.' };
  }
  if (text === '.' || /^\d+\.$/.test(text)) {
    return { amountCents: null, error: 'Enter a valid payment amount.' };
  }

  const parsed = parseInvoiceMoneyInput(input.amount);
  if (parsed.errorCode === 'NEGATIVE') {
    return {
      amountCents: null,
      error: 'Payment amount must be greater than $0.',
    };
  }
  if (parsed.error || parsed.value === null) {
    return {
      amountCents: null,
      error:
        parsed.errorCode === 'REQUIRED'
          ? 'Enter a payment amount.'
          : 'Enter a valid payment amount.',
    };
  }
  if (parsed.value <= 0) {
    return {
      amountCents: null,
      error: 'Payment amount must be greater than $0.',
    };
  }
  if (parsed.value > input.balanceDueCents) {
    return {
      amountCents: null,
      error: `Payment cannot exceed the remaining balance of ${formatAudCents(
        input.balanceDueCents,
      )}.`,
    };
  }

  return { amountCents: parsed.value, error: null };
}

export { formatAudCents };

function calculateInvoiceLine(
  item: InvoiceLineItemPayload,
  pricingMode: InvoicePricingMode,
  gstRateBasisPoints: number,
): CalculatedInvoiceLineItem {
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
  type: InvoiceDiscountType,
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

function startOfToday(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
