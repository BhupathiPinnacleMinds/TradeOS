import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  MEMBER_LEAVE_TYPES,
  type MemberLeavePayload,
  type MemberLeaveType,
} from '@tradieos/shared';

export class MemberLeaveDto implements MemberLeavePayload {
  @IsIn(MEMBER_LEAVE_TYPES)
  type!: MemberLeaveType;

  @IsString()
  @MaxLength(10)
  startDate!: string;

  @IsString()
  @MaxLength(10)
  endDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
