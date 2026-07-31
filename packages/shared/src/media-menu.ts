import type { MediaAsset } from './media';
import { mediaCategoryLabel } from './media';

export type MediaMenuActionKey =
  'VIEW' | 'EDIT' | 'ARCHIVE' | 'RESTORE' | 'CANCEL';

export type MediaMenuActionConfig = {
  cancelButtonIndex: number;
  destructiveButtonIndex?: number;
  options: string[];
  keys: MediaMenuActionKey[];
};

export type MediaMenuOpenDecisionInput = {
  busy?: boolean;
  isOpen: boolean;
  isOpening: boolean;
};

export type MediaMenuOpenDecision =
  | { shouldOpen: true }
  | {
      reason: 'BUSY' | 'ALREADY_OPEN' | 'OPENING';
      shouldOpen: false;
    };

export function mediaMenuNoun(media: Pick<MediaAsset, 'mediaType'>) {
  return media.mediaType === 'IMAGE' ? 'photo' : 'document';
}

export function mediaMenuViewLabel(media: Pick<MediaAsset, 'mediaType'>) {
  return `View ${mediaMenuNoun(media)}`;
}

export function mediaMenuRemoveLabel(media: Pick<MediaAsset, 'mediaType'>) {
  return `Remove ${mediaMenuNoun(media)}`;
}

export function mediaDisplayTitle(
  media: Pick<
    MediaAsset,
    'caption' | 'category' | 'mediaType' | 'originalFileName'
  >,
) {
  const caption = media.caption?.trim();
  if (caption) return caption;

  const categoryLabel = friendlyMenuCategoryLabel(media);
  if (categoryLabel) return categoryLabel;

  return compactMediaFileName(media.originalFileName);
}

export function compactMediaFileName(fileName: string, maxLength = 28) {
  const trimmed = fileName.trim();
  if (trimmed.length <= maxLength) return trimmed;

  const dotIndex = trimmed.lastIndexOf('.');
  const extension =
    dotIndex > 0 && trimmed.length - dotIndex <= 8
      ? trimmed.slice(dotIndex)
      : '';
  const base = extension ? trimmed.slice(0, dotIndex) : trimmed;
  const prefixLength = Math.max(8, maxLength - extension.length - 2);
  return `${base.slice(0, prefixLength)}…${extension}`;
}

export function formatMediaCount(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

export function formatMediaSummary({
  documents,
  photos,
}: {
  documents: number;
  photos: number;
}) {
  return `${formatMediaCount(photos, 'photo')} · ${formatMediaCount(
    documents,
    'document',
  )}`;
}

export function buildMediaMenuActionConfig({
  canArchive,
  canEdit,
  canRestore,
  media,
}: {
  canArchive: boolean;
  canEdit?: boolean;
  canRestore: boolean;
  media: Pick<MediaAsset, 'archivedAt' | 'mediaType'>;
}): MediaMenuActionConfig {
  const options = [mediaMenuViewLabel(media)];
  const keys: MediaMenuActionKey[] = ['VIEW'];

  if (canEdit && !media.archivedAt) {
    options.push('Edit details');
    keys.push('EDIT');
  }

  let destructiveButtonIndex: number | undefined;
  if (canArchive) {
    destructiveButtonIndex = options.length;
    options.push(mediaMenuRemoveLabel(media));
    keys.push('ARCHIVE');
  }

  if (canRestore) {
    options.push(`Restore ${mediaMenuNoun(media)}`);
    keys.push('RESTORE');
  }

  const cancelButtonIndex = options.length;
  options.push('Cancel');
  keys.push('CANCEL');

  return { cancelButtonIndex, destructiveButtonIndex, keys, options };
}

export function getMediaMenuOpenDecision({
  busy,
  isOpen,
  isOpening,
}: MediaMenuOpenDecisionInput): MediaMenuOpenDecision {
  if (busy) return { reason: 'BUSY', shouldOpen: false };
  if (isOpening) return { reason: 'OPENING', shouldOpen: false };
  if (isOpen) return { reason: 'ALREADY_OPEN', shouldOpen: false };
  return { shouldOpen: true };
}

export function isMediaMenuActionForSelectedMedia(
  selectedMediaId: string | null,
  mediaId: string,
) {
  return selectedMediaId === mediaId;
}

export function getMediaMenuActionKeyForIndex(
  config: Pick<MediaMenuActionConfig, 'keys'>,
  selectedIndex: number,
): MediaMenuActionKey | null {
  return config.keys[selectedIndex] ?? null;
}

export function shouldDispatchMediaMenuAction({
  actionKey,
  mediaId,
  selectedMediaId,
}: {
  actionKey: MediaMenuActionKey | null;
  mediaId: string;
  selectedMediaId: string | null;
}) {
  return (
    Boolean(actionKey) &&
    actionKey !== 'CANCEL' &&
    isMediaMenuActionForSelectedMedia(selectedMediaId, mediaId)
  );
}

function looksLikeGeneratedFileName(fileName: string) {
  const nameWithoutExtension = fileName.replace(/\.[^.]+$/, '');
  const compact = nameWithoutExtension.replace(/[-_]/g, '');
  return compact.length >= 24 && /^[a-fA-F0-9]+$/.test(compact);
}

function friendlyMenuCategoryLabel(
  media: Pick<MediaAsset, 'category' | 'originalFileName'>,
) {
  const label = mediaCategoryLabel(media.category);
  if (media.category === 'GENERAL_DOCUMENT' || media.category === 'OTHER') {
    return looksLikeGeneratedFileName(media.originalFileName) ? label : null;
  }
  return label;
}
