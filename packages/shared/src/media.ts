import type { BusinessRole } from './auth';

export const MEDIA_CATEGORIES = [
  'BEFORE_PHOTO',
  'PROGRESS_PHOTO',
  'AFTER_PHOTO',
  'DAMAGE_EVIDENCE',
  'CUSTOMER_SUPPLIED',
  'COMPLIANCE_CERTIFICATE',
  'WARRANTY',
  'PLAN_DRAWING',
  'PERMIT',
  'RECEIPT',
  'MATERIAL_INVOICE',
  'GENERAL_DOCUMENT',
  'OTHER',
] as const;

export const MEDIA_TYPES = [
  'IMAGE',
  'PDF',
  'DOCUMENT',
  'VIDEO',
  'AUDIO',
  'OTHER',
] as const;

export const UPLOAD_STATUSES = [
  'PENDING',
  'UPLOADING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export const PROCESSING_STATUSES = [
  'NOT_REQUIRED',
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
] as const;

export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];
export type MediaType = (typeof MEDIA_TYPES)[number];
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export interface MediaUploaderSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface MediaAsset {
  id: string;
  businessId: string;
  customerId: string | null;
  jobId: string | null;
  appointmentId: string | null;
  uploadedByUserId: string;
  category: MediaCategory;
  mediaType: MediaType;
  originalFileName: string;
  storageProvider: string;
  mimeType: string;
  fileSizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  checksum: string | null;
  caption: string | null;
  notes: string | null;
  isCustomerVisible: boolean;
  uploadStatus: UploadStatus;
  processingStatus: ProcessingStatus;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  uploadedBy: MediaUploaderSummary | null;
}

export interface MediaListResponse {
  records: MediaAsset[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface MediaDetailResponse {
  media: MediaAsset;
}

export interface MediaUploadTargetRequest {
  customerId?: string | null;
  jobId?: string | null;
  appointmentId?: string | null;
  category: MediaCategory;
  mediaType: MediaType;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  checksum?: string | null;
  caption?: string | null;
  notes?: string | null;
  isCustomerVisible?: boolean;
}

export interface MediaUploadTargetResponse {
  media: MediaAsset;
  upload: {
    method: 'GET' | 'PUT' | 'POST' | 'LOCAL_API';
    url: string;
    expiresAt: string;
    headers: Record<string, string>;
    fields?: Record<string, string>;
  };
}

export interface LocalMediaUploadRequest {
  contentBase64: string;
  checksum?: string | null;
}

export interface CompleteMediaUploadRequest {
  checksum?: string | null;
  fileSizeBytes?: number;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
}

export interface UpdateMediaMetadataRequest {
  category?: MediaCategory;
  caption?: string | null;
  notes?: string | null;
  isCustomerVisible?: boolean;
}

export interface MediaAccessResponse {
  url: string;
  expiresAt: string;
}

export const MEDIA_UPLOAD_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
  'TECHNICIAN',
  'SALES',
];

export const MEDIA_VIEW_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
  'SCHEDULER',
  'TECHNICIAN',
  'ACCOUNTANT',
  'SALES',
  'READ_ONLY',
];

export const MEDIA_MANAGE_ROLES: BusinessRole[] = [
  'OWNER',
  'ADMIN',
  'OFFICE_MANAGER',
];

export const MEDIA_PROTECTED_CATEGORIES: MediaCategory[] = [
  'COMPLIANCE_CERTIFICATE',
  'WARRANTY',
  'PERMIT',
  'MATERIAL_INVOICE',
  'RECEIPT',
];

export const MEDIA_TECHNICIAN_CORRECTION_WINDOW_HOURS = 24;

export const FINANCIAL_MEDIA_CATEGORIES: MediaCategory[] = [
  'RECEIPT',
  'MATERIAL_INVOICE',
];

export const PHOTO_MEDIA_CATEGORIES: MediaCategory[] = [
  'BEFORE_PHOTO',
  'PROGRESS_PHOTO',
  'AFTER_PHOTO',
  'DAMAGE_EVIDENCE',
  'CUSTOMER_SUPPLIED',
];

export const DOCUMENT_MEDIA_CATEGORIES: MediaCategory[] = [
  'COMPLIANCE_CERTIFICATE',
  'WARRANTY',
  'PLAN_DRAWING',
  'PERMIT',
  'RECEIPT',
  'MATERIAL_INVOICE',
  'GENERAL_DOCUMENT',
  'OTHER',
];

export const MEDIA_CATEGORY_LABELS: Record<MediaCategory, string> = {
  AFTER_PHOTO: 'After photo',
  BEFORE_PHOTO: 'Before photo',
  COMPLIANCE_CERTIFICATE: 'Compliance certificate',
  CUSTOMER_SUPPLIED: 'Customer supplied',
  DAMAGE_EVIDENCE: 'Damage evidence',
  GENERAL_DOCUMENT: 'General document',
  MATERIAL_INVOICE: 'Material invoice',
  OTHER: 'Other',
  PERMIT: 'Permit',
  PLAN_DRAWING: 'Plan or drawing',
  PROGRESS_PHOTO: 'Progress photo',
  RECEIPT: 'Receipt',
  WARRANTY: 'Warranty',
};

export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  AUDIO: 'Audio',
  DOCUMENT: 'Document',
  IMAGE: 'Image',
  OTHER: 'Other',
  PDF: 'PDF',
  VIDEO: 'Video',
};

export function mediaCategoryLabel(category: MediaCategory) {
  return MEDIA_CATEGORY_LABELS[category];
}

export function mediaTypeLabel(mediaType: MediaType) {
  return MEDIA_TYPE_LABELS[mediaType];
}
