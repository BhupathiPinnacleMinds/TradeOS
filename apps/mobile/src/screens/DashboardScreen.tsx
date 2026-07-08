import type { DashboardSummaryResponse } from '@tradieos/shared';
import { useEffect, useState } from 'react';
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

export function DashboardScreen() {
  const { token, user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function loadSummary() {
    setIsLoading(true);
    setError(null);

    try {
      if (!token) {
        throw new Error('You are not logged in');
      }

      setSummary(
        await apiRequest<DashboardSummaryResponse>('/dashboard/summary', {
          token,
        }),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load dashboard summary',
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadSummary();
  }, [token]);

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
              style={styles.retryButton}
              onPress={() => void loadSummary()}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.grid}>
          <View style={styles.card}>
            <Text style={styles.value}>{summary?.counts.jobsToday ?? '-'}</Text>
            <Text style={styles.label}>Jobs today</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.value}>
              {summary
                ? formatCurrency(summary.money.outstandingInvoicesCents)
                : '-'}
            </Text>
            <Text style={styles.label}>Outstanding</Text>
          </View>
        </View>

        <View style={styles.grid}>
          <View style={styles.card}>
            <Text style={styles.value}>{summary?.counts.customers ?? '-'}</Text>
            <Text style={styles.label}>Customers</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.value}>
              {summary?.counts.unreadNotifications ?? '-'}
            </Text>
            <Text style={styles.label}>Unread alerts</Text>
          </View>
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
          <Text style={styles.sectionTitle}>Today’s jobs</Text>
          {summary?.todayJobs.length ? (
            summary.todayJobs.map((job) => (
              <View key={job.id} style={styles.listItem}>
                <Text style={styles.itemTitle}>{job.title}</Text>
                <Text style={styles.itemMeta}>
                  {job.customerName} · {job.status.replaceAll('_', ' ')}
                </Text>
                {job.address ? (
                  <Text style={styles.itemMeta}>{job.address}</Text>
                ) : null}
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No jobs scheduled for today.</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Latest notifications</Text>
          {summary?.notifications.map((notification) => (
            <View key={notification.id} style={styles.listItem}>
              <Text style={styles.itemTitle}>{notification.title}</Text>
              <Text style={styles.itemMeta}>{notification.body}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
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
  grid: { flexDirection: 'row', gap: 12, marginTop: 28 },
  card: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    padding: 18,
  },
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
  toriCard: {
    backgroundColor: '#EFEDFF',
    borderRadius: 20,
    marginTop: 16,
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
  itemTitle: { color: colours.ink, fontSize: 16, fontWeight: '700' },
  itemMeta: { color: colours.muted, lineHeight: 20, marginTop: 4 },
  emptyText: { color: colours.muted, marginTop: 10 },
});
