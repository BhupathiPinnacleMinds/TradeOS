import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { BusinessPaymentInstructionsPayload } from '@tradieos/shared';

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
