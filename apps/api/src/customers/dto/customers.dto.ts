import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  AUSTRALIAN_STATES,
  CONTACT_PREFERENCES,
  CUSTOMER_TYPES,
  type AustralianState,
  type ContactPreference,
  type CustomerSortBy,
  type CustomerType,
  type SortOrder,
} from '@tradieos/shared';

const SORT_FIELDS = [
  'displayName',
  'createdAt',
  'updatedAt',
  'suburb',
  'customerType',
] as const satisfies readonly CustomerSortBy[];

export class ListCustomersQueryDto {
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
  @IsIn(CUSTOMER_TYPES)
  customerType?: CustomerType;

  @IsOptional()
  @IsIn(AUSTRALIAN_STATES)
  state?: AustralianState;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  suburb?: string;

  @IsOptional()
  @IsString()
  archived?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  tag?: string;

  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: CustomerSortBy;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: SortOrder;
}

export class UpsertCustomerDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  companyName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(180)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  alternatePhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  suburb?: string;

  @IsOptional()
  @IsIn([...AUSTRALIAN_STATES, ''])
  state?: AustralianState | '';

  @IsOptional()
  @Matches(/^\d{4}$/)
  postcode?: string;

  @IsIn(CONTACT_PREFERENCES)
  contactPreference!: ContactPreference;

  @IsIn(CUSTOMER_TYPES)
  customerType!: CustomerType;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  allowDuplicate?: boolean;
}

export class UpsertCustomerSiteDto {
  @IsString()
  @MaxLength(80)
  label!: string;

  @IsString()
  @MaxLength(160)
  addressLine1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  addressLine2?: string;

  @IsString()
  @MaxLength(80)
  suburb!: string;

  @IsIn(AUSTRALIAN_STATES)
  state!: AustralianState;

  @Matches(/^\d{4}$/)
  postcode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(800)
  accessInstructions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  siteContactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  siteContactPhone?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
