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
  QUOTE_DEPOSIT_TYPES,
  QUOTE_DISCOUNT_TYPES,
  QUOTE_LINE_ITEM_TYPES,
  QUOTE_PRICING_MODES,
  QUOTE_STATUSES,
  type QuoteDepositType,
  type QuoteDiscountType,
  type QuoteLineItemType,
  type QuotePricingMode,
  type QuoteSortBy,
  type QuoteStatus,
  type SortOrder,
} from '@tradieos/shared';

const QUOTE_SORT_FIELDS = [
  'createdAt',
  'expiryDate',
  'totalCents',
  'status',
] as const satisfies readonly QuoteSortBy[];

export class ListQuotesQueryDto {
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
  @IsIn(QUOTE_STATUSES)
  status?: QuoteStatus;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  createdBy?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  expired?: string;

  @IsOptional()
  @IsIn(QUOTE_SORT_FIELDS)
  sortBy?: QuoteSortBy;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: SortOrder;
}

export class QuoteLineItemDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsIn(QUOTE_LINE_ITEM_TYPES)
  type!: QuoteLineItemType;

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

export class UpsertQuoteDto {
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
  sourceAppointmentId?: string | null;

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

  @IsOptional()
  @IsDateString()
  expiryDate?: string | null;

  @IsIn(QUOTE_PRICING_MODES)
  pricingMode!: QuotePricingMode;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  gstRateBasisPoints?: number;

  @IsOptional()
  @IsIn(QUOTE_DISCOUNT_TYPES)
  discountType?: QuoteDiscountType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  discountValue?: number;

  @IsOptional()
  @IsIn(QUOTE_DEPOSIT_TYPES)
  depositType?: QuoteDepositType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  depositValue?: number;

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
  termsAndConditions?: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineItemDto)
  lineItems!: QuoteLineItemDto[];
}

export class ReorderQuoteItemsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  itemIds!: string[];
}

export class QuoteReasonDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class QuoteAcceptanceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  acceptedByName!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(180)
  acceptedByEmail?: string;
}
