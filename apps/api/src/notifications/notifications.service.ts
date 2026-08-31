import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type {
  AuthenticatedUser,
  BusinessRole,
  InAppNotification,
  MarkAllNotificationsReadResponse,
  MarkNotificationReadResponse,
  NotificationsListResponse,
  NotificationUnreadCountResponse,
} from '@tradieos/shared';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ListNotificationsQueryDto } from './dto/notifications.dto';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

type NotificationRecord = Prisma.NotificationGetPayload<object>;

export type CreateInAppNotificationInput = {
  businessId: string;
  userId: string | null | undefined;
  type: string;
  title: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
};

export type CreateRoleNotificationsInput = Omit<
  CreateInAppNotificationInput,
  'userId'
> & {
  actorUserId?: string | null;
  roles: BusinessRole[];
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    currentUser: AuthenticatedUser,
    query: ListNotificationsQueryDto = {},
  ): Promise<NotificationsListResponse> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const where: Prisma.NotificationWhereInput = {
      businessId: currentUser.businessId,
      status: query.status === 'UNREAD' ? 'UNREAD' : { not: 'ARCHIVED' },
      userId: currentUser.id,
    };

    const [records, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        where,
      }),
      this.prisma.notification.count({ where }),
      this.unreadCountQuery(currentUser),
    ]);

    return {
      page,
      pageSize,
      records: records.map((notification) => this.toNotification(notification)),
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      unreadCount,
    };
  }

  async unreadCount(
    currentUser: AuthenticatedUser,
  ): Promise<NotificationUnreadCountResponse> {
    return { unreadCount: await this.unreadCountQuery(currentUser) };
  }

  async markRead(
    currentUser: AuthenticatedUser,
    id: string,
  ): Promise<MarkNotificationReadResponse> {
    const existing = await this.prisma.notification.findFirst({
      where: {
        businessId: currentUser.businessId,
        id,
        status: { not: 'ARCHIVED' },
        userId: currentUser.id,
      },
    });

    if (!existing) {
      throw new HttpException(
        {
          code: 'NOTIFICATION_NOT_FOUND',
          message: 'Notification not found.',
        },
        HttpStatus.NOT_FOUND,
      );
    }

    const notification =
      existing.status === 'READ'
        ? existing
        : await this.prisma.notification.update({
            data: { readAt: new Date(), status: 'READ' },
            where: { id: existing.id },
          });

    return {
      notification: this.toNotification(notification),
      unreadCount: await this.unreadCountQuery(currentUser),
    };
  }

  async markAllRead(
    currentUser: AuthenticatedUser,
  ): Promise<MarkAllNotificationsReadResponse> {
    const result = await this.prisma.notification.updateMany({
      data: { readAt: new Date(), status: 'READ' },
      where: {
        businessId: currentUser.businessId,
        status: 'UNREAD',
        userId: currentUser.id,
      },
    });

    return { unreadCount: 0, updatedCount: result.count };
  }

  async create(input: CreateInAppNotificationInput) {
    if (!input.userId) return null;

    try {
      return await this.prisma.notification.create({
        data: {
          body: input.body,
          businessId: input.businessId,
          entityId: input.entityId ?? null,
          entityType: input.entityType ?? null,
          metadata: input.metadata ?? undefined,
          title: input.title,
          type: input.type,
          userId: input.userId,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Unable to create in-app notification ${input.type} for ${input.userId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  async createForRoles(input: CreateRoleNotificationsInput) {
    try {
      const members = await this.prisma.businessMember.findMany({
        select: { userId: true },
        where: {
          businessId: input.businessId,
          role: { in: input.roles },
          status: 'ACTIVE',
          userId: input.actorUserId
            ? { not: input.actorUserId }
            : { not: null },
        },
      });
      const userIds = [
        ...new Set(
          members
            .map((member) => member.userId)
            .filter((userId): userId is string => Boolean(userId)),
        ),
      ];

      await Promise.all(
        userIds.map((userId) =>
          this.create({
            body: input.body,
            businessId: input.businessId,
            entityId: input.entityId,
            entityType: input.entityType,
            metadata: input.metadata,
            title: input.title,
            type: input.type,
            userId,
          }),
        ),
      );

      return { count: userIds.length };
    } catch (error) {
      this.logger.warn(
        `Unable to create role notifications ${input.type} for ${input.businessId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return { count: 0 };
    }
  }

  private unreadCountQuery(currentUser: AuthenticatedUser) {
    return this.prisma.notification.count({
      where: {
        businessId: currentUser.businessId,
        status: 'UNREAD',
        userId: currentUser.id,
      },
    });
  }

  private toNotification(record: NotificationRecord): InAppNotification {
    return {
      body: record.body,
      businessId: record.businessId,
      createdAt: record.createdAt.toISOString(),
      entityId: record.entityId,
      entityType: record.entityType,
      id: record.id,
      metadata:
        record.metadata && typeof record.metadata === 'object'
          ? (record.metadata as Record<string, unknown>)
          : null,
      readAt: record.readAt?.toISOString() ?? null,
      status: record.status,
      title: record.title,
      type: record.type,
      userId: record.userId,
    };
  }
}
