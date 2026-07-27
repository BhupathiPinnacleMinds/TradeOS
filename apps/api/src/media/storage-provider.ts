import { createHash, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, normalize, resolve, sep } from 'path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

function safeExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]{1,12})$/);
  return match?.[1] ? `.${match[1]}` : '';
}

function sha256(content: Buffer) {
  return createHash('sha256').update(content).digest('hex');
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
    originalFileName: string;
    mediaType: string;
  }) {
    const extension = safeExtension(input.originalFileName);
    return [
      input.businessId,
      input.mediaType.toLowerCase(),
      `${new Date().toISOString().slice(0, 10)}-${randomBytes(18).toString(
        'hex',
      )}${extension}`,
    ].join('/');
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
    const path = resolve(this.root, normalize(objectKey));
    if (!path.startsWith(this.root)) {
      throw new Error('Invalid storage object key.');
    }
    return path;
  }
}

@Injectable()
export class S3CompatibleStorageProvider implements StorageProvider {
  readonly name = 's3';

  createObjectKey(input: {
    businessId: string;
    originalFileName: string;
    mediaType: string;
  }) {
    const extension = safeExtension(input.originalFileName);
    return [
      input.businessId,
      input.mediaType.toLowerCase(),
      `${new Date().toISOString().slice(0, 10)}-${randomBytes(18).toString(
        'hex',
      )}${extension}`,
    ].join('/');
  }

  createUploadTarget(): Promise<UploadTarget> {
    return Promise.reject(
      new Error(
        'S3-compatible storage is configured but the SDK adapter is not installed yet.',
      ),
    );
  }

  uploadFile(): Promise<StorageObjectMetadata> {
    return Promise.reject(
      new Error(
        'S3-compatible storage is configured but the SDK adapter is not installed yet.',
      ),
    );
  }

  completeUpload(): Promise<StorageObjectMetadata> {
    return Promise.reject(
      new Error(
        'S3-compatible storage is configured but the SDK adapter is not installed yet.',
      ),
    );
  }

  getSignedDownloadUrl(): Promise<UploadTarget> {
    return Promise.reject(
      new Error(
        'S3-compatible storage is configured but the SDK adapter is not installed yet.',
      ),
    );
  }

  getSignedPreviewUrl(): Promise<UploadTarget> {
    return Promise.reject(
      new Error(
        'S3-compatible storage is configured but the SDK adapter is not installed yet.',
      ),
    );
  }

  readObject(): Promise<Buffer> {
    return Promise.reject(
      new Error(
        'S3-compatible storage is configured but the SDK adapter is not installed yet.',
      ),
    );
  }

  deleteObject(): Promise<void> {
    return Promise.reject(
      new Error(
        'S3-compatible storage is configured but the SDK adapter is not installed yet.',
      ),
    );
  }

  objectExists(): Promise<boolean> {
    return Promise.reject(
      new Error(
        'S3-compatible storage is configured but the SDK adapter is not installed yet.',
      ),
    );
  }

  getObjectMetadata(): Promise<StorageObjectMetadata> {
    return Promise.reject(
      new Error(
        'S3-compatible storage is configured but the SDK adapter is not installed yet.',
      ),
    );
  }
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

export function storageProviderFactory(config: ConfigService): StorageProvider {
  return config.get<string>('STORAGE_PROVIDER', 'local') === 's3'
    ? new S3CompatibleStorageProvider()
    : new LocalDevelopmentStorageProvider(config);
}
