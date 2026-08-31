import { HttpException } from '@nestjs/common';
import type { AuthenticatedUser } from '@tradieos/shared';
import { NotificationsService } from './notifications.service';

const user: AuthenticatedUser = {
  businessId: 'business-1',
  email: 'owner@example.com',
  id: 'user-1',
  role: 'OWNER',
};

const notificationRecord = {
  body: 'Your appointment has changed.',
  businessId: 'business-1',
  createdAt: new Date('2026-08-31T00:00:00.000Z'),
  entityId: 'appointment-1',
  entityType: 'appointment',
  id: 'notification-1',
  metadata: { appointmentNumber: 'APT-2026-000001' },
  readAt: null,
  status: 'UNREAD',
  title: 'Appointment updated',
  type: 'APPOINTMENT_RESCHEDULED',
  userId: 'user-1',
};

function createService() {
  const prisma = {
    businessMember: { findMany: jest.fn() },
    notification: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn((items: Array<Promise<unknown>>) =>
      Promise.all(items),
    ),
  };

  return {
    prisma,
    service: new NotificationsService(prisma as never),
  };
}

describe('NotificationsService', () => {
  it('lists current-user notifications scoped by business and recipient', async () => {
    const { prisma, service } = createService();
    prisma.notification.findMany.mockResolvedValue([notificationRecord]);
    prisma.notification.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

    const result = await service.findAll(user, { page: 1, pageSize: 10 });

    expect(result.records).toHaveLength(1);
    expect(result.unreadCount).toBe(1);
    const [findManyInput] = prisma.notification.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(findManyInput.where).toMatchObject({
      businessId: user.businessId,
      status: { not: 'ARCHIVED' },
      userId: user.id,
    });
  });

  it('supports an unread-only filter without exposing read notifications', async () => {
    const { prisma, service } = createService();
    prisma.notification.findMany.mockResolvedValue([notificationRecord]);
    prisma.notification.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

    await service.findAll(user, { status: 'UNREAD' });

    const [findManyInput] = prisma.notification.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(findManyInput.where).toMatchObject({
      businessId: user.businessId,
      status: 'UNREAD',
      userId: user.id,
    });
  });

  it('marks only a scoped recipient notification as read', async () => {
    const { prisma, service } = createService();
    prisma.notification.findFirst.mockResolvedValue(notificationRecord);
    prisma.notification.update.mockResolvedValue({
      ...notificationRecord,
      readAt: new Date('2026-08-31T01:00:00.000Z'),
      status: 'READ',
    });
    prisma.notification.count.mockResolvedValue(0);

    const result = await service.markRead(user, 'notification-1');

    expect(result.notification.status).toBe('READ');
    expect(prisma.notification.findFirst).toHaveBeenCalledWith({
      where: {
        businessId: user.businessId,
        id: 'notification-1',
        status: { not: 'ARCHIVED' },
        userId: user.id,
      },
    });
  });

  it('rejects read attempts for another tenant or recipient notification', async () => {
    const { prisma, service } = createService();
    prisma.notification.findFirst.mockResolvedValue(null);

    await expect(
      service.markRead(user, 'notification-2'),
    ).rejects.toBeInstanceOf(HttpException);
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('marks all current-user unread notifications as read', async () => {
    const { prisma, service } = createService();
    prisma.notification.updateMany.mockResolvedValue({ count: 3 });

    const result = await service.markAllRead(user);

    expect(result).toEqual({ unreadCount: 0, updatedCount: 3 });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          businessId: user.businessId,
          status: 'UNREAD',
          userId: user.id,
        },
      }),
    );
  });

  it('creates role-targeted notifications for active members only', async () => {
    const { prisma, service } = createService();
    prisma.businessMember.findMany.mockResolvedValue([
      { userId: 'user-1' },
      { userId: 'user-2' },
      { userId: 'user-2' },
    ]);
    prisma.notification.create.mockResolvedValue(notificationRecord);

    const result = await service.createForRoles({
      actorUserId: 'actor-1',
      body: 'A payment was recorded.',
      businessId: 'business-1',
      roles: ['OWNER', 'ADMIN'],
      title: 'Payment recorded',
      type: 'PAYMENT_RECORDED',
    });

    expect(result.count).toBe(2);
    const [findManyInput] = prisma.businessMember.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(findManyInput.where).toMatchObject({
      businessId: 'business-1',
      role: { in: ['OWNER', 'ADMIN'] },
      status: 'ACTIVE',
      userId: { not: 'actor-1' },
    });
    expect(prisma.notification.create).toHaveBeenCalledTimes(2);
  });
});
