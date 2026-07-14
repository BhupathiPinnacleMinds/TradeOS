import type { Job, JobFilter } from '@tradieos/shared';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { jobsRequest } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

const filters: Array<{ label: string; value?: JobFilter }> = [
  { label: 'All' },
  { label: 'Today', value: 'today' },
  { label: 'Tomorrow', value: 'tomorrow' },
  { label: 'Upcoming', value: 'upcoming' },
  { label: 'Completed', value: 'completed' },
  { label: 'Cancelled', value: 'cancelled' },
  { label: 'High priority', value: 'high-priority' },
  { label: 'My jobs', value: 'my-jobs' },
  { label: 'Unassigned', value: 'unassigned' },
];

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
  }).format(new Date(value));
}

function label(value: string) {
  return value.replaceAll('_', ' ');
}

export function JobsScreen() {
  const { token } = useAuth();
  const { showToast } = useToast();
  const navigation = useNavigation<Navigation>();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filter, setFilter] = useState<JobFilter | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const loadJobs = useCallback(
    async (options: { refreshing?: boolean } = {}) => {
      if (!token) return;
      if (options.refreshing) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);
      try {
        const response = await jobsRequest(token, {
          filter,
          page: 1,
          pageSize: 50,
          sortBy: 'scheduledStart',
          sortOrder: 'asc',
        });
        setJobs(response.records);
        setTotal(response.total);
      } catch (loadError) {
        const message =
          loadError instanceof Error
            ? loadError.message
            : "We couldn't load jobs.";
        setError(message);
        showToast({ message, tone: 'error' });
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [filter, showToast, token],
  );

  useFocusEffect(
    useCallback(() => {
      void loadJobs();
    }, [loadJobs]),
  );

  const emptyText = useMemo(() => {
    if (filter === 'today') return 'No jobs scheduled for today.';
    if (filter === 'my-jobs') return 'No jobs assigned to you.';
    if (filter === 'unassigned') return 'No unassigned jobs.';
    return 'No jobs yet. Create a job from a customer to start scheduling work.';
  }, [filter]);

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void loadJobs({ refreshing: true })}
          />
        }
      >
        <Text style={styles.eyebrow}>JOBS</Text>
        <Text style={styles.title}>Job Management</Text>
        <Text style={styles.subtitle}>
          Schedule work, assign technicians and keep every job moving.
        </Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.filterRow}>
            {filters.map((item) => (
              <Pressable
                accessibilityRole="button"
                key={item.label}
                onPress={() => setFilter(item.value)}
                style={[
                  styles.chip,
                  filter === item.value && styles.chipActive,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    filter === item.value && styles.chipTextActive,
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <View style={styles.countRow}>
          <Text style={styles.resultCount}>
            {jobs.length} of {total} job{total === 1 ? '' : 's'}
          </Text>
          <Pressable onPress={() => void loadJobs()} style={styles.linkButton}>
            <Text style={styles.linkText}>Refresh</Text>
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colours.primary} />
            <Text style={styles.stateText}>Loading jobs...</Text>
          </View>
        ) : null}

        {!isLoading && error ? (
          <View style={styles.stateCard}>
            <Text style={styles.emptyTitle}>Jobs unavailable</Text>
            <Text style={styles.emptyText}>{error}</Text>
          </View>
        ) : null}

        {!isLoading && !error && jobs.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{emptyText}</Text>
            <Text style={styles.emptyText}>
              Jobs stay scoped to your business workspace.
            </Text>
          </View>
        ) : null}

        {jobs.map((job) => (
          <JobCard
            job={job}
            key={job.id}
            onPress={() => navigation.navigate('JobDetails', { jobId: job.id })}
          />
        ))}
      </ScrollView>

      <Pressable
        accessibilityLabel="Create new job"
        accessibilityRole="button"
        onPress={() => navigation.navigate('JobForm', {})}
        style={styles.floatingButton}
      >
        <Text style={styles.floatingText}>+ New Job</Text>
      </Pressable>
    </View>
  );
}

function JobCard({ job, onPress }: { job: Job; onPress(): void }) {
  const assignee = job.assignedTo
    ? `${job.assignedTo.firstName} ${job.assignedTo.lastName}`
    : 'Unassigned';

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.jobNumber}>{job.jobNumber}</Text>
        <Text style={[styles.badge, priorityStyle(job.priority)]}>
          {label(job.priority)}
        </Text>
      </View>
      <Text style={styles.cardTitle}>{job.title}</Text>
      <Text style={styles.cardSub}>{job.customer.displayName}</Text>
      <Text style={styles.meta}>
        {[job.addressLine1, job.suburb, job.state].filter(Boolean).join(', ')}
      </Text>
      <Text style={styles.meta}>{formatDateTime(job.scheduledStart)}</Text>
      <View style={styles.footerRow}>
        <Text style={styles.status}>{label(job.status)}</Text>
        <Text style={styles.meta}>{assignee}</Text>
      </View>
    </Pressable>
  );
}

function priorityStyle(priority: Job['priority']) {
  if (priority === 'URGENT') return styles.priorityUrgent;
  if (priority === 'HIGH') return styles.priorityHigh;
  if (priority === 'LOW') return styles.priorityLow;
  return styles.priorityNormal;
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  card: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 12,
    padding: 16,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardSub: { color: colours.muted, marginTop: 4 },
  cardTitle: {
    color: colours.ink,
    fontSize: 18,
    fontWeight: '900',
    marginTop: 8,
  },
  chip: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: colours.primary },
  chipText: { color: colours.muted, fontWeight: '800' },
  chipTextActive: { color: '#FFFFFF' },
  container: { padding: 24, paddingBottom: 110 },
  countRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  emptyCard: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 16,
    padding: 20,
  },
  emptyText: { color: colours.muted, lineHeight: 21, marginTop: 6 },
  emptyTitle: { color: colours.ink, fontSize: 18, fontWeight: '900' },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  filterRow: { flexDirection: 'row', gap: 8, marginTop: 18, paddingBottom: 4 },
  flex: { backgroundColor: colours.background, flex: 1 },
  floatingButton: {
    backgroundColor: colours.primary,
    borderRadius: 999,
    bottom: 24,
    paddingHorizontal: 22,
    paddingVertical: 16,
    position: 'absolute',
    right: 24,
  },
  floatingText: { color: '#FFFFFF', fontWeight: '900' },
  footerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  jobNumber: { color: colours.primary, fontSize: 13, fontWeight: '900' },
  linkButton: { padding: 8 },
  linkText: { color: colours.primary, fontWeight: '900' },
  meta: { color: colours.muted, lineHeight: 20, marginTop: 5 },
  priorityHigh: { backgroundColor: '#FEF3C7', color: '#92400E' },
  priorityLow: { backgroundColor: '#E0F2FE', color: '#0369A1' },
  priorityNormal: { backgroundColor: '#EEF2FF', color: colours.primary },
  priorityUrgent: { backgroundColor: '#FFE4E6', color: '#BE123C' },
  resultCount: { color: colours.muted, fontWeight: '800' },
  stateCard: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 10,
    marginTop: 16,
    padding: 20,
  },
  stateText: { color: colours.muted },
  status: { color: colours.ink, fontWeight: '900' },
  subtitle: { color: colours.muted, lineHeight: 22, marginTop: 8 },
  title: { color: colours.ink, fontSize: 34, fontWeight: '900', marginTop: 4 },
});
