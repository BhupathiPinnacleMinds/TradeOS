import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import {
  ApiRequestError,
  buildAuthenticatedHeaders,
  quotePdfUrl,
} from './client';

declare const __DEV__: boolean;

const QUOTE_CACHE_DIR = `${FileSystem.cacheDirectory ?? ''}tradieos-quotes/`;

function safeFileName(fileName: string) {
  const cleaned = fileName
    .replace(/[\\/:*?"<>|\0]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'quote.pdf';
}

export async function downloadAuthenticatedQuotePdf(
  token: string,
  quoteId: string,
  fileName: string,
) {
  const url = quotePdfUrl(quoteId);

  if (Platform.OS === 'web') {
    const response = await fetch(url, {
      headers: buildAuthenticatedHeaders(token),
    }).catch((error: unknown) => {
      throw new ApiRequestError(
        error instanceof Error ? error.message : 'Network request failed',
        null,
        'QUOTE_PDF_DOWNLOAD_FAILED',
      );
    });

    if (!response.ok) {
      throw new ApiRequestError(
        "We couldn't open this quote PDF.",
        response.status,
        response.status === 403 || response.status === 401
          ? 'QUOTE_ACCESS_DENIED'
          : 'QUOTE_PDF_DOWNLOAD_FAILED',
      );
    }

    return URL.createObjectURL(await response.blob());
  }

  if (!FileSystem.cacheDirectory) {
    throw new ApiRequestError(
      'Secure cache is not available on this device.',
      null,
      'QUOTE_PDF_DOWNLOAD_FAILED',
    );
  }

  await FileSystem.makeDirectoryAsync(QUOTE_CACHE_DIR, {
    intermediates: true,
  }).catch(() => undefined);

  const localUri = `${QUOTE_CACHE_DIR}${quoteId}-${safeFileName(fileName)}`;
  const result = await FileSystem.downloadAsync(url, localUri, {
    headers: buildAuthenticatedHeaders(token),
  }).catch((error: unknown) => {
    if (__DEV__) {
      console.warn('[TradieOS quote PDF download failed]', {
        code: 'QUOTE_PDF_DOWNLOAD_FAILED',
        message: error instanceof Error ? error.message : String(error),
        quoteId,
      });
    }
    throw new ApiRequestError(
      "We couldn't open this quote PDF.",
      null,
      'QUOTE_PDF_DOWNLOAD_FAILED',
    );
  });

  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(
      () => undefined,
    );
    throw new ApiRequestError(
      result.status === 403 || result.status === 401
        ? "You don't have access to this quote PDF."
        : "We couldn't open this quote PDF.",
      result.status,
      result.status === 403 || result.status === 401
        ? 'QUOTE_ACCESS_DENIED'
        : 'QUOTE_PDF_DOWNLOAD_FAILED',
    );
  }

  return result.uri;
}
