import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ConfigService } from '@nestjs/config';
import {
  LocalDevelopmentStorageProvider,
  S3CompatibleStorageProvider,
  storageProviderFactory,
} from './storage-provider';

const mockSend = jest.fn();
const mockGetSignedUrl = jest.fn<Promise<string>, unknown[]>();

jest.mock('@aws-sdk/client-s3', () => {
  class MockNotFound extends Error {}
  return {
    DeleteObjectCommand: jest
      .fn()
      .mockImplementation((input: unknown) => ({ input, type: 'delete' })),
    GetObjectCommand: jest
      .fn()
      .mockImplementation((input: unknown) => ({ input, type: 'get' })),
    HeadObjectCommand: jest
      .fn()
      .mockImplementation((input: unknown) => ({ input, type: 'head' })),
    NoSuchKey: MockNotFound,
    NotFound: MockNotFound,
    PutObjectCommand: jest
      .fn()
      .mockImplementation((input: unknown) => ({ input, type: 'put' })),
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

function config(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

describe('StorageProvider', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockGetSignedUrl.mockReset();
  });

  it('keeps local development storage working without S3 credentials', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'tradieos-storage-'));
    const provider = new LocalDevelopmentStorageProvider(
      config({ STORAGE_LOCAL_PATH: root }),
    );
    const objectKey = provider.createObjectKey({
      businessId: 'business-1',
      entityId: 'job-1',
      entityType: 'jobs',
      mediaType: 'IMAGE',
      originalFileName: 'before photo.png',
    });

    await provider.uploadFile({
      content: Buffer.from('demo'),
      mimeType: 'image/png',
      objectKey,
    });

    await expect(provider.readObject({ objectKey })).resolves.toEqual(
      Buffer.from('demo'),
    );
    await expect(provider.objectExists({ objectKey })).resolves.toBe(true);
    await fs.rm(root, { force: true, recursive: true });
  });

  it('creates tenant-scoped object keys and strips unsafe filename paths', () => {
    const provider = new LocalDevelopmentStorageProvider(config({}));

    const objectKey = provider.createObjectKey({
      businessId: 'business-1',
      entityId: 'appointment-1',
      entityType: 'appointments',
      mediaType: 'PDF',
      originalFileName: '../private/invoice.pdf',
    });

    expect(objectKey).toMatch(
      /^businesses\/business-1\/appointments\/appointment-1\/pdf\//,
    );
    expect(objectKey).not.toContain('..');
    expect(objectKey).not.toContain('\\');
  });

  it('blocks path traversal object keys for local reads', async () => {
    const provider = new LocalDevelopmentStorageProvider(config({}));

    await expect(
      provider.readObject({ objectKey: '../business-2/private.pdf' }),
    ).rejects.toThrow(/Invalid storage object key/);
  });

  it('fails fast when S3 storage is selected without required config', () => {
    expect(() => new S3CompatibleStorageProvider(config({}))).toThrow(
      /S3_BUCKET is required/,
    );
    expect(() =>
      storageProviderFactory(config({ STORAGE_PROVIDER: 's3' })),
    ).toThrow(/S3_BUCKET is required/);
  });

  it('creates private S3-compatible upload and download URLs', async () => {
    mockGetSignedUrl.mockResolvedValue('https://signed.example/upload');
    const provider = new S3CompatibleStorageProvider(
      config({
        S3_ACCESS_KEY_ID: 'access',
        S3_BUCKET: 'tradieos-prod',
        S3_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
        S3_FORCE_PATH_STYLE: 'true',
        S3_REGION: 'auto',
        S3_SECRET_ACCESS_KEY: 'secret',
      }),
    );
    const objectKey = provider.createObjectKey({
      businessId: 'business-1',
      entityId: 'quote-1',
      entityType: 'quotes',
      mediaType: 'PDF',
      originalFileName: 'Quote A.pdf',
    });

    const upload = await provider.createUploadTarget({
      fileSizeBytes: 10,
      mediaId: 'media-1',
      mimeType: 'application/pdf',
      objectKey,
    });
    const download = await provider.getSignedDownloadUrl({
      fileName: 'Quote A.pdf',
      mediaId: 'media-1',
      objectKey,
    });

    expect(objectKey).toMatch(/^businesses\/business-1\/quotes\/quote-1\/pdf/);
    expect(upload).toMatchObject({
      headers: { 'Content-Type': 'application/pdf' },
      method: 'PUT',
      url: 'https://signed.example/upload',
    });
    expect(download.method).toBe('GET');
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('uploads generated PDFs to S3-compatible storage with checksums', async () => {
    mockSend.mockResolvedValue({});
    const provider = new S3CompatibleStorageProvider(
      config({
        S3_ACCESS_KEY_ID: 'access',
        S3_BUCKET: 'tradieos-prod',
        S3_REGION: 'ap-southeast-2',
        S3_SECRET_ACCESS_KEY: 'secret',
      }),
    );

    const metadata = await provider.uploadFile({
      content: Buffer.from('pdf-content'),
      mimeType: 'application/pdf',
      objectKey: 'businesses/business-1/invoices/invoice-1/pdf/file.pdf',
    });

    expect(metadata).toMatchObject({
      contentLength: 11,
      contentType: 'application/pdf',
    });
    expect(metadata.checksum).toHaveLength(64);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'put' }),
    );
  });

  it('reads S3-compatible objects and metadata through the provider abstraction', async () => {
    mockSend
      .mockResolvedValueOnce({
        Body: {
          transformToByteArray: () =>
            Promise.resolve(Uint8Array.from(Buffer.from('stored'))),
        },
      })
      .mockResolvedValueOnce({
        ContentLength: 6,
        ContentType: 'application/pdf',
        Metadata: { sha256: 'checksum' },
      });
    const provider = new S3CompatibleStorageProvider(
      config({
        S3_ACCESS_KEY_ID: 'access',
        S3_BUCKET: 'tradieos-prod',
        S3_REGION: 'ap-southeast-2',
        S3_SECRET_ACCESS_KEY: 'secret',
      }),
    );

    await expect(
      provider.readObject({
        objectKey: 'businesses/business-1/quotes/quote-1/pdf/file.pdf',
      }),
    ).resolves.toEqual(Buffer.from('stored'));
    await expect(
      provider.getObjectMetadata({
        objectKey: 'businesses/business-1/quotes/quote-1/pdf/file.pdf',
      }),
    ).resolves.toEqual({
      checksum: 'checksum',
      contentLength: 6,
      contentType: 'application/pdf',
    });
  });
});
