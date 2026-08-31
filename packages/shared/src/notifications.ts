export const NOTIFICATION_STATUSES = ['UNREAD', 'READ', 'ARCHIVED'] as const;

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export type NotificationEntityType =
  | 'appointment'
  | 'quote'
  | 'invoice'
  | 'payment'
  | 'team'
  | 'communication'
  | 'tori'
  | 'job'
  | 'customer';

export type NotificationType =
  | 'APPOINTMENT_ASSIGNED'
  | 'APPOINTMENT_REASSIGNED'
  | 'APPOINTMENT_RESCHEDULED'
  | 'APPOINTMENT_CANCELLED'
  | 'COMMUNICATION_FAILED'
  | 'TEAM_UPDATED'
  | 'QUOTE_ACTION'
  | 'INVOICE_ACTION'
  | 'PAYMENT_RECORDED'
  | 'TORI_ACTION_REQUIRED'
  | 'GENERAL';

export interface InAppNotification {
  id: string;
  businessId: string;
  userId: string;
  type: NotificationType | string;
  title: string;
  body: string;
  status: NotificationStatus;
  readAt: string | null;
  entityType: NotificationEntityType | string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface NotificationsListResponse {
  records: InAppNotification[];
  total: number;
  unreadCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface NotificationUnreadCountResponse {
  unreadCount: number;
}

export interface MarkNotificationReadResponse {
  notification: InAppNotification;
  unreadCount: number;
}

export interface MarkAllNotificationsReadResponse {
  updatedCount: number;
  unreadCount: number;
}
