import type { MediaCategory, MediaType } from '@tradieos/shared';
import {
  DOCUMENT_MEDIA_CATEGORIES,
  PHOTO_MEDIA_CATEGORIES,
} from '@tradieos/shared';

export const IMAGE_UPLOAD_LIMIT_BYTES = 15 * 1024 * 1024;
export const DOCUMENT_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;
export const MAX_PHOTO_SELECTION = 10;

const mimeTypeToMediaType = new Map<string, MediaType>([
  ['image/jpeg', 'IMAGE'],
  ['image/jpg', 'IMAGE'],
  ['image/png', 'IMAGE'],
  ['image/heic', 'IMAGE'],
  ['image/heif', 'IMAGE'],
  ['image/webp', 'IMAGE'],
  ['application/pdf', 'PDF'],
  ['application/msword', 'DOCUMENT'],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'DOCUMENT',
  ],
  ['application/vnd.ms-excel', 'DOCUMENT'],
  [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'DOCUMENT',
  ],
  ['text/plain', 'DOCUMENT'],
]);

const extensionToMimeType = new Map<string, string>([
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['heic', 'image/heic'],
  ['heif', 'image/heif'],
  ['webp', 'image/webp'],
  ['pdf', 'application/pdf'],
  ['doc', 'application/msword'],
  [
    'docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  ['xls', 'application/vnd.ms-excel'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['txt', 'text/plain'],
]);

export type MediaSelectionErrorCode =
  'UNSUPPORTED_FILE_TYPE' | 'FILE_TOO_LARGE' | 'LOCAL_FILE_UNAVAILABLE';

export type MediaSelectionValidation =
  | {
      ok: true;
      mediaType: MediaType;
      mimeType: string;
      category: MediaCategory;
    }
  | {
      ok: false;
      code: MediaSelectionErrorCode;
      message: string;
    };

export function normaliseMimeType(
  mimeType?: string | null,
  fileName?: string | null,
) {
  const trimmed = mimeType?.trim().toLowerCase();
  if (trimmed) {
    return trimmed === 'image/jpg' ? 'image/jpeg' : trimmed;
  }

  const extension = fileName?.split('.').pop()?.trim().toLowerCase();
  return extension ? (extensionToMimeType.get(extension) ?? '') : '';
}

export function mediaTypeForMimeType(mimeType: string) {
  return mimeTypeToMediaType.get(mimeType.toLowerCase()) ?? null;
}

export function defaultCategoryForMediaType(
  mediaType: MediaType,
): MediaCategory {
  if (mediaType === 'IMAGE') return 'BEFORE_PHOTO';
  if (mediaType === 'PDF' || mediaType === 'DOCUMENT') {
    return 'GENERAL_DOCUMENT';
  }
  return 'OTHER';
}

export function categoriesForMediaType(mediaType: MediaType) {
  if (mediaType === 'IMAGE') return PHOTO_MEDIA_CATEGORIES;
  if (mediaType === 'PDF' || mediaType === 'DOCUMENT') {
    return DOCUMENT_MEDIA_CATEGORIES;
  }
  return ['OTHER'] as const;
}

export function isCategoryValidForMediaType(
  mediaType: MediaType,
  category: MediaCategory,
) {
  return (
    categoriesForMediaType(mediaType) as readonly MediaCategory[]
  ).includes(category);
}

export function validateMediaSelection(input: {
  fileName: string;
  fileSizeBytes?: number | null;
  mimeType?: string | null;
}): MediaSelectionValidation {
  if (!input.fileSizeBytes || input.fileSizeBytes < 1) {
    return {
      code: 'LOCAL_FILE_UNAVAILABLE',
      message: 'This local file is not available. Please choose it again.',
      ok: false,
    };
  }

  const mimeType = normaliseMimeType(input.mimeType, input.fileName);
  const mediaType = mediaTypeForMimeType(mimeType);
  if (!mediaType || mediaType === 'VIDEO' || mediaType === 'AUDIO') {
    return {
      code: 'UNSUPPORTED_FILE_TYPE',
      message:
        'This file type is not supported yet. Use photos, PDFs, Word, Excel or text files.',
      ok: false,
    };
  }

  const limit =
    mediaType === 'IMAGE'
      ? IMAGE_UPLOAD_LIMIT_BYTES
      : DOCUMENT_UPLOAD_LIMIT_BYTES;
  if (input.fileSizeBytes > limit) {
    return {
      code: 'FILE_TOO_LARGE',
      message: `Files of this type must be ${Math.floor(
        limit / 1024 / 1024,
      )} MB or smaller.`,
      ok: false,
    };
  }

  return {
    category: defaultCategoryForMediaType(mediaType),
    mediaType,
    mimeType,
    ok: true,
  };
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function uploadButtonLabel(fileCount: number) {
  if (fileCount === 0) return 'Select evidence first';
  if (fileCount === 1) return 'Upload 1 file';
  return `Upload ${fileCount} files`;
}
