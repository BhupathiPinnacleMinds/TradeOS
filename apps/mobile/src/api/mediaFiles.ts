import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import type { MediaAsset } from '@tradieos/shared';
import {
  ApiRequestError,
  buildApiUrl,
  buildAuthenticatedHeaders,
  buildMediaFilePath,
} from './client';

declare const __DEV__: boolean;

const MEDIA_CACHE_DIR = `${FileSystem.cacheDirectory ?? ''}tradieos-media/`;

function safeFileName(fileName: string) {
  const cleaned = fileName
    .replace(/[\\/:*?"<>|\0]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'tradieos-file';
}

export function mediaCacheFileName(
  media: Pick<MediaAsset, 'id' | 'originalFileName'>,
) {
  return `${media.id}-${safeFileName(media.originalFileName)}`.slice(0, 180);
}

export async function downloadAuthenticatedMediaFile(
  token: string,
  media: Pick<MediaAsset, 'id' | 'originalFileName'>,
  disposition: 'attachment' | 'inline' = 'inline',
) {
  const url = buildApiUrl(buildMediaFilePath(media.id, disposition));

  if (Platform.OS === 'web') {
    const response = await fetch(url, {
      headers: buildAuthenticatedHeaders(token),
    }).catch((error: unknown) => {
      throw new ApiRequestError(
        error instanceof Error ? error.message : 'Network request failed',
        null,
        'NETWORK_ERROR',
      );
    });

    if (!response.ok) {
      throw new ApiRequestError(
        "We couldn't open this file.",
        response.status,
        response.status === 403
          ? 'MEDIA_ACCESS_DENIED'
          : 'MEDIA_DOWNLOAD_FAILED',
      );
    }

    return URL.createObjectURL(await response.blob());
  }

  if (!FileSystem.cacheDirectory) {
    throw new ApiRequestError(
      'Secure cache is not available on this device.',
      null,
      'MEDIA_DOWNLOAD_FAILED',
    );
  }

  await FileSystem.makeDirectoryAsync(MEDIA_CACHE_DIR, {
    intermediates: true,
  }).catch(() => undefined);

  const localUri = `${MEDIA_CACHE_DIR}${mediaCacheFileName(media)}`;
  const result = await FileSystem.downloadAsync(url, localUri, {
    headers: buildAuthenticatedHeaders(token),
  }).catch((error: unknown) => {
    if (__DEV__) {
      console.warn('[TradieOS media download failed]', {
        code: 'MEDIA_DOWNLOAD_FAILED',
        mediaId: media.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    throw new ApiRequestError(
      "We couldn't open this file.",
      null,
      'MEDIA_DOWNLOAD_FAILED',
    );
  });

  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(
      () => undefined,
    );
    throw new ApiRequestError(
      result.status === 403 || result.status === 401
        ? "You don't have access to this file."
        : "We couldn't open this file.",
      result.status,
      result.status === 403 || result.status === 401
        ? 'MEDIA_ACCESS_DENIED'
        : result.status === 404
          ? 'MEDIA_FILE_NOT_FOUND'
          : 'MEDIA_DOWNLOAD_FAILED',
    );
  }

  return result.uri;
}
