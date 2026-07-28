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
import {
  MEDIA_CATEGORIES,
  MEDIA_TYPES,
  PROCESSING_STATUSES,
  UPLOAD_STATUSES,
} from '@tradieos/shared';
import type {
  MediaCategory,
  MediaType,
  ProcessingStatus,
  UploadStatus,
} from '@tradieos/shared';

export class CreateUploadTargetDto {
  @IsOptional()
  @IsString()
  customerId?: string | null;

  @IsOptional()
  @IsString()
  jobId?: string | null;

  @IsOptional()
  @IsString()
  appointmentId?: string | null;

  @IsIn(MEDIA_CATEGORIES)
  category!: MediaCategory;

  @IsIn(MEDIA_TYPES)
  mediaType!: MediaType;

  @IsString()
  @MaxLength(255)
  originalFileName!: string;

  @IsString()
  @MaxLength(120)
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(25 * 1024 * 1024)
  fileSizeBytes!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationSeconds?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  checksum?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  caption?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  isCustomerVisible?: boolean;
}

export class LocalUploadDto {
  @IsOptional()
  @IsString()
  contentBase64?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  checksum?: string | null;
}

export class CompleteUploadDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  checksum?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  fileSizeBytes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationSeconds?: number | null;
}

export class UpdateMediaDto {
  @IsOptional()
  @IsIn(MEDIA_CATEGORIES)
  category?: MediaCategory;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  caption?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  isCustomerVisible?: boolean;
}

export class ListMediaQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  jobId?: string;

  @IsOptional()
  @IsString()
  appointmentId?: string;

  @IsOptional()
  @IsIn(MEDIA_CATEGORIES)
  category?: MediaCategory;

  @IsOptional()
  @IsIn(MEDIA_TYPES)
  mediaType?: MediaType;

  @IsOptional()
  @IsString()
  uploadedBy?: string;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  archived?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(UPLOAD_STATUSES)
  uploadStatus?: UploadStatus;

  @IsOptional()
  @IsIn(PROCESSING_STATUSES)
  processingStatus?: ProcessingStatus;
}
