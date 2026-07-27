import {
  buildApiUrl,
  buildApiRequestUrl,
  buildAuthenticatedHeaders,
  buildMediaAccessUrl,
  buildMediaDownloadPath,
  buildMediaFilePath,
  buildMediaListPath,
  buildMediaLocalUploadPath,
  buildMediaPreviewPath,
} from '../../../mobile/src/api/client';
import {
  mediaCategoryLabel,
  mediaTypeLabel,
} from '../../../../packages/shared/src/media';

describe('mobile media API client path helpers', () => {
  it('builds /media under the shared /api base URL exactly once', () => {
    expect(buildApiRequestUrl('/media')).toBe(
      'http://localhost:3000/api/media',
    );
    expect(buildApiRequestUrl('/api/media')).toBe(
      'http://localhost:3000/api/media',
    );
    expect(buildApiUrl('/api/media/file', 'https://app.example.com/api')).toBe(
      'https://app.example.com/api/media/file',
    );
    expect(buildApiUrl('/media/file', 'http://192.168.0.234:3000/api/')).toBe(
      'http://192.168.0.234:3000/api/media/file',
    );
    expect(buildApiUrl('/api/media/file', 'https://api.tradieos.com/v1')).toBe(
      'https://api.tradieos.com/v1/api/media/file',
    );
  });

  it('builds media access paths without duplicating the API prefix', () => {
    expect(buildMediaPreviewPath('media-1')).toBe('/media/media-1/preview');
    expect(buildMediaDownloadPath('media-1')).toBe('/media/media-1/download');
    expect(buildMediaFilePath('media-1')).toBe(
      '/media/media-1/file?disposition=inline',
    );
    expect(buildMediaFilePath('media-1', 'attachment')).toBe(
      '/media/media-1/file?disposition=attachment',
    );
    expect(buildMediaLocalUploadPath('media-1')).toBe(
      '/media/media-1/local-upload',
    );
    expect(
      buildMediaAccessUrl(
        '/api/media/media-1/file',
        'http://localhost:3000/api',
      ),
    ).toBe('http://localhost:3000/api/media/media-1/file');
  });

  it('builds authenticated media download headers', () => {
    expect(buildAuthenticatedHeaders('token-123')).toEqual({
      Authorization: 'Bearer token-123',
    });
  });

  it('uses the provided appointment ID in the media list path', () => {
    expect(buildMediaListPath({ appointmentId: 'actual-appointment-id' })).toBe(
      '/media?appointmentId=actual-appointment-id',
    );
  });

  it('does not include missing appointment IDs in the media list path', () => {
    expect(buildMediaListPath({ appointmentId: undefined })).toBe('/media');
  });

  it('uses consistent user-facing media labels', () => {
    expect(mediaCategoryLabel('BEFORE_PHOTO')).toBe('Before photo');
    expect(mediaCategoryLabel('COMPLIANCE_CERTIFICATE')).toBe(
      'Compliance certificate',
    );
    expect(mediaCategoryLabel('RECEIPT')).toBe('Receipt');
    expect(mediaTypeLabel('IMAGE')).toBe('Image');
    expect(mediaTypeLabel('PDF')).toBe('PDF');
  });
});
