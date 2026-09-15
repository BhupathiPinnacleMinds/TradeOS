import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { MemberShiftPayload, MemberShiftQuery } from '@tradieos/shared';

export class MemberShiftDto implements MemberShiftPayload {
  @IsString()
  memberId!: string;

  @IsString()
  shiftDate!: string;

  @IsString()
  startTime!: string;

  @IsString()
  endTime!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class MemberShiftQueryDto implements MemberShiftQuery {
  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;

  @IsOptional()
  @IsString()
  memberId?: string;
}
