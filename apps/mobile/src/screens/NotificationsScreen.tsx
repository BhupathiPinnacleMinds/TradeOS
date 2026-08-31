import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { InAppNotification } from '@tradieos/shared';
import { formatBusinessDateTime } from '@tradieos/shared';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  markAllNotificationsReadRequest,
  markNotificationReadRequest,
  notificationsRequest,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type NotificationFilter = 'ALL' | 'UNREAD';

const PAGE_SIZE = 30;

function typeLabel(type: string) {
  return type.replaceAll('_', ' ').toLowerCase();
}

function categoryColour(type: string) {
  if (type.startsWith('APPOINTMENT')) {
    return { background: '#E0F2FE', text: '#0369A1' };
  }
  if (type.startsWith('INVOICE') || type.startsWith('PAYMENT')) {
    return { background: '#DCFCE7', text: '#166534' };
  }
  if (type.startsWith('QUOTE')) {
    return { background: '#FEF3C7', text: '#92400E' };
  }
  if (type.startsWith('COMMUNICATION')) {
    return { background: '#FFE4E6', text: '#BE123C' };
  }
  if (type.startsWith('TORI')) {
    return { background: '#EDE9FE', text: '#6D28D9' };
  }
  return { background: '#F1F5F9', text: '#475569' };
}

function relativeTimestamp(value: string, timezone?: string) {
  const createdAt = new Date(value);
  const diffMs = Date.now() - createdAt.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return formatBusinessDateTime(value, timezone);
}

export function NotificationsScreen() {
  const navigation = useNavigation<Navigation>();
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const hasLoadedRef = useRef(false);
  const [filter, setFilter] = useState<NotificationFilter>('ALL');
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visibleNotifications = useMemo(
    () =>
      filter === 'UNREAD'
        ? notifications.filter(
            (notification) => notification.status === 'UNREAD',
          )
        : notifications,
    [filter, notifications],
  );

  const load = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!token) return;

      if (!options.silent) setIsLoading(true);
      setError(null);

      try {
        const response = await notificationsRequest(token, {
          page: 1,
          pageSize: PAGE_SIZE,
          status: filter,
        });
        setNotifications(response.records);
        setUnreadCount(response.unreadCount);
      } catch (loadError) {
        const message =
          loadError instanceof Error
            ? loadError.message
            : "We couldn't load notifications.";
        setError(message);
        if (options.silent) {
          showToast({ message, tone: 'error' });
        }
      } finally {
        setIsLoading(false);
      }
    },
    [filter, showToast, token],
  );

  useFocusEffect(
    useCallback(() => {
      if (!token) return undefined;

      const silent = hasLoadedRef.current;
      hasLoadedRef.current = true;
      void load({ silent });

      return undefined;
    }, [load, token]),
  );

  async function refresh() {
    setIsRefreshing(true);
    try {
      await load({ silent: true });
    } finally {
      setIsRefreshing(false);
    }
  }

  async function markAllRead() {
    if (!token || !unreadCount || isMarkingAll) return;

    setIsMarkingAll(true);
    try {
      const response = await markAllNotificationsReadRequest(token);
      setNotifications((current) =>
        current.map((notification) =>
          notification.status === 'UNREAD'
            ? {
                ...notification,
                readAt: new Date().toISOString(),
                status: 'READ',
              }
            : notification,
        ),
      );
      setUnreadCount(response.unreadCount);
      showToast({ message: 'Notifications marked as read.', tone: 'success' });
    } catch (markError) {
      showToast({
        message:
          markError instanceof Error
            ? markError.message
            : "We couldn't mark notifications as read.",
        tone: 'error',
      });
    } finally {
      setIsMarkingAll(false);
    }
  }

  async function openNotification(notification: InAppNotification) {
    if (!token || activeId) return;

    setActiveId(notification.id);
    try {
      if (notification.status === 'UNREAD') {
        const response = await markNotificationReadRequest(
          token,
          notification.id,
        );
        setUnreadCount(response.unreadCount);
        setNotifications((current) =>
          current.map((item) =>
            item.id === notification.id ? response.notification : item,
          ),
        );
      }
      navigateForNotification(notification);
    } catch (markError) {
      showToast({
        message:
          markError instanceof Error
            ? markError.message
            : "We couldn't open that notification.",
        tone: 'error',
      });
    } finally {
      setActiveId(null);
    }
  }

  function navigateForNotification(notification: InAppNotification) {
    if (notification.entityType === 'appointment' && notification.entityId) {
      navigation.navigate('AppointmentDetails', {
        appointmentId: notification.entityId,
      });
      return;
    }

    if (notification.entityType === 'invoice' && notification.entityId) {
      navigation.navigate('InvoiceDetails', {
        invoiceId: notification.entityId,
      });
      return;
    }

    if (notification.entityType === 'quote' && notification.entityId) {
      navigation.navigate('QuoteDetails', { quoteId: notification.entityId });
      return;
    }

    if (notification.entityType === 'team') {
      navigation.navigate('Team');
      return;
    }

    showToast({
      message: 'This update has been marked as read.',
      tone: 'info',
    });
  }

  const emptyTitle =
    filter === 'UNREAD' ? "You're all caught up." : 'No notifications yet.';
  const emptyBody =
    filter === 'UNREAD'
      ? 'No unread notifications.'
      : 'Updates that need your attention will appear here.';

  return (
    <View style={styles.page}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            colors={[colours.primary]}
            onRefresh={() => void refresh()}
            refreshing={isRefreshing}
            tintColor={colours.primary}
          />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>NOTIFICATIONS</Text>
            <Text style={styles.title}>Notifications</Text>
            <Text style={styles.subtitle}>
              Team updates, appointment changes and items that need attention.
            </Text>
          </View>
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadValue}>{unreadCount}</Text>
            <Text style={styles.unreadLabel}>Unread</Text>
          </View>
        </View>

        <View style={styles.toolbar}>
          <View style={styles.filterRow}>
            <FilterChip
              active={filter === 'ALL'}
              label="All"
              onPress={() => setFilter('ALL')}
            />
            <FilterChip
              active={filter === 'UNREAD'}
              label="Unread"
              onPress={() => setFilter('UNREAD')}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={!unreadCount || isMarkingAll}
            onPress={() => void markAllRead()}
            style={[
              styles.markAllButton,
              (!unreadCount || isMarkingAll) && styles.disabledButton,
            ]}
          >
            {isMarkingAll ? (
              <ActivityIndicator color={colours.primary} size="small" />
            ) : (
              <Text style={styles.markAllText}>Mark all read</Text>
            )}
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colours.primary} />
            <Text style={styles.stateText}>Loading notifications...</Text>
          </View>
        ) : null}

        {!isLoading && error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Notifications unavailable</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void load()}
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {!isLoading && !error && !visibleNotifications.length ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{emptyTitle}</Text>
            <Text style={styles.emptyText}>{emptyBody}</Text>
          </View>
        ) : null}

        {!isLoading && !error
          ? visibleNotifications.map((notification) => (
              <NotificationCard
                active={activeId === notification.id}
                key={notification.id}
                notification={notification}
                onPress={() => void openNotification(notification)}
                timezone={user?.business.timezone}
              />
            ))
          : null}
      </ScrollView>
    </View>
  );
}

function FilterChip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.filterChip, active && styles.filterChipActive]}
    >
      <Text style={[styles.filterText, active && styles.filterTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function NotificationCard({
  active,
  notification,
  onPress,
  timezone,
}: {
  active: boolean;
  notification: InAppNotification;
  onPress(): void;
  timezone?: string;
}) {
  const unread = notification.status === 'UNREAD';
  const category = categoryColour(notification.type);

  return (
    <Pressable
      accessibilityLabel={`${notification.title}. ${notification.body}`}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.card, unread && styles.unreadCard]}
    >
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.categoryBadge,
            { backgroundColor: category.background },
          ]}
        >
          <Text style={[styles.categoryText, { color: category.text }]}>
            {typeLabel(notification.type)}
          </Text>
        </View>
        {unread ? (
          <View accessibilityLabel="Unread" style={styles.dot} />
        ) : null}
      </View>
      <Text style={styles.cardTitle}>{notification.title}</Text>
      <Text style={styles.cardBody}>{notification.body}</Text>
      <View style={styles.cardFooter}>
        <Text style={styles.timestamp}>
          {relativeTimestamp(notification.createdAt, timezone)}
        </Text>
        {active ? (
          <ActivityIndicator color={colours.primary} size="small" />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: colours.background, flex: 1 },
  container: { padding: 24, paddingBottom: 40 },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
  },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  title: { color: colours.ink, fontSize: 34, fontWeight: '900', marginTop: 4 },
  subtitle: {
    color: colours.muted,
    lineHeight: 22,
    marginTop: 8,
    maxWidth: 280,
  },
  unreadBadge: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    minWidth: 76,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  unreadValue: { color: colours.primary, fontSize: 24, fontWeight: '900' },
  unreadLabel: { color: colours.muted, fontSize: 12, fontWeight: '800' },
  toolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginTop: 22,
  },
  filterRow: {
    backgroundColor: '#E2E8F0',
    borderRadius: 999,
    flexDirection: 'row',
    padding: 4,
  },
  filterChip: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  filterChipActive: { backgroundColor: colours.card },
  filterText: { color: colours.muted, fontSize: 13, fontWeight: '800' },
  filterTextActive: { color: colours.ink },
  markAllButton: {
    alignItems: 'center',
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 40,
    minWidth: 112,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  disabledButton: { opacity: 0.45 },
  markAllText: { color: colours.primary, fontSize: 13, fontWeight: '900' },
  stateCard: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 10,
    marginTop: 24,
    padding: 22,
  },
  stateText: { color: colours.muted, fontWeight: '700' },
  emptyCard: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 22,
    borderWidth: 1,
    marginTop: 24,
    padding: 22,
  },
  emptyTitle: { color: colours.ink, fontSize: 20, fontWeight: '900' },
  emptyText: { color: colours.muted, lineHeight: 21, marginTop: 6 },
  errorCard: {
    backgroundColor: '#FFF1F2',
    borderColor: '#FECDD3',
    borderRadius: 22,
    borderWidth: 1,
    marginTop: 24,
    padding: 18,
  },
  errorTitle: { color: '#9F1239', fontSize: 18, fontWeight: '900' },
  errorText: { color: '#9F1239', lineHeight: 21, marginTop: 6 },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryText: { color: '#9F1239', fontWeight: '900' },
  card: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 14,
    padding: 16,
  },
  unreadCard: {
    borderColor: colours.primary,
    borderWidth: 2,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  categoryBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'capitalize',
  },
  dot: {
    backgroundColor: colours.primary,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  cardTitle: {
    color: colours.ink,
    fontSize: 17,
    fontWeight: '900',
    marginTop: 12,
  },
  cardBody: { color: colours.muted, lineHeight: 21, marginTop: 6 },
  cardFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  timestamp: { color: colours.muted, fontSize: 12, fontWeight: '800' },
});
