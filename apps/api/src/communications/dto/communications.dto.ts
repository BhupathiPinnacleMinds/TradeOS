import {
  CUSTOMER_COMMUNICATION_CHANNELS,
  CUSTOMER_COMMUNICATION_STATUSES,
  CUSTOMER_COMMUNICATION_TYPES,
  type CustomerCommunicationChannel,
  type CustomerCommunicationStatus,
  type CustomerCommunicationType,
} from '@tradieos/shared';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ListCommunicationsQueryDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  appointmentId?: string;

  @IsOptional()
  @IsString()
  quoteId?: string;

  @IsOptional()
  @IsString()
  invoiceId?: string;

  @IsOptional()
  @IsIn(CUSTOMER_COMMUNICATION_STATUSES)
  status?: CustomerCommunicationStatus;

  @IsOptional()
  @IsIn(CUSTOMER_COMMUNICATION_TYPES)
  type?: CustomerCommunicationType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class ManualCustomerCommunicationDto {
  @IsString()
  customerId!: string;

  @IsIn(CUSTOMER_COMMUNICATION_CHANNELS)
  channel!: CustomerCommunicationChannel;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  subject?: string;

  @IsString()
  @MaxLength(2000)
  message!: string;
}

export class UpdateCommunicationSettingsDto {
  @IsOptional()
  @IsBoolean()
  appointmentConfirmationsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  appointmentRemindersEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(10080)
  appointmentReminderLeadMinutes?: number;

  @IsOptional()
  @IsBoolean()
  quoteFollowUpsEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(43200)
  quoteFollowUpDelayMinutes?: number;

  @IsOptional()
  @IsBoolean()
  invoiceDueSoonRemindersEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(43200)
  invoiceDueSoonLeadMinutes?: number;

  @IsOptional()
  @IsBoolean()
  invoiceOverdueRemindersEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(43200)
  invoiceOverdueDelayMinutes?: number;

  @IsOptional()
  @IsBoolean()
  paymentConfirmationsEnabled?: boolean;
}

export class UpdateCommunicationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  smsEnabled?: boolean;
}
