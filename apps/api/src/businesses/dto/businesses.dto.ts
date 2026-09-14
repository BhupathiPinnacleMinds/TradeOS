import { IsOptional, IsString, MaxLength } from 'class-validator';
import type {
  BusinessOperatingHoursPayload,
  BusinessPaymentInstructionsPayload,
} from '@tradieos/shared';

export class UpdateBusinessPaymentInstructionsDto implements BusinessPaymentInstructionsPayload {
  @IsOptional()
  @IsString()
  @MaxLength(180)
  accountName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  bsb?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  accountNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customInstructions?: string | null;
}

export class UpdateBusinessOperatingHoursDto implements BusinessOperatingHoursPayload {
  @IsString()
  @MaxLength(5)
  businessStartTime!: string;

  @IsString()
  @MaxLength(5)
  businessEndTime!: string;
}
