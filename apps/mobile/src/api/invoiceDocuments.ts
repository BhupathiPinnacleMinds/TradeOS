import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';
import {
  ApiRequestError,
  buildAuthenticatedHeaders,
  invoicePaymentReceiptUrl,
  invoicePdfUrl,
} from './client';

declare const __DEV__: boolean;

const INVOICE_CACHE_DIR = `${FileSystem.cacheDirectory ?? ''}tradieos-invoices/`;
const ANDROID_GRANT_READ_URI_PERMISSION = 1;
const ANDROID_VIEW_ACTION = 'android.intent.action.VIEW';
const INVOICE_PDF_MIME_TYPE = 'application/pdf';

function safeFileName(fileName: string) {
  const cleaned = fileName
    .replace(/[\\/:*?"<>|\0]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'invoice.pdf';
}

export async function downloadAuthenticatedInvoicePdf(
  token: string,
  invoiceId: string,
  fileName: string,
) {
  const url = invoicePdfUrl(invoiceId);

  if (Platform.OS === 'web') {
    const response = await fetch(url, {
      headers: buildAuthenticatedHeaders(token),
    }).catch((error: unknown) => {
      throw new ApiRequestError(
        error instanceof Error ? error.message : 'Network request failed',
        null,
        'INVOICE_PDF_DOWNLOAD_FAILED',
      );
    });

    if (!response.ok) {
      throw new ApiRequestError(
        "We couldn't open this invoice PDF.",
        response.status,
        response.status === 403 || response.status === 401
          ? 'INVOICE_ACCESS_DENIED'
          : 'INVOICE_PDF_DOWNLOAD_FAILED',
      );
    }

    return URL.createObjectURL(await response.blob());
  }

  if (!FileSystem.cacheDirectory) {
    throw new ApiRequestError(
      'Secure cache is not available on this device.',
      null,
      'INVOICE_PDF_DOWNLOAD_FAILED',
    );
  }

  await FileSystem.makeDirectoryAsync(INVOICE_CACHE_DIR, {
    intermediates: true,
  }).catch(() => undefined);

  const localUri = `${INVOICE_CACHE_DIR}${invoiceId}-${safeFileName(fileName)}`;
  const result = await FileSystem.downloadAsync(url, localUri, {
    headers: buildAuthenticatedHeaders(token),
  }).catch((error: unknown) => {
    if (__DEV__) {
      console.warn('[TradieOS invoice PDF download failed]', {
        code: 'INVOICE_PDF_DOWNLOAD_FAILED',
        invoiceId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    throw new ApiRequestError(
      "We couldn't open this invoice PDF.",
      null,
      'INVOICE_PDF_DOWNLOAD_FAILED',
    );
  });

  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(
      () => undefined,
    );
    throw new ApiRequestError(
      result.status === 403 || result.status === 401
        ? "You don't have access to this invoice PDF."
        : "We couldn't open this invoice PDF.",
      result.status,
      result.status === 403 || result.status === 401
        ? 'INVOICE_ACCESS_DENIED'
        : 'INVOICE_PDF_DOWNLOAD_FAILED',
    );
  }

  return result.uri;
}

export async function openDownloadedInvoicePdf(
  localUri: string,
  invoiceId: string,
) {
  await openDownloadedInvoiceDocument({
    downloadErrorCode: 'INVOICE_PDF_DOWNLOAD_FAILED',
    errorCode: 'INVOICE_PDF_OPEN_FAILED',
    fileCheckErrorCode: 'INVOICE_PDF_LOCAL_FILE_CHECK_FAILED',
    invoiceId,
    localUri,
    message: "We couldn't open this invoice PDF.",
  });
}

export async function downloadAuthenticatedInvoicePaymentReceipt(
  token: string,
  invoiceId: string,
  paymentId: string,
  fileName: string,
) {
  const url = invoicePaymentReceiptUrl(invoiceId, paymentId);

  if (Platform.OS === 'web') {
    const response = await fetch(url, {
      headers: buildAuthenticatedHeaders(token),
    }).catch((error: unknown) => {
      throw new ApiRequestError(
        error instanceof Error ? error.message : 'Network request failed',
        null,
        'INVOICE_RECEIPT_DOWNLOAD_FAILED',
      );
    });

    if (!response.ok) {
      throw new ApiRequestError(
        "We couldn't open this payment receipt.",
        response.status,
        response.status === 403 || response.status === 401
          ? 'INVOICE_ACCESS_DENIED'
          : 'INVOICE_RECEIPT_DOWNLOAD_FAILED',
      );
    }

    return URL.createObjectURL(await response.blob());
  }

  if (!FileSystem.cacheDirectory) {
    throw new ApiRequestError(
      'Secure cache is not available on this device.',
      null,
      'INVOICE_RECEIPT_DOWNLOAD_FAILED',
    );
  }

  await FileSystem.makeDirectoryAsync(INVOICE_CACHE_DIR, {
    intermediates: true,
  }).catch(() => undefined);

  const localUri = `${INVOICE_CACHE_DIR}${paymentId}-${safeFileName(fileName)}`;
  const result = await FileSystem.downloadAsync(url, localUri, {
    headers: buildAuthenticatedHeaders(token),
  }).catch((error: unknown) => {
    if (__DEV__) {
      console.warn('[TradieOS invoice receipt download failed]', {
        code: 'INVOICE_RECEIPT_DOWNLOAD_FAILED',
        invoiceId,
        message: error instanceof Error ? error.message : String(error),
        paymentId,
      });
    }
    throw new ApiRequestError(
      "We couldn't open this payment receipt.",
      null,
      'INVOICE_RECEIPT_DOWNLOAD_FAILED',
    );
  });

  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(
      () => undefined,
    );
    throw new ApiRequestError(
      result.status === 403 || result.status === 401
        ? "You don't have access to this payment receipt."
        : "We couldn't open this payment receipt.",
      result.status,
      result.status === 403 || result.status === 401
        ? 'INVOICE_ACCESS_DENIED'
        : 'INVOICE_RECEIPT_DOWNLOAD_FAILED',
    );
  }

  return result.uri;
}

export async function openDownloadedInvoicePaymentReceipt(
  localUri: string,
  invoiceId: string,
  paymentId: string,
) {
  await openDownloadedInvoiceDocument({
    downloadErrorCode: 'INVOICE_RECEIPT_DOWNLOAD_FAILED',
    errorCode: 'INVOICE_RECEIPT_OPEN_FAILED',
    fileCheckErrorCode: 'INVOICE_RECEIPT_LOCAL_FILE_CHECK_FAILED',
    invoiceId,
    localUri,
    message: "We couldn't open this payment receipt.",
    paymentId,
  });
}

async function openDownloadedInvoiceDocument({
  errorCode,
  downloadErrorCode,
  fileCheckErrorCode,
  invoiceId,
  localUri,
  message,
  paymentId,
}: {
  errorCode: string;
  downloadErrorCode: string;
  fileCheckErrorCode: string;
  invoiceId: string;
  localUri: string;
  message: string;
  paymentId?: string;
}) {
  if (Platform.OS === 'web') {
    await Linking.openURL(localUri);
    return;
  }

  const fileInfo = await FileSystem.getInfoAsync(localUri).catch(
    (error: unknown) => {
      if (__DEV__) {
        console.warn('[TradieOS invoice PDF open file check failed]', {
          code: fileCheckErrorCode,
          invoiceId,
          message: error instanceof Error ? error.message : String(error),
          paymentId,
        });
      }
      return null;
    },
  );

  if (!fileInfo?.exists) {
    throw new ApiRequestError(message, null, downloadErrorCode);
  }

  try {
    if (Platform.OS === 'android') {
      const contentUri = await FileSystem.getContentUriAsync(localUri);
      await IntentLauncher.startActivityAsync(ANDROID_VIEW_ACTION, {
        data: contentUri,
        flags: ANDROID_GRANT_READ_URI_PERMISSION,
        type: INVOICE_PDF_MIME_TYPE,
      });
      return;
    }

    await Linking.openURL(localUri);
  } catch (error) {
    if (__DEV__) {
      console.warn('[TradieOS invoice PDF open failed]', {
        code: errorCode,
        invoiceId,
        message: error instanceof Error ? error.message : String(error),
        paymentId,
      });
    }
    throw new ApiRequestError(message, null, errorCode);
  }
}
