import { Inject, Injectable, HttpException, HttpStatus } from '@nestjs/common';
import type {
  AuthenticatedUser,
  MediaAsset,
  MediaListResponse,
  MediaType,
} from '@tradieos/shared';
import {
  DOCUMENT_MEDIA_CATEGORIES,
  FINANCIAL_MEDIA_CATEGORIES,
  MEDIA_MANAGE_ROLES,
  MEDIA_UPLOAD_ROLES,
  MEDIA_VIEW_ROLES,
  PHOTO_MEDIA_CATEGORIES,
} from '@tradieos/shared';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CompleteUploadDto,
  CreateUploadTargetDto,
  ListMediaQueryDto,
  LocalUploadDto,
  UpdateMediaDto,
} from './dto/media.dto';
import { STORAGE_PROVIDER } from './storage-provider';
import type { StorageProvider } from './storage-provider';

const DEFAULT_PAGE_SIZE = 20;
const IMAGE_LIMIT = 15 * 1024 * 1024;
const DOCUMENT_LIMIT = 25 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = new Map<string, MediaType>([
  ['image/jpeg', 'IMAGE'],
  ['image/png', 'IMAGE'],
  ['image/heic', 'IMAGE'],
  ['image/heif', 'IMAGE'],
  ['image/webp', 'IMAGE'],
  ['application/pdf', 'PDF'],
  ['application/msword', 'DOCUMENT'],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'DOCUMENT',
  ],
  ['application/vnd.ms-excel', 'DOCUMENT'],
  [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'DOCUMENT',
  ],
  ['text/plain', 'DOCUMENT'],
]);

type MediaAssetWithRelations = Prisma.MediaAssetGetPayload<{
  include: ReturnType<MediaService['mediaInclude']>;
}>;

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async createUploadTarget(
    currentUser: AuthenticatedUser,
    dto: CreateUploadTargetDto,
  ) {
    this.assertCanUpload(currentUser, dto);
    this.validateFile(dto);
    const context = await this.resolveContext(currentUser, dto);
    await this.assertContextPermission(currentUser, context, 'upload');

    const objectKey = this.storage.createObjectKey({
      businessId: currentUser.businessId,
      mediaType: dto.mediaType,
      originalFileName: dto.originalFileName,
    });

    const media = await this.prisma.$transaction(async (tx) => {
      const created = await tx.mediaAsset.create({
        data: {
          appointmentId: context.appointmentId,
          businessId: currentUser.businessId,
          caption: this.clean(dto.caption),
          category: dto.category,
          checksum: this.clean(dto.checksum),
          customerId: context.customerId,
          fileSizeBytes: dto.fileSizeBytes,
          height: dto.height ?? null,
          isCustomerVisible: this.canSetCustomerVisible(currentUser)
            ? Boolean(dto.isCustomerVisible)
            : false,
          jobId: context.jobId,
          mediaType: dto.mediaType,
          mimeType: dto.mimeType.toLowerCase(),
          notes: this.clean(dto.notes),
          objectKey,
          originalFileName: this.safeFileName(dto.originalFileName),
          processingStatus:
            dto.mediaType === 'IMAGE' ? 'PENDING' : 'NOT_REQUIRED',
          storageProvider: this.storage.name,
          uploadStatus: 'PENDING',
          uploadedByUserId: currentUser.id,
          width: dto.width ?? null,
        },
        include: this.mediaInclude(),
      });
      await tx.auditLog.create({
        data: {
          action: 'MEDIA_UPLOAD_STARTED',
          actorUserId: currentUser.id,
          businessId: currentUser.businessId,
          entityId: created.id,
          entityType: 'MediaAsset',
          metadata: this.auditMetadata(created),
        },
      });
      await this.writeTimelineEvents(
        tx,
        currentUser,
        created,
        'MEDIA_UPLOAD_STARTED',
      );
      return created;
    });

    const upload = await this.storage.createUploadTarget({
      fileSizeBytes: dto.fileSizeBytes,
      mediaId: media.id,
      mimeType: dto.mimeType,
      objectKey,
    });

    return { media: this.toMedia(media), upload };
  }

  async localUpload(
    currentUser: AuthenticatedUser,
    id: string,
    dto: LocalUploadDto,
  ) {
    const media = await this.getMedia(currentUser, id);
    this.assertOwnPendingUpload(currentUser, media);
    const content = Buffer.from(dto.contentBase64, 'base64');
    if (content.length !== media.fileSizeBytes) {
      throw this.domainError(
        'FILE_SIZE_MISMATCH',
        'Uploaded file size does not match the requested upload target.',
      );
    }
    await this.storage.uploadFile({
      content,
      mimeType: media.mimeType,
      objectKey: media.objectKey,
    });
    return this.complete(currentUser, id, { checksum: dto.checksum });
  }

  async complete(
    currentUser: AuthenticatedUser,
    id: string,
    dto: CompleteUploadDto,
  ) {
    const media = await this.getMedia(currentUser, id);
    this.assertOwnPendingUpload(currentUser, media);
    const metadata = await this.storage
      .completeUpload({ objectKey: media.objectKey })
      .catch(() => null);
    if (!metadata) {
      await this.markFailed(currentUser, media, 'Object does not exist.');
      throw this.domainError(
        'UPLOAD_NOT_COMPLETED',
        'Upload has not reached storage yet.',
        HttpStatus.CONFLICT,
      );
    }
    if (
      dto.fileSizeBytes &&
      metadata.contentLength &&
      dto.fileSizeBytes !== metadata.contentLength
    ) {
      throw this.domainError(
        'FILE_TOO_LARGE',
        'Uploaded object metadata does not match expected size.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const completed = await tx.mediaAsset.update({
        where: { id: media.id },
        data: {
          checksum: dto.checksum ?? metadata.checksum ?? media.checksum,
          durationSeconds: dto.durationSeconds ?? media.durationSeconds,
          fileSizeBytes: metadata.contentLength || media.fileSizeBytes,
          height: dto.height ?? media.height,
          processingStatus:
            media.mediaType === 'IMAGE' ? 'COMPLETED' : 'NOT_REQUIRED',
          uploadStatus: 'COMPLETED',
          width: dto.width ?? media.width,
        },
        include: this.mediaInclude(),
      });
      await tx.auditLog.create({
        data: {
          action: 'MEDIA_UPLOADED',
          actorUserId: currentUser.id,
          businessId: currentUser.businessId,
          entityId: completed.id,
          entityType: 'MediaAsset',
          metadata: this.auditMetadata(completed),
        },
      });
      await this.writeTimelineEvents(
        tx,
        currentUser,
        completed,
        'MEDIA_UPLOADED',
      );
      return completed;
    });

    return { media: this.toMedia(updated) };
  }

  async cancel(currentUser: AuthenticatedUser, id: string) {
    const media = await this.getMedia(currentUser, id);
    this.assertOwnPendingUpload(currentUser, media);
    const updated = await this.prisma.mediaAsset.update({
      where: { id: media.id },
      data: { uploadStatus: 'CANCELLED' },
      include: this.mediaInclude(),
    });
    await this.log(currentUser, updated, 'MEDIA_UPLOAD_FAILED', {
      reason: 'cancelled',
    });
    return { media: this.toMedia(updated) };
  }

  async findAll(
    currentUser: AuthenticatedUser,
    query: ListMediaQueryDto,
  ): Promise<MediaListResponse> {
    this.assertRole(currentUser, MEDIA_VIEW_ROLES);
    await this.assertListContext(currentUser, query);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(
      100,
      Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const where = this.buildWhere(currentUser, query);
    const [records, total] = await this.prisma.$transaction([
      this.prisma.mediaAsset.findMany({
        where,
        include: this.mediaInclude(),
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.mediaAsset.count({ where }),
    ]);

    return {
      records: records.map((media) => this.toMedia(media)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async findOne(currentUser: AuthenticatedUser, id: string) {
    const media = await this.getMedia(currentUser, id);
    await this.assertMediaAccess(currentUser, media, 'view');
    return { media: this.toMedia(media) };
  }

  async download(currentUser: AuthenticatedUser, id: string) {
    const media = await this.getMedia(currentUser, id);
    await this.assertMediaAccess(currentUser, media, 'view');
    if (media.uploadStatus !== 'COMPLETED') {
      throw this.domainError(
        'UPLOAD_NOT_COMPLETED',
        'This file is not available yet.',
        HttpStatus.CONFLICT,
      );
    }
    const signed = await this.storage.getSignedDownloadUrl({
      fileName: media.originalFileName,
      mediaId: media.id,
      objectKey: media.objectKey,
    });
    return { expiresAt: signed.expiresAt.toISOString(), url: signed.url };
  }

  async preview(currentUser: AuthenticatedUser, id: string) {
    const media = await this.getMedia(currentUser, id);
    await this.assertMediaAccess(currentUser, media, 'view');
    if (media.uploadStatus !== 'COMPLETED') {
      throw this.domainError(
        'UPLOAD_NOT_COMPLETED',
        'This file is not available yet.',
        HttpStatus.CONFLICT,
      );
    }
    const signed = await this.storage.getSignedPreviewUrl({
      mediaId: media.id,
      objectKey: media.objectKey,
    });
    return { expiresAt: signed.expiresAt.toISOString(), url: signed.url };
  }

  async file(currentUser: AuthenticatedUser, id: string) {
    const media = await this.getMedia(currentUser, id);
    await this.assertMediaAccess(currentUser, media, 'view');
    if (media.uploadStatus !== 'COMPLETED') {
      throw this.domainError(
        'UPLOAD_NOT_COMPLETED',
        'This file is not available yet.',
        HttpStatus.CONFLICT,
      );
    }
    return {
      content: await this.storage.readObject({ objectKey: media.objectKey }),
      fileName: media.originalFileName,
      mimeType: media.mimeType,
    };
  }

  async update(
    currentUser: AuthenticatedUser,
    id: string,
    dto: UpdateMediaDto,
  ) {
    const media = await this.getMedia(currentUser, id);
    await this.assertMediaAccess(currentUser, media, 'edit');
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.mediaAsset.update({
        where: { id: media.id },
        data: {
          category: dto.category ?? media.category,
          caption:
            dto.caption === undefined ? media.caption : this.clean(dto.caption),
          isCustomerVisible:
            dto.isCustomerVisible === undefined ||
            !this.canSetCustomerVisible(currentUser)
              ? media.isCustomerVisible
              : dto.isCustomerVisible,
          notes: dto.notes === undefined ? media.notes : this.clean(dto.notes),
        },
        include: this.mediaInclude(),
      });
      await tx.auditLog.create({
        data: {
          action: 'MEDIA_METADATA_UPDATED',
          actorUserId: currentUser.id,
          businessId: currentUser.businessId,
          entityId: media.id,
          entityType: 'MediaAsset',
          metadata: this.auditMetadata(next),
        },
      });
      await this.writeTimelineEvents(
        tx,
        currentUser,
        next,
        'MEDIA_METADATA_UPDATED',
      );
      return next;
    });
    return { media: this.toMedia(updated) };
  }

  async archive(currentUser: AuthenticatedUser, id: string) {
    const media = await this.getMedia(currentUser, id);
    await this.assertMediaAccess(currentUser, media, 'archive');
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.mediaAsset.update({
        where: { id: media.id },
        data: { archivedAt: new Date() },
        include: this.mediaInclude(),
      });
      await tx.auditLog.create({
        data: {
          action: 'MEDIA_ARCHIVED',
          actorUserId: currentUser.id,
          businessId: currentUser.businessId,
          entityId: media.id,
          entityType: 'MediaAsset',
          metadata: this.auditMetadata(next),
        },
      });
      await this.writeTimelineEvents(tx, currentUser, next, 'MEDIA_ARCHIVED');
      return next;
    });
    return { media: this.toMedia(updated) };
  }

  async restore(currentUser: AuthenticatedUser, id: string) {
    const media = await this.getMedia(currentUser, id);
    this.assertRole(currentUser, MEDIA_MANAGE_ROLES);
    const updated = await this.prisma.mediaAsset.update({
      where: { id: media.id },
      data: { archivedAt: null },
      include: this.mediaInclude(),
    });
    await this.log(currentUser, updated, 'MEDIA_RESTORED');
    return { media: this.toMedia(updated) };
  }

  private buildWhere(
    currentUser: AuthenticatedUser,
    query: ListMediaQueryDto,
  ): Prisma.MediaAssetWhereInput {
    const where: Prisma.MediaAssetWhereInput = {
      businessId: currentUser.businessId,
      archivedAt: query.archived === 'true' ? { not: null } : null,
    };
    if (query.customerId) where.customerId = query.customerId;
    if (query.jobId) where.jobId = query.jobId;
    if (query.appointmentId) where.appointmentId = query.appointmentId;
    if (query.category) where.category = query.category;
    if (query.mediaType) where.mediaType = query.mediaType;
    if (query.uploadedBy) where.uploadedByUserId = query.uploadedBy;
    if (query.uploadStatus) where.uploadStatus = query.uploadStatus;
    if (query.processingStatus) where.processingStatus = query.processingStatus;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { originalFileName: { contains: search, mode: 'insensitive' } },
        { caption: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (currentUser.role === 'TECHNICIAN') {
      where.OR = [
        ...(where.OR ? [{ AND: where.OR }] : []),
        { uploadedByUserId: currentUser.id },
        { appointment: { assignedUserId: currentUser.id } },
        { job: { assignedToUserId: currentUser.id } },
      ];
    }
    if (currentUser.role === 'ACCOUNTANT') {
      where.category = { in: FINANCIAL_MEDIA_CATEGORIES };
    }
    return where;
  }

  private async assertListContext(
    currentUser: AuthenticatedUser,
    query: ListMediaQueryDto,
  ) {
    if (query.appointmentId) {
      const appointment = await this.prisma.appointment.findFirst({
        where: {
          businessId: currentUser.businessId,
          id: query.appointmentId,
        },
        select: { assignedUserId: true, id: true, jobId: true },
      });
      if (!appointment) {
        throw this.domainError(
          'APPOINTMENT_NOT_FOUND',
          'This appointment is no longer available.',
          HttpStatus.NOT_FOUND,
        );
      }
      if (
        currentUser.role === 'TECHNICIAN' &&
        appointment.assignedUserId !== currentUser.id
      ) {
        throw this.domainError(
          'MEDIA_ACCESS_DENIED',
          'You can only view media for your assigned appointments.',
          HttpStatus.FORBIDDEN,
        );
      }
    }

    if (query.jobId) {
      const job = await this.prisma.job.findFirst({
        where: { businessId: currentUser.businessId, id: query.jobId },
        select: { assignedToUserId: true, id: true },
      });
      if (!job) {
        throw this.domainError(
          'INVALID_MEDIA_CONTEXT',
          'Job not found.',
          HttpStatus.NOT_FOUND,
        );
      }
      if (
        currentUser.role === 'TECHNICIAN' &&
        job.assignedToUserId !== currentUser.id
      ) {
        throw this.domainError(
          'MEDIA_ACCESS_DENIED',
          'You can only view media for your assigned jobs.',
          HttpStatus.FORBIDDEN,
        );
      }
    }

    if (query.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { businessId: currentUser.businessId, id: query.customerId },
        select: { id: true },
      });
      if (!customer) {
        throw this.domainError(
          'INVALID_MEDIA_CONTEXT',
          'Customer not found.',
          HttpStatus.NOT_FOUND,
        );
      }
    }
  }

  private validateFile(dto: CreateUploadTargetDto) {
    if (
      dto.originalFileName.includes('/') ||
      dto.originalFileName.includes('\\')
    ) {
      throw this.domainError(
        'UNSUPPORTED_FILE_TYPE',
        'Filename cannot contain path separators.',
      );
    }
    const mimeType = dto.mimeType.toLowerCase();
    const expectedType = SUPPORTED_MIME_TYPES.get(mimeType);
    if (!expectedType || expectedType !== dto.mediaType) {
      throw this.domainError(
        'UNSUPPORTED_FILE_TYPE',
        'This file type is not supported yet.',
      );
    }
    const limit = dto.mediaType === 'IMAGE' ? IMAGE_LIMIT : DOCUMENT_LIMIT;
    if (dto.fileSizeBytes > limit) {
      throw this.domainError(
        'FILE_TOO_LARGE',
        `Files of this type must be ${Math.floor(limit / 1024 / 1024)} MB or smaller.`,
      );
    }
    if (['VIDEO', 'AUDIO'].includes(dto.mediaType)) {
      throw this.domainError(
        'UNSUPPORTED_FILE_TYPE',
        'Video and audio storage is architecture-only in this milestone.',
      );
    }
  }

  private async resolveContext(
    currentUser: AuthenticatedUser,
    dto: CreateUploadTargetDto,
  ) {
    if (!dto.customerId && !dto.jobId && !dto.appointmentId) {
      throw this.domainError(
        'INVALID_MEDIA_CONTEXT',
        'Select a customer, job or appointment before uploading.',
      );
    }
    let customerId = dto.customerId ?? null;
    let jobId = dto.jobId ?? null;
    const appointmentId = dto.appointmentId ?? null;

    if (appointmentId) {
      const appointment = await this.prisma.appointment.findFirst({
        where: { businessId: currentUser.businessId, id: appointmentId },
        include: { job: { select: { customerId: true, id: true } } },
      });
      if (!appointment) {
        throw this.domainError(
          'INVALID_MEDIA_CONTEXT',
          'Appointment not found.',
        );
      }
      jobId = appointment.jobId;
      customerId = appointment.job.customerId;
    }
    if (jobId) {
      const job = await this.prisma.job.findFirst({
        where: { businessId: currentUser.businessId, id: jobId },
        select: { customerId: true, id: true },
      });
      if (!job) {
        throw this.domainError('INVALID_MEDIA_CONTEXT', 'Job not found.');
      }
      customerId = job.customerId;
    }
    if (customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { businessId: currentUser.businessId, id: customerId },
        select: { id: true },
      });
      if (!customer) {
        throw this.domainError('INVALID_MEDIA_CONTEXT', 'Customer not found.');
      }
    }

    return { appointmentId, customerId, jobId };
  }

  private async assertContextPermission(
    currentUser: AuthenticatedUser,
    context: { appointmentId: string | null; jobId: string | null },
    action: 'upload' | 'view',
  ) {
    if (currentUser.role !== 'TECHNICIAN') return;
    if (context.appointmentId) {
      const appointment = await this.prisma.appointment.findFirst({
        where: {
          assignedUserId: currentUser.id,
          businessId: currentUser.businessId,
          id: context.appointmentId,
        },
        select: { id: true },
      });
      if (!appointment) {
        throw this.domainError(
          'APPOINTMENT_NOT_ASSIGNED_TO_USER',
          action === 'upload'
            ? 'You can only add evidence to your assigned appointments.'
            : 'You can only view media for your assigned appointments.',
          HttpStatus.FORBIDDEN,
        );
      }
      return;
    }
    if (context.jobId) {
      const job = await this.prisma.job.findFirst({
        where: {
          assignedToUserId: currentUser.id,
          businessId: currentUser.businessId,
          id: context.jobId,
        },
        select: { id: true },
      });
      if (!job) {
        throw this.domainError(
          'MEDIA_ACCESS_DENIED',
          'You can only access media for assigned jobs.',
          HttpStatus.FORBIDDEN,
        );
      }
    }
  }

  private async assertMediaAccess(
    currentUser: AuthenticatedUser,
    media: MediaAssetWithRelations,
    action: 'view' | 'edit' | 'archive',
  ) {
    if (action === 'view') {
      this.assertRole(currentUser, MEDIA_VIEW_ROLES);
    }
    if (action === 'edit') {
      if (
        MEDIA_MANAGE_ROLES.includes(currentUser.role) ||
        (currentUser.role === 'TECHNICIAN' &&
          media.uploadedByUserId === currentUser.id &&
          media.createdAt.getTime() > Date.now() - 24 * 60 * 60 * 1000)
      ) {
        return;
      }
      throw this.domainError(
        'MEDIA_ACCESS_DENIED',
        'You cannot edit this file.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (action === 'archive') {
      if (
        MEDIA_MANAGE_ROLES.includes(currentUser.role) ||
        media.uploadedByUserId === currentUser.id
      ) {
        return;
      }
      throw this.domainError(
        'MEDIA_ACCESS_DENIED',
        'You cannot archive this file.',
        HttpStatus.FORBIDDEN,
      );
    }
    await this.assertContextPermission(currentUser, media, 'view');
  }

  private assertCanUpload(
    currentUser: AuthenticatedUser,
    dto: CreateUploadTargetDto,
  ) {
    this.assertRole(currentUser, MEDIA_UPLOAD_ROLES);
    if (
      currentUser.role === 'SCHEDULER' &&
      ['RECEIPT', 'MATERIAL_INVOICE'].includes(dto.category)
    ) {
      throw this.domainError(
        'MEDIA_ACCESS_DENIED',
        'Schedulers cannot upload financial documents.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private assertOwnPendingUpload(
    currentUser: AuthenticatedUser,
    media: MediaAssetWithRelations,
  ) {
    if (media.uploadedByUserId !== currentUser.id) {
      throw this.domainError(
        'MEDIA_ACCESS_DENIED',
        'Only the uploader can finish this upload.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (!['PENDING', 'UPLOADING', 'FAILED'].includes(media.uploadStatus)) {
      throw this.domainError(
        'INVALID_UPLOAD_STATE',
        'This upload cannot be completed from its current state.',
        HttpStatus.CONFLICT,
      );
    }
  }

  private assertRole(
    currentUser: AuthenticatedUser,
    allowedRoles: readonly string[],
  ) {
    if (!allowedRoles.includes(currentUser.role)) {
      throw this.domainError(
        'MEDIA_ACCESS_DENIED',
        'You do not have permission to manage files.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async getMedia(currentUser: AuthenticatedUser, id: string) {
    const media = await this.prisma.mediaAsset.findFirst({
      where: { businessId: currentUser.businessId, id },
      include: this.mediaInclude(),
    });
    if (!media) {
      throw this.domainError(
        'MEDIA_NOT_FOUND',
        'File not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return media;
  }

  private async markFailed(
    currentUser: AuthenticatedUser,
    media: MediaAssetWithRelations,
    reason: string,
  ) {
    const failed = await this.prisma.mediaAsset.update({
      where: { id: media.id },
      data: { uploadStatus: 'FAILED' },
      include: this.mediaInclude(),
    });
    await this.log(currentUser, failed, 'MEDIA_UPLOAD_FAILED', { reason });
  }

  private async log(
    currentUser: AuthenticatedUser,
    media: MediaAssetWithRelations,
    action: string,
    metadata: Record<string, unknown> = {},
  ) {
    await this.prisma.auditLog.create({
      data: {
        action,
        actorUserId: currentUser.id,
        businessId: currentUser.businessId,
        entityId: media.id,
        entityType: 'MediaAsset',
        metadata: { ...this.auditMetadata(media), ...metadata },
      },
    });
  }

  private async writeTimelineEvents(
    tx: Prisma.TransactionClient,
    currentUser: AuthenticatedUser,
    media: MediaAssetWithRelations,
    action: string,
  ) {
    const metadata = this.auditMetadata(media);
    if (media.jobId) {
      await tx.auditLog.create({
        data: {
          action,
          actorUserId: currentUser.id,
          businessId: currentUser.businessId,
          entityId: media.jobId,
          entityType: 'Job',
          metadata,
        },
      });
    }
    if (media.appointmentId) {
      await tx.auditLog.create({
        data: {
          action,
          actorUserId: currentUser.id,
          businessId: currentUser.businessId,
          entityId: media.appointmentId,
          entityType: 'Appointment',
          metadata,
        },
      });
    }
  }

  private mediaInclude() {
    return {
      uploadedBy: {
        select: { email: true, firstName: true, id: true, lastName: true },
      },
    } satisfies Prisma.MediaAssetInclude;
  }

  private toMedia(media: MediaAssetWithRelations): MediaAsset {
    return {
      archivedAt: media.archivedAt?.toISOString() ?? null,
      appointmentId: media.appointmentId,
      businessId: media.businessId,
      caption: media.caption,
      category: media.category,
      checksum: media.checksum,
      createdAt: media.createdAt.toISOString(),
      customerId: media.customerId,
      durationSeconds: media.durationSeconds,
      fileSizeBytes: media.fileSizeBytes,
      height: media.height,
      id: media.id,
      isCustomerVisible: media.isCustomerVisible,
      jobId: media.jobId,
      mediaType: media.mediaType,
      mimeType: media.mimeType,
      notes: media.notes,
      originalFileName: media.originalFileName,
      processingStatus: media.processingStatus,
      storageProvider: media.storageProvider,
      updatedAt: media.updatedAt.toISOString(),
      uploadedBy: media.uploadedBy,
      uploadedByUserId: media.uploadedByUserId,
      uploadStatus: media.uploadStatus,
      width: media.width,
    };
  }

  private auditMetadata(media: MediaAssetWithRelations) {
    return {
      appointmentId: media.appointmentId,
      category: media.category,
      customerId: media.customerId,
      fileSizeBytes: media.fileSizeBytes,
      jobId: media.jobId,
      mediaId: media.id,
      mediaType: media.mediaType,
      originalFileName: media.originalFileName,
      uploadStatus: media.uploadStatus,
      uploadedByUserId: media.uploadedByUserId,
    };
  }

  private safeFileName(fileName: string) {
    return fileName
      .replace(/[\\/\0]/g, '_')
      .trim()
      .slice(0, 255);
  }

  private canSetCustomerVisible(currentUser: AuthenticatedUser) {
    return ['OWNER', 'ADMIN', 'OFFICE_MANAGER'].includes(currentUser.role);
  }

  private clean(value?: string | null) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private domainError(
    code: string,
    message: string,
    status = HttpStatus.BAD_REQUEST,
    details: Record<string, unknown> = {},
  ) {
    return new HttpException({ code, message, details }, status);
  }

  readonly categoryGroups = {
    documents: DOCUMENT_MEDIA_CATEGORIES,
    photos: PHOTO_MEDIA_CATEGORIES,
  };
}
