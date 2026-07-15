import { Type } from 'class-transformer';
import {
  IsDateString,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Matches,
} from 'class-validator';
import {
  APPOINTMENT_LOCATION_SOURCES,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  AUSTRALIAN_STATES,
  JOB_PRIORITIES,
  type AppointmentFilter,
  type AppointmentLocationSource,
  type AppointmentSortBy,
  type AppointmentStatus,
  type AppointmentType,
  type JobPriority,
  type SortOrder,
} from '@tradieos/shared';

const APPOINTMENT_SORT_FIELDS = [
  'scheduledStart',
  'createdAt',
  'updatedAt',
  'appointmentNumber',
  'status',
] as const satisfies readonly AppointmentSortBy[];

const APPOINTMENT_FILTERS = [
  'today',
  'tomorrow',
  'upcoming',
  'completed',
  'cancelled',
  'my-appointments',
] as const satisfies readonly AppointmentFilter[];

export class ListAppointmentsQueryDto {
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
  @IsIn(APPOINTMENT_STATUSES)
  status?: AppointmentStatus;

  @IsOptional()
  @IsIn(APPOINTMENT_TYPES)
  appointmentType?: AppointmentType;

  @IsOptional()
  @IsString()
  jobId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  assignedUserId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsIn(APPOINTMENT_FILTERS)
  filter?: AppointmentFilter;

  @IsOptional()
  @IsIn(APPOINTMENT_SORT_FIELDS)
  sortBy?: AppointmentSortBy;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: SortOrder;
}

export class UpsertAppointmentDto {
  @IsString()
  jobId!: string;

  @IsOptional()
  @IsString()
  customerSiteId?: string | null;

  @IsOptional()
  @IsString()
  assignedUserId?: string | null;

  @IsIn(APPOINTMENT_TYPES)
  appointmentType!: AppointmentType;

  @IsOptional()
  @IsIn(APPOINTMENT_LOCATION_SOURCES)
  locationSource?: AppointmentLocationSource;

  @IsOptional()
  @IsIn(APPOINTMENT_STATUSES)
  status?: AppointmentStatus;

  @IsDateString()
  scheduledStart!: string;

  @IsDateString()
  scheduledEnd!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7 * 24 * 60)
  estimatedDurationMinutes?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  travelDurationMinutes?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(99999)
  travelDistanceKm?: number | null;

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
  @IsIn(AUSTRALIAN_STATES)
  state?: string;

  @IsOptional()
  @Matches(/^\d{4}$/)
  postcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  accessInstructions?: string;

  @IsOptional()
  @IsBoolean()
  saveAddressAsCustomerSite?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  allowConflictOverride?: boolean;
}

export class AppointmentRecommendationDto {
  @IsString()
  jobId!: string;

  @IsDateString()
  scheduledStart!: string;

  @IsDateString()
  scheduledEnd!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7 * 24 * 60)
  estimatedDurationMinutes?: number | null;

  @IsOptional()
  @IsIn(JOB_PRIORITIES)
  priority?: JobPriority;
}

export class AppointmentAvailabilityDto {
  @IsDateString()
  scheduledStart!: string;

  @IsDateString()
  scheduledEnd!: string;

  @IsOptional()
  @IsString()
  assignedUserId?: string | null;

  @IsOptional()
  @IsString()
  excludeAppointmentId?: string;
}

export class ReassignAppointmentDto {
  @IsOptional()
  @IsString()
  assignedUserId?: string | null;

  @IsOptional()
  @IsBoolean()
  allowConflictOverride?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
