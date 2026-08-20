import { createHash, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, normalize, resolve, sep } from 'path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface StorageObjectMetadata {
  contentLength: number;
  contentType?: string;
  checksum?: string;
}

export interface UploadTarget {
  method: 'GET' | 'PUT' | 'POST' | 'LOCAL_API';
  url: string;
  expiresAt: Date;
  headers: Record<string, string>;
  fields?: Record<string, string>;
}

export interface StorageProvider {
  readonly name: string;
  createObjectKey(input: {
    businessId: string;
    entityId?: string | null;
    entityType?:
      | 'appointments'
      | 'customers'
      | 'invoices'
      | 'jobs'
      | 'media'
      | 'payments'
      | 'quotes';
    originalFileName: string;
    mediaType: string;
  }): string;
  createUploadTarget(input: {
    objectKey: string;
    mimeType: string;
    fileSizeBytes: number;
    mediaId: string;
  }): Promise<UploadTarget>;
  uploadFile(input: {
    objectKey: string;
    content: Buffer;
    mimeType: string;
  }): Promise<StorageObjectMetadata>;
  completeUpload(input: { objectKey: string }): Promise<StorageObjectMetadata>;
  getSignedDownloadUrl(input: {
    objectKey: string;
    fileName: string;
    mediaId: string;
  }): Promise<UploadTarget>;
  getSignedPreviewUrl(input: {
    objectKey: string;
    mediaId: string;
  }): Promise<UploadTarget>;
  readObject(input: { objectKey: string }): Promise<Buffer>;
  deleteObject(input: { objectKey: string }): Promise<void>;
  objectExists(input: { objectKey: string }): Promise<boolean>;
  getObjectMetadata(input: {
    objectKey: string;
  }): Promise<StorageObjectMetadata>;
}

type SdkBody = {
  transformToByteArray(): Promise<Uint8Array>;
};

function safeExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]{1,12})$/);
  return match?.[1] ? `.${match[1]}` : '';
}

function sha256(content: Buffer) {
  return createHash('sha256').update(content).digest('hex');
}

function sha256Base64(content: Buffer) {
  return createHash('sha256').update(content).digest('base64');
}

function safeSegment(value: string, fallback: string) {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120);
  return cleaned || fallback;
}

function validateObjectKey(objectKey: string) {
  const normalized = objectKey.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.includes('//') ||
    parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('Invalid storage object key.');
  }
  return normalized;
}

function objectKeyFor(input: {
  businessId: string;
  entityId?: string | null;
  entityType?: string;
  originalFileName: string;
  mediaType: string;
}) {
  const extension = safeExtension(input.originalFileName);
  const entityType = input.entityType
    ? safeSegment(input.entityType, 'media')
    : 'media';
  const entityId = input.entityId
    ? safeSegment(input.entityId, 'unscoped')
    : 'unscoped';
  return validateObjectKey(
    [
      'businesses',
      safeSegment(input.businessId, 'business'),
      entityType,
      entityId,
      safeSegment(input.mediaType.toLowerCase(), 'file'),
      `${new Date().toISOString().slice(0, 10)}-${randomBytes(18).toString(
        'hex',
      )}${extension}`,
    ].join('/'),
  );
}

function isNotFoundError(error: unknown) {
  return error instanceof NotFound || error instanceof NoSuchKey;
}

function isSdkBody(body: unknown): body is SdkBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    'transformToByteArray' in body &&
    typeof (body as SdkBody).transformToByteArray === 'function'
  );
}

function contentDisposition(type: 'attachment' | 'inline', fileName?: string) {
  const safeFileName = (fileName ?? 'download')
    .replace(/[\r\n"]/g, '')
    .slice(0, 180);
  return `${type}; filename="${safeFileName || 'download'}"`;
}

@Injectable()
export class LocalDevelopmentStorageProvider implements StorageProvider {
  readonly name = 'local';
  private readonly root: string;

  constructor(private readonly config: ConfigService) {
    const isApiWorkspace = process.cwd().endsWith(`${sep}apps${sep}api`);
    this.root = resolve(
      this.config.get<string>(
        'STORAGE_LOCAL_PATH',
        isApiWorkspace ? '.local-storage' : 'apps/api/.local-storage',
      ),
    );
  }

  createObjectKey(input: {
    businessId: string;
    entityId?: string | null;
    entityType?:
      | 'appointments'
      | 'customers'
      | 'invoices'
      | 'jobs'
      | 'media'
      | 'payments'
      | 'quotes';
    originalFileName: string;
    mediaType: string;
  }) {
    return objectKeyFor(input);
  }

  createUploadTarget(input: {
    objectKey: string;
    mimeType: string;
    fileSizeBytes: number;
    mediaId: string;
  }) {
    return Promise.resolve({
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      headers: { 'Content-Type': input.mimeType },
      method: 'LOCAL_API' as const,
      url: `/media/${input.mediaId}/local-upload`,
    });
  }

  async uploadFile(input: {
    objectKey: string;
    content: Buffer;
    mimeType: string;
  }) {
    const path = this.pathForObject(input.objectKey);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, input.content);
    return {
      checksum: sha256(input.content),
      contentLength: input.content.length,
      contentType: input.mimeType,
    };
  }

  async completeUpload(input: { objectKey: string }) {
    return this.getObjectMetadata(input);
  }

  getSignedDownloadUrl(input: {
    objectKey: string;
    fileName: string;
    mediaId: string;
  }) {
    return Promise.resolve({
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      headers: {},
      method: 'GET' as const,
      url: `/media/${input.mediaId}/file?disposition=attachment`,
    });
  }

  getSignedPreviewUrl(input: { objectKey: string; mediaId: string }) {
    return Promise.resolve({
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      headers: {},
      method: 'GET' as const,
      url: `/media/${input.mediaId}/file?disposition=inline`,
    });
  }

  async readObject(input: { objectKey: string }) {
    return fs.readFile(this.pathForObject(input.objectKey));
  }

  async deleteObject(input: { objectKey: string }) {
    await fs.rm(this.pathForObject(input.objectKey), { force: true });
  }

  async objectExists(input: { objectKey: string }) {
    try {
      const stat = await fs.stat(this.pathForObject(input.objectKey));
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async getObjectMetadata(input: { objectKey: string }) {
    const path = this.pathForObject(input.objectKey);
    const content = await fs.readFile(path);
    return {
      checksum: sha256(content),
      contentLength: content.length,
    };
  }

  private pathForObject(objectKey: string) {
    const safeObjectKey = validateObjectKey(objectKey);
    const path = resolve(this.root, normalize(safeObjectKey));
    if (path !== this.root && !path.startsWith(`${this.root}${sep}`)) {
      throw new Error('Invalid storage object key.');
    }
    return path;
  }
}

@Injectable()
export class S3CompatibleStorageProvider implements StorageProvider {
  readonly name = 's3';
  private readonly bucket: string;
  private readonly client: S3Client;
  private readonly signedUrlTtlSeconds: number;

  constructor(config: ConfigService) {
    this.bucket = requiredStorageConfig(config, 'S3_BUCKET');
    this.signedUrlTtlSeconds = positiveIntegerConfig(
      config,
      'S3_SIGNED_URL_TTL_SECONDS',
      5 * 60,
    );
    const region = requiredStorageConfig(config, 'S3_REGION');
    const endpoint = optionalStorageConfig(config, 'S3_ENDPOINT');
    const clientConfig: S3ClientConfig = {
      credentials: {
        accessKeyId: requiredStorageConfig(config, 'S3_ACCESS_KEY_ID'),
        secretAccessKey: requiredStorageConfig(config, 'S3_SECRET_ACCESS_KEY'),
      },
      forcePathStyle: booleanConfig(config, 'S3_FORCE_PATH_STYLE'),
      region,
    };
    if (endpoint) {
      clientConfig.endpoint = endpoint;
    }
    this.client = new S3Client(clientConfig);
  }

  createObjectKey(input: {
    businessId: string;
    entityId?: string | null;
    entityType?:
      | 'appointments'
      | 'customers'
      | 'invoices'
      | 'jobs'
      | 'media'
      | 'payments'
      | 'quotes';
    originalFileName: string;
    mediaType: string;
  }) {
    return objectKeyFor(input);
  }

  async createUploadTarget(input: {
    objectKey: string;
    mimeType: string;
    fileSizeBytes: number;
    mediaId: string;
  }): Promise<UploadTarget> {
    const objectKey = validateObjectKey(input.objectKey);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      ContentLength: input.fileSizeBytes,
      ContentType: input.mimeType,
      Key: objectKey,
      Metadata: { mediaId: input.mediaId },
    });
    return {
      expiresAt: new Date(Date.now() + this.signedUrlTtlSeconds * 1000),
      headers: { 'Content-Type': input.mimeType },
      method: 'PUT',
      url: await getSignedUrl(this.client, command, {
        expiresIn: this.signedUrlTtlSeconds,
      }),
    };
  }

  async uploadFile(input: {
    objectKey: string;
    content: Buffer;
    mimeType: string;
  }): Promise<StorageObjectMetadata> {
    const objectKey = validateObjectKey(input.objectKey);
    const checksum = sha256(input.content);
    await this.client.send(
      new PutObjectCommand({
        Body: input.content,
        Bucket: this.bucket,
        ChecksumSHA256: sha256Base64(input.content),
        ContentLength: input.content.length,
        ContentType: input.mimeType,
        Key: objectKey,
        Metadata: { sha256: checksum },
      }),
    );
    return {
      checksum,
      contentLength: input.content.length,
      contentType: input.mimeType,
    };
  }

  completeUpload(input: { objectKey: string }): Promise<StorageObjectMetadata> {
    return this.getObjectMetadata(input);
  }

  async getSignedDownloadUrl(input: {
    objectKey: string;
    fileName: string;
    mediaId: string;
  }): Promise<UploadTarget> {
    const objectKey = validateObjectKey(input.objectKey);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ResponseContentDisposition: contentDisposition(
        'attachment',
        input.fileName,
      ),
    });
    return {
      expiresAt: new Date(Date.now() + this.signedUrlTtlSeconds * 1000),
      headers: {},
      method: 'GET',
      url: await getSignedUrl(this.client, command, {
        expiresIn: this.signedUrlTtlSeconds,
      }),
    };
  }

  async getSignedPreviewUrl(input: {
    objectKey: string;
    mediaId: string;
  }): Promise<UploadTarget> {
    const objectKey = validateObjectKey(input.objectKey);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ResponseContentDisposition: contentDisposition('inline'),
    });
    return {
      expiresAt: new Date(Date.now() + this.signedUrlTtlSeconds * 1000),
      headers: {},
      method: 'GET',
      url: await getSignedUrl(this.client, command, {
        expiresIn: this.signedUrlTtlSeconds,
      }),
    };
  }

  async readObject(input: { objectKey: string }): Promise<Buffer> {
    const objectKey = validateObjectKey(input.objectKey);
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    if (!isSdkBody(response.Body)) {
      throw new Error('Storage object body is not readable.');
    }
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async deleteObject(input: { objectKey: string }): Promise<void> {
    const objectKey = validateObjectKey(input.objectKey);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
  }

  async objectExists(input: { objectKey: string }): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: validateObjectKey(input.objectKey),
        }),
      );
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  }

  async getObjectMetadata(input: {
    objectKey: string;
  }): Promise<StorageObjectMetadata> {
    const objectKey = validateObjectKey(input.objectKey);
    const response = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    return {
      checksum: response.Metadata?.sha256,
      contentLength: response.ContentLength ?? 0,
      contentType: response.ContentType,
    };
  }
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

export function storageProviderFactory(config: ConfigService): StorageProvider {
  return config.get<string>('STORAGE_PROVIDER', 'local') === 's3'
    ? new S3CompatibleStorageProvider(config)
    : new LocalDevelopmentStorageProvider(config);
}

function optionalStorageConfig(config: ConfigService, key: string) {
  const value = config.get<string>(key);
  return value?.trim() || undefined;
}

function requiredStorageConfig(config: ConfigService, key: string) {
  const value = optionalStorageConfig(config, key);
  if (!value) {
    throw new Error(`${key} is required when STORAGE_PROVIDER=s3.`);
  }
  return value;
}

function booleanConfig(config: ConfigService, key: string) {
  return ['1', 'true', 'yes'].includes(
    config.get<string>(key, 'false').trim().toLowerCase(),
  );
}

function positiveIntegerConfig(
  config: ConfigService,
  key: string,
  fallback: number,
) {
  const value = Number(config.get<string>(key, String(fallback)));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
