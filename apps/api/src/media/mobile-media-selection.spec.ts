import {
  DOCUMENT_UPLOAD_LIMIT_BYTES,
  IMAGE_UPLOAD_LIMIT_BYTES,
  categoriesForMediaType,
  defaultCategoryForMediaType,
  formatFileSize,
  mediaTypeForMimeType,
  normaliseMimeType,
  uploadButtonLabel,
  validateMediaSelection,
} from '../../../mobile/src/api/mediaSelection';

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
});
