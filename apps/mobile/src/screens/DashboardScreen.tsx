import type { DashboardSummaryResponse } from '@tradieos/shared';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiRequest } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { colours } from '../theme';

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('en-AU', {
    currency: 'AUD',
    maximumFractionDigits: 0,
    style: 'currency',
  }).format(cents / 100);
}

function formatAppointmentTime(value: string) {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
  }).format(new Date(value));
}

export function DashboardScreen() {
  const { token, user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadSummary = useCallback(
    async (shouldApply: () => boolean = () => true) => {
      if (shouldApply()) {
        setIsLoading(true);
        setError(null);
      }

      try {
        if (!token) {
          throw new Error('You are not logged in');
        }

        const nextSummary = await apiRequest<DashboardSummaryResponse>(
          '/dashboard/summary',
          { token },
        );
        if (shouldApply()) {
          setSummary(nextSummary);
        }
      } catch (loadError) {
        if (shouldApply()) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Unable to load dashboard summary',
          );
        }
      } finally {
        if (shouldApply()) {
          setIsLoading(false);
        }
      }
    },
    [token],
  );

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      void loadSummary(() => isActive);

      return () => {
        isActive = false;
      };
    }, [loadSummary]),
  );

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.greeting}>
          Good morning{user?.firstName ? `, ${user.firstName}` : ''}
        </Text>
        <Text style={styles.title}>
          {summary?.business.name ?? 'Today at a glance'}
        </Text>

        {isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colours.tori} />
            <Text style={styles.stateText}>
              Loading your business dashboard...
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Dashboard API unavailable</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Text style={styles.errorBody}>
              Check the API is running and your phone/browser can reach it.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void loadSummary()}
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.grid}>
          <MetricCard label="Jobs today" value={summary?.counts.jobsToday} />
          <MetricCard
            label="Appointments today"
            value={summary?.counts.todaysAppointments}
          />
        </View>

        <View style={styles.grid}>
          <MetricCard
            label="Outstanding"
            value={
              summary
                ? formatCurrency(summary.money.outstandingInvoicesCents)
                : undefined
            }
          />
          <MetricCard
            label="Upcoming appointments"
            value={summary?.counts.upcomingAppointments}
          />
        </View>

        <View style={styles.grid}>
          <MetricCard
            label="Appointments completed"
            value={summary?.counts.completedAppointmentsToday}
          />
          <MetricCard label="Open jobs" value={summary?.counts.openJobs} />
        </View>

        <View style={styles.grid}>
          <MetricCard
            label="Late appointments"
            tone="warning"
            value={summary?.counts.lateAppointments}
          />
          <MetricCard
            label="Upcoming today"
            value={summary?.counts.upcomingTodayAppointments}
          />
        </View>

        <View style={styles.grid}>
          <MetricCard
            label="My appointments"
            value={summary?.counts.myAppointments}
          />
          <MetricCard
            label="Upcoming jobs"
            value={summary?.counts.upcomingJobs}
          />
        </View>

        <View style={styles.grid}>
          <MetricCard label="Customers" value={summary?.counts.customers} />
          <MetricCard
            label="Unread alerts"
            value={summary?.counts.unreadNotifications}
          />
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.sectionTitle}>Next appointment</Text>
          {summary?.nextAppointment ? (
            <>
              <Text style={styles.itemTitle}>
                {summary.nextAppointment.jobTitle}
              </Text>
              <Text style={styles.itemMeta}>
                {summary.nextAppointment.customerName}
              </Text>
              <Text style={styles.itemMeta}>
                {summary.nextAppointment.technicianName ?? 'Unassigned'} ·{' '}
                {formatAppointmentTime(summary.nextAppointment.startsAt)}
              </Text>
            </>
          ) : (
            <Text style={styles.emptyText}>No upcoming appointment found.</Text>
          )}
        </View>

        <View style={styles.toriCard}>
          <Text style={styles.toriLabel}>TORI'S DAILY PRIORITIES</Text>
          <Text style={styles.toriTitle}>
            {summary?.toriPriority.title ?? 'Waiting for dashboard data'}
          </Text>
          <Text style={styles.toriBody}>
            {summary?.toriPriority.body ??
              'Tori will surface jobs, follow-ups and admin drafts here.'}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Latest notifications</Text>
          {summary?.notifications.length ? (
            summary.notifications.map((notification) => (
              <View key={notification.id} style={styles.listItem}>
                <Text style={styles.itemTitle}>{notification.title}</Text>
                <Text style={styles.itemMeta}>{notification.body}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No notifications yet.</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function MetricCard({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: 'warning';
  value?: number | string;
}) {
  return (
    <View style={[styles.card, tone === 'warning' && styles.warningCard]}>
      <Text style={styles.value}>{value ?? '-'}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colours.background },
  container: { padding: 24, paddingBottom: 40 },
  greeting: { color: colours.muted, fontSize: 16, marginTop: 20 },
  title: {
    color: colours.ink,
    fontSize: 32,
    fontWeight: '800',
    marginTop: 4,
  },
  grid: { flexDirection: 'row', gap: 12, marginTop: 20 },
  card: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    padding: 18,
  },
  warningCard: { borderColor: '#FDBA74' },
  value: { color: colours.ink, fontSize: 28, fontWeight: '800' },
  label: { color: colours.muted, marginTop: 6 },
  stateCard: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    marginTop: 24,
    padding: 18,
  },
  stateText: { color: colours.muted },
  errorCard: {
    backgroundColor: '#FFF1F2',
    borderColor: '#FECDD3',
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 24,
    padding: 18,
  },
  errorTitle: { color: '#9F1239', fontSize: 16, fontWeight: '800' },
  errorBody: { color: '#9F1239', lineHeight: 20, marginTop: 8 },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#9F1239',
    borderRadius: 999,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryText: { color: '#FFFFFF', fontWeight: '800' },
  summaryCard: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 20,
    padding: 18,
  },
  toriCard: {
    backgroundColor: '#F3E8FF',
    borderRadius: 20,
    marginTop: 20,
    padding: 20,
  },
  toriLabel: {
    color: colours.tori,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  toriTitle: {
    color: colours.ink,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 10,
  },
  toriBody: { color: colours.muted, lineHeight: 21, marginTop: 6 },
  section: { marginTop: 24 },
  sectionTitle: { color: colours.ink, fontSize: 18, fontWeight: '800' },
  listItem: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 10,
    padding: 16,
  },
  itemTitle: {
    color: colours.ink,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 10,
  },
  itemMeta: { color: colours.muted, lineHeight: 20, marginTop: 4 },
  emptyText: { color: colours.muted, marginTop: 10 },
});
