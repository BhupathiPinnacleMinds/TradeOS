import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  INVOICE_DISCOUNT_TYPES,
  INVOICE_LINE_ITEM_TYPES,
  INVOICE_PAYMENT_METHODS,
  INVOICE_PRICING_MODES,
  INVOICE_STATUSES,
  type InvoiceDiscountType,
  type InvoiceLineItemType,
  type InvoicePaymentMethod,
  type InvoicePricingMode,
  type InvoiceSortBy,
  type InvoiceStatus,
  type SortOrder,
} from '@tradieos/shared';

const INVOICE_SORT_FIELDS = [
  'createdAt',
  'dueDate',
  'totalCents',
  'status',
] as const satisfies readonly InvoiceSortBy[];

export class ListInvoicesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsIn([...INVOICE_STATUSES, 'OUTSTANDING'])
  status?: InvoiceStatus | 'OUTSTANDING';

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  jobId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsIn(INVOICE_SORT_FIELDS)
  sortBy?: InvoiceSortBy;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: SortOrder;
}

export class AccountsReceivableQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsIn(['OUTSTANDING', 'OVERDUE', 'DUE_SOON', 'PAID'])
  status?: 'OUTSTANDING' | 'OVERDUE' | 'DUE_SOON' | 'PAID';

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class InvoiceDraftQueryDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  customerSiteId?: string;

  @IsOptional()
  @IsString()
  jobId?: string;

  @IsOptional()
  @IsString()
  sourceQuoteId?: string;
}

export class InvoiceLineItemDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsIn(INVOICE_LINE_ITEM_TYPES)
  type!: InvoiceLineItemType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsString()
  @MaxLength(20)
  quantity!: string;

  @IsString()
  @MaxLength(40)
  unit!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  unitPriceCents!: number;

  @IsBoolean()
  taxable!: boolean;
}

export class UpsertInvoiceDto {
  @IsString()
  customerId!: string;

  @IsOptional()
  @IsString()
  customerSiteId?: string | null;

  @IsOptional()
  @IsString()
  jobId?: string | null;

  @IsOptional()
  @IsString()
  sourceQuoteId?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsDateString()
  issueDate!: string;

  @IsDateString()
  dueDate!: string;

  @IsIn(INVOICE_PRICING_MODES)
  pricingMode!: InvoicePricingMode;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  gstRateBasisPoints?: number;

  @IsOptional()
  @IsIn(INVOICE_DISCOUNT_TYPES)
  discountType?: InvoiceDiscountType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  discountValue?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  creditAppliedCents?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  customerNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  internalNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  paymentTerms?: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineItemDto)
  lineItems!: InvoiceLineItemDto[];
}

export class SendInvoiceDto {
  @IsEmail()
  @MaxLength(180)
  to!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  subject!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  message!: string;
}

export class RecordInvoicePaymentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountCents!: number;

  @IsIn(INVOICE_PAYMENT_METHODS)
  method!: InvoicePaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  reference?: string;

  @IsDateString()
  receivedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
