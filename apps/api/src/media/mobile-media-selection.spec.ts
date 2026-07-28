import {
  DOCUMENT_UPLOAD_LIMIT_BYTES,
  IMAGE_UPLOAD_LIMIT_BYTES,
  categoriesForMediaType,
  defaultCategoryForMediaType,
  formatFileSize,
  friendlyUploadError,
  isPickerCancelled,
  mediaTypeForMimeType,
  normaliseMimeType,
  uploadButtonLabel,
  validateMediaSelection,
} from '../../../mobile/src/api/mediaSelection';
import {
  closeEvidenceSourceMenu,
  initialMediaPickerControllerState,
  openingLabelForSource,
  openEvidenceSourceMenu,
  pickerLaunchFinished,
  pickerLaunchStarted,
  pickerNativeCallStarted,
  pickerPermissionStarted,
  selectEvidenceSource,
} from '../../../mobile/src/api/mediaPickerController';

describe('mobile media selection helpers', () => {
  it('normalises mime types and file extensions before upload', () => {
    expect(normaliseMimeType('image/jpg', 'switchboard.JPG')).toBe(
      'image/jpeg',
    );
    expect(normaliseMimeType(undefined, 'certificate.pdf')).toBe(
      'application/pdf',
    );
    expect(mediaTypeForMimeType('application/pdf')).toBe('PDF');
    expect(mediaTypeForMimeType('video/mp4')).toBeNull();
  });

  it('uses photo and document categories by media type', () => {
    expect(defaultCategoryForMediaType('IMAGE')).toBe('BEFORE_PHOTO');
    expect(defaultCategoryForMediaType('PDF')).toBe('GENERAL_DOCUMENT');
    expect(categoriesForMediaType('IMAGE')).toContain('AFTER_PHOTO');
    expect(categoriesForMediaType('DOCUMENT')).toContain('RECEIPT');
  });

  it('rejects unsupported and unavailable local files', () => {
    expect(
      validateMediaSelection({
        fileName: 'evidence.mov',
        fileSizeBytes: 1024,
        mimeType: 'video/quicktime',
      }),
    ).toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE', ok: false });

    expect(
      validateMediaSelection({
        fileName: 'missing.jpg',
        fileSizeBytes: null,
        mimeType: 'image/jpeg',
      }),
    ).toMatchObject({ code: 'LOCAL_FILE_UNAVAILABLE', ok: false });
  });

  it('enforces the same upload limits as the media API', () => {
    expect(
      validateMediaSelection({
        fileName: 'site-photo.jpg',
        fileSizeBytes: Math.round(3.4 * 1024 * 1024),
        mimeType: 'image/jpeg',
      }),
    ).toMatchObject({ mediaType: 'IMAGE', ok: true });

    expect(
      validateMediaSelection({
        fileName: 'near-limit-photo.jpg',
        fileSizeBytes: IMAGE_UPLOAD_LIMIT_BYTES - 1,
        mimeType: 'image/jpeg',
      }),
    ).toMatchObject({ mediaType: 'IMAGE', ok: true });

    expect(
      validateMediaSelection({
        fileName: 'large-photo.jpg',
        fileSizeBytes: IMAGE_UPLOAD_LIMIT_BYTES + 1,
        mimeType: 'image/jpeg',
      }),
    ).toMatchObject({ code: 'FILE_TOO_LARGE', ok: false });

    expect(
      validateMediaSelection({
        fileName: 'large-document.pdf',
        fileSizeBytes: DOCUMENT_UPLOAD_LIMIT_BYTES + 1,
        mimeType: 'application/pdf',
      }),
    ).toMatchObject({ code: 'FILE_TOO_LARGE', ok: false });
  });

  it('returns user-facing file size and upload labels', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2.0 MB');
    expect(uploadButtonLabel(0)).toBe('Select evidence first');
    expect(uploadButtonLabel(1)).toBe('Upload 1 file');
    expect(uploadButtonLabel(3)).toBe('Upload 3 files');
  });

  it('detects picker cancellation without treating it as an error', () => {
    expect(isPickerCancelled({ assets: null, canceled: true })).toBe(true);
    expect(isPickerCancelled({ assets: [], type: 'cancel' })).toBe(true);
    expect(isPickerCancelled({ assets: [{}], canceled: false })).toBe(false);
  });

  it('maps raw infrastructure upload errors to friendly messages', () => {
    expect(
      friendlyUploadError({
        code: 'FILE_TOO_LARGE',
        mediaType: 'IMAGE',
        message: 'request entity too large',
      }),
    ).toBe('This image is larger than the 15 MB limit.');

    expect(
      friendlyUploadError({
        code: 'NETWORK_ERROR',
        mediaType: 'PDF',
        message: 'Failed to fetch',
      }),
    ).toBe('Network error. Check the API is running and try again.');

    expect(
      friendlyUploadError({
        code: 'MEDIA_UPLOAD_FAILED',
        mediaType: 'DOCUMENT',
        message: 'MulterError: File too large',
      }),
    ).toBe('This file could not be uploaded. Please try again.');
  });

  it.each([
    ['CAMERA', 'Opening camera...'],
    ['PHOTO_LIBRARY', 'Opening photos...'],
    ['DOCUMENT', 'Opening documents...'],
  ] as const)(
    'keeps the %s source after the sheet becomes hidden',
    (source, label) => {
      const open = openEvidenceSourceMenu(initialMediaPickerControllerState);
      const selected = selectEvidenceSource(open, source);

      expect(selected).toMatchObject({
        isLaunchingPicker: false,
        isSourceMenuOpen: false,
        pendingSource: source,
        phase: 'CLOSING_SHEET',
      });

      expect(openingLabelForSource(source)).toBe(label);
    },
  );

  it('transitions through permission, native call and finally reset states', () => {
    const open = openEvidenceSourceMenu(initialMediaPickerControllerState);
    const selected = selectEvidenceSource(open, 'CAMERA');
    const launching = pickerLaunchStarted(selected, 'CAMERA');
    const permission = pickerPermissionStarted(launching);
    const nativeCall = pickerNativeCallStarted(permission, 'CAMERA');

    expect(launching).toMatchObject({
      activePicker: 'CAMERA',
      isLaunchingPicker: true,
      isSourceMenuOpen: false,
      phase: 'LAUNCHING_CAMERA',
      pendingSource: null,
    });
    expect(permission.phase).toBe('REQUESTING_PERMISSION');
    expect(nativeCall.phase).toBe('LAUNCHING_CAMERA');
    expect(pickerLaunchFinished(nativeCall)).toEqual(
      initialMediaPickerControllerState,
    );
  });

  it('guards duplicate picker launches and resets after cancel or finish', () => {
    const launching = pickerLaunchStarted(
      initialMediaPickerControllerState,
      'PHOTO_LIBRARY',
    );

    expect(selectEvidenceSource(launching, 'CAMERA')).toBe(launching);
    expect(openEvidenceSourceMenu(launching)).toBe(launching);
    expect(pickerLaunchFinished(launching)).toEqual(
      initialMediaPickerControllerState,
    );
  });

  it('cancels pending picker work when the menu is closed without a source', () => {
    const open = openEvidenceSourceMenu(initialMediaPickerControllerState);
    const closed = closeEvidenceSourceMenu(open);

    expect(closed).toEqual(initialMediaPickerControllerState);
  });
});
