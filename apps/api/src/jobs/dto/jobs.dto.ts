import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AUSTRALIAN_STATES,
  JOB_PRIORITIES,
  JOB_STATUSES,
  type AustralianState,
  type JobFilter,
  type JobPriority,
  type JobSortBy,
  type JobStatus,
  type SortOrder,
} from '@tradieos/shared';

const JOB_SORT_FIELDS = [
  'scheduledStart',
  'createdAt',
  'updatedAt',
  'jobNumber',
  'priority',
  'status',
] as const satisfies readonly JobSortBy[];

const JOB_FILTERS = [
  'today',
  'tomorrow',
  'upcoming',
  'completed',
  'cancelled',
  'high-priority',
  'my-jobs',
  'unassigned',
] as const satisfies readonly JobFilter[];

export class ListJobsQueryDto {
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
  @IsIn(JOB_STATUSES)
  status?: JobStatus;

  @IsOptional()
  @IsIn(JOB_PRIORITIES)
  priority?: JobPriority;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  assignedToUserId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsIn(JOB_FILTERS)
  filter?: JobFilter;

  @IsOptional()
  @IsString()
  archived?: string;

  @IsOptional()
  @IsIn(JOB_SORT_FIELDS)
  sortBy?: JobSortBy;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: SortOrder;
}

export class UpsertJobDto {
  @IsString()
  customerId!: string;

  @IsOptional()
  @IsString()
  assignedToUserId?: string | null;

  @IsString()
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  tradeType?: string;

  @IsIn(JOB_STATUSES)
  status!: JobStatus;

  @IsIn(JOB_PRIORITIES)
  priority!: JobPriority;

  @IsDateString()
  scheduledStart!: string;

  @IsOptional()
  @IsDateString()
  scheduledEnd?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7 * 24 * 60)
  estimatedDurationMinutes?: number | null;

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
  @MaxLength(2000)
  customerNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  internalNotes?: string;

  @IsOptional()
  @IsBoolean()
  requiresQuote?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresInvoice?: boolean;
}

export class UpdateJobStatusDto {
  @IsIn(JOB_STATUSES)
  status!: JobStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  internalNotes?: string;
}
