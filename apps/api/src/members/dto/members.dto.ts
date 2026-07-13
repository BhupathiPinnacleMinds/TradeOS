import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { BUSINESS_ROLES, MEMBER_STATUSES } from '@tradieos/shared';
import type { BusinessRole, MemberStatus } from '@tradieos/shared';

export class InviteMemberDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  @IsIn(BUSINESS_ROLES)
  role!: BusinessRole;
}

export class UpdateMemberRoleDto {
  @IsIn(BUSINESS_ROLES)
  role!: BusinessRole;
}

export class UpdateMemberStatusDto {
  @IsIn(MEMBER_STATUSES.filter((status) => status !== 'INVITED'))
  status!: Extract<MemberStatus, 'ACTIVE' | 'SUSPENDED'>;
}

export class AcceptInvitationDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(8)
  confirmPassword!: string;
}
