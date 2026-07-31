import type { AppointmentStatus, AuthUser, MediaAsset } from '@tradieos/shared';
import {
  FINANCIAL_MEDIA_CATEGORIES,
  MEDIA_PROTECTED_CATEGORIES,
  MEDIA_TECHNICIAN_CORRECTION_WINDOW_HOURS,
  PHOTO_MEDIA_CATEGORIES,
} from '@tradieos/shared';
import { ApiRequestError } from './client';

const TECHNICIAN_CORRECTION_WINDOW_MS =
  MEDIA_TECHNICIAN_CORRECTION_WINDOW_HOURS * 60 * 60 * 1000;

export function isPhoto(media: MediaAsset) {
  return media.mediaType === 'IMAGE';
}

export function mediaNoun(media: MediaAsset) {
  return isPhoto(media) ? 'photo' : 'document';
}

export function removeMediaLabel(media: MediaAsset) {
  return `Remove ${mediaNoun(media)}`;
}

export function mediaRemovedMessage(media: MediaAsset) {
  return isPhoto(media) ? 'Photo removed.' : 'Document removed.';
}

export function mediaRestoredMessage(media: MediaAsset) {
  return isPhoto(media) ? 'Photo restored.' : 'Document restored.';
}

export function canArchiveMediaInUi(
  user: AuthUser | null,
  media: MediaAsset,
  context?: { appointmentStatus?: AppointmentStatus | null },
) {
  return !mediaArchiveUnavailableReason(user, media, context);
}

export type MediaArchiveUnavailableReason =
  | 'NO_USER'
  | 'ALREADY_ARCHIVED'
  | 'COMPLETED_APPOINTMENT'
  | 'OTHER_USER_UPLOAD'
  | 'TECHNICIAN_DOCUMENT'
  | 'PROTECTED_CATEGORY'
  | 'CORRECTION_WINDOW_EXPIRED'
  | 'ROLE_LACKS_PERMISSION';

export function mediaArchiveUnavailableReason(
  user: AuthUser | null,
  media: MediaAsset,
  context?: { appointmentStatus?: AppointmentStatus | null },
): MediaArchiveUnavailableReason | null {
  if (!user) return 'NO_USER';
  if (media.archivedAt) return 'ALREADY_ARCHIVED';
  if (['OWNER', 'ADMIN'].includes(user.role)) return null;
  if (
    user.role === 'OFFICE_MANAGER' &&
    !MEDIA_PROTECTED_CATEGORIES.includes(media.category)
  ) {
    return null;
  }
  if (
    user.role === 'ACCOUNTANT' &&
    FINANCIAL_MEDIA_CATEGORIES.includes(media.category)
  ) {
    return null;
  }
  if (
    user.role === 'SALES' &&
    media.category === 'CUSTOMER_SUPPLIED' &&
    media.uploadedByUserId === user.id
  ) {
    return null;
  }
  if (user.role !== 'TECHNICIAN') return 'ROLE_LACKS_PERMISSION';
  if (context?.appointmentStatus === 'COMPLETED')
    return 'COMPLETED_APPOINTMENT';
  if (media.uploadedByUserId !== user.id) return 'OTHER_USER_UPLOAD';
  if (media.mediaType !== 'IMAGE') return 'TECHNICIAN_DOCUMENT';
  if (!PHOTO_MEDIA_CATEGORIES.includes(media.category)) {
    return 'PROTECTED_CATEGORY';
  }
  if (
    Date.now() - new Date(media.createdAt).getTime() >
    TECHNICIAN_CORRECTION_WINDOW_MS
  ) {
    return 'CORRECTION_WINDOW_EXPIRED';
  }
  return null;
}

export function canRestoreMediaInUi(user: AuthUser | null, media: MediaAsset) {
  if (!user || !media.archivedAt) return false;
  if (['OWNER', 'ADMIN'].includes(user.role)) return true;
  if (
    user.role === 'OFFICE_MANAGER' &&
    !MEDIA_PROTECTED_CATEGORIES.includes(media.category)
  ) {
    return true;
  }
  return (
    user.role === 'ACCOUNTANT' &&
    FINANCIAL_MEDIA_CATEGORIES.includes(media.category)
  );
}

export function friendlyMediaArchiveError(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.code === 'PROTECTED_MEDIA_REQUIRES_ADMIN') {
      return 'Only an Owner or Admin can remove this document.';
    }
    if (error.code === 'MEDIA_ARCHIVE_WINDOW_EXPIRED') {
      return 'This file can no longer be removed by a technician. Ask an Owner or Admin.';
    }
    if (error.code === 'MEDIA_COMPLETED_APPOINTMENT_LOCKED') {
      return 'Evidence on completed appointments can only be removed by an Owner or Admin.';
    }
    if (error.code === 'MEDIA_ACCESS_DENIED' || error.status === 403) {
      return "You don't have permission to remove this file.";
    }
    if (error.code === 'NETWORK_ERROR') {
      return "We couldn't remove this file. Please try again.";
    }
  }
  return "We couldn't remove this file. Please try again.";
}
