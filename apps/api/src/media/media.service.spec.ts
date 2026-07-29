/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import { HttpException } from '@nestjs/common';
import type { AuthenticatedUser } from '@tradieos/shared';
import { IMAGE_LIMIT, MediaService } from './media.service';
import type { StorageProvider } from './storage-provider';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

const owner: AuthenticatedUser = {
  businessId: 'business-1',
  email: 'owner@example.test',
  id: 'owner-1',
  role: 'OWNER',
};

const technician: AuthenticatedUser = {
  businessId: 'business-1',
  email: 'tech@example.test',
  id: 'tech-1',
  role: 'TECHNICIAN',
};

const otherTechnician: AuthenticatedUser = {
  businessId: 'business-1',
  email: 'other-tech@example.test',
  id: 'other-tech-1',
  role: 'TECHNICIAN',
};

const readOnly: AuthenticatedUser = {
  businessId: 'business-1',
  email: 'readonly@example.test',
  id: 'readonly-1',
  role: 'READ_ONLY',
};

function media(overrides: Record<string, unknown> = {}) {
  return {
    archivedAt: null,
    appointment: {
      assignedUserId: 'tech-1',
      id: 'appointment-1',
      status: 'CONFIRMED',
    },
    appointmentId: 'appointment-1',
    businessId: 'business-1',
    caption: null,
    category: 'BEFORE_PHOTO',
    checksum: null,
    createdAt: new Date('2026-07-27T00:00:00.000Z'),
    customerId: 'customer-1',
    durationSeconds: null,
    fileSizeBytes: 4,
    height: 1,
    id: 'media-1',
    isCustomerVisible: false,
    job: { assignedToUserId: 'tech-1', id: 'job-1' },
    jobId: 'job-1',
    mediaType: 'IMAGE',
    mimeType: 'image/png',
    notes: null,
    objectKey: 'business-1/image/demo.png',
    originalFileName: 'demo.png',
    processingStatus: 'PENDING',
    storageProvider: 'local',
    updatedAt: new Date('2026-07-27T00:00:00.000Z'),
    uploadedBy: {
      email: 'tech@example.test',
      firstName: 'Mia',
      id: 'tech-1',
      lastName: 'Technician',
    },
    uploadedByUserId: 'tech-1',
    uploadStatus: 'PENDING',
    width: 1,
    ...overrides,
  };
}

function createHarness() {
  const createdMedia = media();
  const tx = {
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    mediaAsset: {
      create: jest.fn().mockResolvedValue(createdMedia),
      update: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve(
            media({ ...data, uploadStatus: data.uploadStatus ?? 'COMPLETED' }),
          ),
        ),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (input) =>
      Array.isArray(input) ? Promise.all(input) : input(tx),
    ),
    appointment: {
      findFirst: jest.fn().mockResolvedValue({
        assignedUserId: 'tech-1',
        id: 'appointment-1',
        job: { customerId: 'customer-1', id: 'job-1' },
        jobId: 'job-1',
      }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    customer: { findFirst: jest.fn().mockResolvedValue({ id: 'customer-1' }) },
    job: {
      findFirst: jest.fn().mockResolvedValue({
        assignedToUserId: 'tech-1',
        customerId: 'customer-1',
        id: 'job-1',
      }),
    },
    mediaAsset: {
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn().mockResolvedValue(createdMedia),
      findMany: jest.fn().mockResolvedValue([createdMedia]),
      update: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve(
            media({ ...data, uploadStatus: data.uploadStatus ?? 'COMPLETED' }),
          ),
        ),
    },
  };
  const storage: StorageProvider = {
    completeUpload: jest
      .fn()
      .mockResolvedValue({ checksum: 'abc', contentLength: 4 }),
    createObjectKey: jest.fn().mockReturnValue('business-1/image/demo.png'),
    createUploadTarget: jest.fn().mockResolvedValue({
      expiresAt: new Date('2026-07-27T00:10:00.000Z'),
      headers: { 'Content-Type': 'image/png' },
      method: 'LOCAL_API',
      url: '/media/media-1/local-upload',
    }),
    deleteObject: jest.fn().mockResolvedValue(undefined),
    getObjectMetadata: jest
      .fn()
      .mockResolvedValue({ checksum: 'abc', contentLength: 4 }),
    getSignedDownloadUrl: jest.fn().mockResolvedValue({
      expiresAt: new Date('2026-07-27T00:05:00.000Z'),
      headers: {},
      method: 'GET',
      url: '/media/media-1/file',
    }),
    getSignedPreviewUrl: jest.fn().mockResolvedValue({
      expiresAt: new Date('2026-07-27T00:05:00.000Z'),
      headers: {},
      method: 'GET',
      url: '/media/media-1/file',
    }),
    name: 'local',
    objectExists: jest.fn().mockResolvedValue(true),
    readObject: jest.fn().mockResolvedValue(Buffer.from('demo')),
    uploadFile: jest
      .fn()
      .mockResolvedValue({ checksum: 'abc', contentLength: 4 }),
  };

  return {
    prisma,
    service: new MediaService(prisma as never, storage),
    storage,
    tx,
  };
}

describe('MediaService', () => {
  beforeEach(() => {
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-07-27T12:00:00.000Z').getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates an upload target scoped to the current business', async () => {
    const { prisma, service, storage, tx } = createHarness();

    const response = await service.createUploadTarget(owner, {
      appointmentId: 'appointment-1',
      category: 'BEFORE_PHOTO',
      fileSizeBytes: 4,
      mediaType: 'IMAGE',
      mimeType: 'image/png',
      originalFileName: 'demo.png',
    });

    expect(storage.createObjectKey).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'business-1' }),
    );
    expect(tx.mediaAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'business-1',
          objectKey: 'business-1/image/demo.png',
        }),
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(response.media).not.toHaveProperty('objectKey');
  });

  it('blocks read-only users from uploading media', async () => {
    const { service } = createHarness();

    await expect(
      service.createUploadTarget(readOnly, {
        customerId: 'customer-1',
        category: 'GENERAL_DOCUMENT',
        fileSizeBytes: 4,
        mediaType: 'PDF',
        mimeType: 'application/pdf',
        originalFileName: 'scope.pdf',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('prevents technicians from uploading against unassigned appointments', async () => {
    const { prisma, service } = createHarness();
    prisma.appointment.findFirst
      .mockResolvedValueOnce({
        assignedUserId: 'other-tech',
        id: 'appointment-1',
        job: { customerId: 'customer-1', id: 'job-1' },
        jobId: 'job-1',
      })
      .mockResolvedValueOnce(null);

    await expect(
      service.createUploadTarget(technician, {
        appointmentId: 'appointment-1',
        category: 'BEFORE_PHOTO',
        fileSizeBytes: 4,
        mediaType: 'IMAGE',
        mimeType: 'image/png',
        originalFileName: 'demo.png',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects unsupported or suspicious filenames', async () => {
    const { service } = createHarness();

    await expect(
      service.createUploadTarget(owner, {
        customerId: 'customer-1',
        category: 'GENERAL_DOCUMENT',
        fileSizeBytes: 4,
        mediaType: 'PDF',
        mimeType: 'application/pdf',
        originalFileName: '../private.pdf',
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('returns an authorised file endpoint without exposing object keys', async () => {
    const { prisma, service } = createHarness();
    prisma.mediaAsset.findFirst.mockResolvedValue(
      media({ uploadStatus: 'COMPLETED' }),
    );

    const response = await service.download(owner, 'media-1');

    expect(response.url).toBe('/media/media-1/file');
    expect(response.url).not.toContain('business-1/image');
  });

  it('lists media for a technician assigned appointment', async () => {
    const { service } = createHarness();

    const response = await service.findAll(technician, {
      appointmentId: 'appointment-1',
    });

    expect(response.records).toHaveLength(1);
    expect(response.records[0].appointmentId).toBe('appointment-1');
  });

  it('denies technicians listing media for unrelated appointments', async () => {
    const { prisma, service } = createHarness();
    prisma.appointment.findFirst.mockResolvedValue({
      assignedUserId: 'other-tech',
      id: 'appointment-1',
      jobId: 'job-1',
    });

    await expect(
      service.findAll(technician, { appointmentId: 'appointment-1' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('returns a structured stale appointment error for missing appointment media context', async () => {
    const { prisma, service } = createHarness();
    prisma.appointment.findFirst.mockResolvedValue(null);

    await expect(
      service.findAll(owner, { appointmentId: 'old-appointment-id' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'APPOINTMENT_NOT_FOUND',
      }),
      status: 404,
    });
  });

  it('uploads multipart binary files without Base64 JSON encoding', async () => {
    const { service, storage } = createHarness();
    const file = {
      buffer: Buffer.from('demo'),
      mimetype: 'image/png',
      originalname: 'demo.png',
      size: 4,
    };

    const response = await service.localMultipartUpload(
      technician,
      'media-1',
      file,
    );

    expect(storage.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        content: Buffer.from('demo'),
        mimeType: 'image/png',
      }),
    );
    expect(response.media.uploadStatus).toBe('COMPLETED');
  });

  it('rejects multipart uploads above the expected target size with FILE_TOO_LARGE', async () => {
    const { prisma, service } = createHarness();
    prisma.mediaAsset.findFirst.mockResolvedValue(
      media({
        fileSizeBytes: IMAGE_LIMIT,
        mediaType: 'IMAGE',
        mimeType: 'image/jpeg',
        originalFileName: 'large.jpg',
      }),
    );

    await expect(
      service.localMultipartUpload(technician, 'media-1', {
        buffer: Buffer.alloc(IMAGE_LIMIT + 1),
        mimetype: 'image/jpeg',
        originalname: 'large.jpg',
        size: IMAGE_LIMIT + 1,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'FILE_TOO_LARGE',
      }),
      status: 413,
    });
  });

  it('allows owners to archive any business media and keeps the storage object', async () => {
    const { prisma, service, storage, tx } = createHarness();
    prisma.mediaAsset.findFirst.mockResolvedValue(
      media({
        category: 'COMPLIANCE_CERTIFICATE',
        createdAt: new Date('2026-07-20T00:00:00.000Z'),
        mediaType: 'PDF',
        mimeType: 'application/pdf',
      }),
    );

    const response = await service.archive(owner, 'media-1');

    expect(response.media.archivedAt).toBeTruthy();
    expect(tx.mediaAsset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { archivedAt: expect.any(Date) },
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'MEDIA_ARCHIVED' }),
      }),
    );
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('allows technicians to archive their own recent assigned ordinary photo', async () => {
    const { service } = createHarness();

    await expect(service.archive(technician, 'media-1')).resolves.toMatchObject(
      {
        media: expect.objectContaining({ id: 'media-1' }),
      },
    );
  });

  it('blocks technicians from archiving another user photo', async () => {
    const { service } = createHarness();

    await expect(
      service.archive(otherTechnician, 'media-1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MEDIA_ACCESS_DENIED' }),
      status: 403,
    });
  });

  it('blocks technicians from archiving protected documents', async () => {
    const { prisma, service } = createHarness();
    prisma.mediaAsset.findFirst.mockResolvedValue(
      media({
        category: 'COMPLIANCE_CERTIFICATE',
        mediaType: 'PDF',
        mimeType: 'application/pdf',
      }),
    );

    await expect(service.archive(technician, 'media-1')).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'PROTECTED_MEDIA_REQUIRES_ADMIN',
      }),
      status: 403,
    });
  });

  it('blocks technicians outside the 24 hour correction window', async () => {
    const { prisma, service } = createHarness();
    prisma.mediaAsset.findFirst.mockResolvedValue(
      media({ createdAt: new Date('2026-07-25T00:00:00.000Z') }),
    );

    await expect(service.archive(technician, 'media-1')).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'MEDIA_ARCHIVE_WINDOW_EXPIRED',
      }),
      status: 403,
    });
  });

  it('blocks read-only and cross-business archive attempts', async () => {
    const { prisma, service } = createHarness();

    await expect(service.archive(readOnly, 'media-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MEDIA_ACCESS_DENIED' }),
      status: 403,
    });

    prisma.mediaAsset.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.archive({ ...owner, businessId: 'business-2' }, 'media-1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MEDIA_NOT_FOUND' }),
      status: 404,
    });
  });

  it('excludes archived media by default and supports archived filter for managers', async () => {
    const { prisma, service } = createHarness();

    await service.findAll(owner, { appointmentId: 'appointment-1' });
    expect(prisma.mediaAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ archivedAt: null }),
      }),
    );

    await service.findAll(owner, {
      appointmentId: 'appointment-1',
      archived: 'true',
    });
    expect(prisma.mediaAsset.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ archivedAt: { not: null } }),
      }),
    );
  });

  it('restores archived media with audit and timeline events', async () => {
    const { prisma, service, tx } = createHarness();
    prisma.mediaAsset.findFirst.mockResolvedValue(
      media({ archivedAt: new Date('2026-07-27T01:00:00.000Z') }),
    );

    const response = await service.restore(owner, 'media-1');

    expect(response.media.archivedAt).toBeNull();
    expect(tx.mediaAsset.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { archivedAt: null } }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'MEDIA_RESTORED' }),
      }),
    );
  });
});
