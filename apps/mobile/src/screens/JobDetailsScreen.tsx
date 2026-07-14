import type { Job, JobStatus } from '@tradieos/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  archiveJobRequest,
  jobDetailRequest,
  restoreJobRequest,
  updateJobStatusRequest,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'JobDetails'>;

function label(value: string) {
  return value.replaceAll('_', ' ');
}

function formatDateTime(value: string | null) {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function JobDetailsScreen({ navigation, route }: Props) {
  const { jobId } = route.params;
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const [job, setJob] = useState<Job | null>(null);
  const [activity, setActivity] = useState<
    Array<{ action: string; createdAt: string }>
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);

  const canEdit = ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER'].includes(
    user?.role ?? '',
  );
  const canArchive = ['OWNER', 'ADMIN', 'OFFICE_MANAGER'].includes(
    user?.role ?? '',
  );
  const canUpdateStatus = [
    'OWNER',
    'ADMIN',
    'OFFICE_MANAGER',
    'SCHEDULER',
    'TECHNICIAN',
  ].includes(user?.role ?? '');

  async function loadJob() {
    if (!token) return;
    setIsLoading(true);
    try {
      const response = await jobDetailRequest(token, jobId);
      setJob(response.job);
      setActivity(response.activity);
      navigation.setOptions({ title: response.job.jobNumber });
    } catch {
      showToast({ message: "We couldn't load this job.", tone: 'error' });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadJob();
  }, [jobId, token]);

  async function changeStatus(status: JobStatus) {
    if (!token || !job || isBusy) return;
    setIsBusy(true);
    try {
      const response = await updateJobStatusRequest(token, job.id, status);
      setJob(response.job);
      setActivity(response.activity);
      showToast({
        message: `Job marked ${label(status).toLowerCase()}.`,
        tone: 'success',
      });
    } catch (error) {
      showToast({
        message:
          error instanceof Error
            ? error.message
            : "We couldn't update this job.",
        tone: 'error',
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function archiveOrRestore() {
    if (!token || !job || isBusy) return;
    setIsBusy(true);
    try {
      const response = job.isArchived
        ? await restoreJobRequest(token, job.id)
        : await archiveJobRequest(token, job.id);
      setJob(response.job);
      setActivity(response.activity);
      showToast({
        message: job.isArchived ? 'Job restored.' : 'Job archived.',
        tone: 'success',
      });
    } catch (error) {
      showToast({
        message:
          error instanceof Error
            ? error.message
            : "We couldn't update this job.",
        tone: 'error',
      });
    } finally {
      setIsBusy(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.loadingPage}>
        <ActivityIndicator color={colours.primary} />
        <Text style={styles.muted}>Loading job...</Text>
      </View>
    );
  }

  if (!job) {
    return (
      <View style={styles.loadingPage}>
        <Text style={styles.title}>Job not found</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.eyebrow}>{job.jobNumber}</Text>
      <Text style={styles.title}>{job.title}</Text>
      <Text style={styles.subtitle}>
        {label(job.status)} · {label(job.priority)} priority
      </Text>
      {job.isArchived ? (
        <Text style={styles.archived}>Archived job</Text>
      ) : null}

      <View style={styles.quickRow}>
        <QuickAction
          disabled={!job.customer.phone}
          label="Call"
          onPress={() => void Linking.openURL(`tel:${job.customer.phone}`)}
        />
        <QuickAction
          disabled={!job.customer.phone}
          label="SMS"
          onPress={() => void Linking.openURL(`sms:${job.customer.phone}`)}
        />
        <QuickAction
          disabled={!job.customer.email}
          label="Email"
          onPress={() => void Linking.openURL(`mailto:${job.customer.email}`)}
        />
        <QuickAction
          label="Navigate"
          onPress={() =>
            void Linking.openURL(
              `https://maps.apple.com/?q=${encodeURIComponent(
                [job.addressLine1, job.suburb, job.state, job.postcode].join(
                  ' ',
                ),
              )}`,
            )
          }
        />
        {canEdit ? (
          <QuickAction
            label="Edit"
            onPress={() => navigation.navigate('JobForm', { jobId: job.id })}
          />
        ) : null}
      </View>

      {canUpdateStatus ? (
        <View style={styles.actions}>
          <ActionButton
            label="Start Job"
            onPress={() => void changeStatus('IN_PROGRESS')}
          />
          <ActionButton
            label="Complete Job"
            onPress={() => void changeStatus('COMPLETED')}
          />
          <ActionButton
            label="Put On Hold"
            onPress={() => void changeStatus('ON_HOLD')}
          />
          <ActionButton
            danger
            label="Cancel Job"
            onPress={() => void changeStatus('CANCELLED')}
          />
        </View>
      ) : null}

      <Card title="Customer">
        <Text style={styles.meta}>{job.customer.displayName}</Text>
        <Text style={styles.meta}>
          Phone: {job.customer.phone ?? 'Not recorded'}
        </Text>
        <Text style={styles.meta}>
          Email: {job.customer.email ?? 'Not recorded'}
        </Text>
      </Card>

      <Card title="Address">
        <Text style={styles.meta}>
          {[
            job.addressLine1,
            job.addressLine2,
            job.suburb,
            job.state,
            job.postcode,
          ]
            .filter(Boolean)
            .join(', ')}
        </Text>
        <Text style={styles.meta}>
          Access: {job.accessInstructions ?? 'No access instructions.'}
        </Text>
      </Card>

      <Card title="Job description">
        <Text style={styles.meta}>
          {job.description ?? 'No description recorded.'}
        </Text>
        <Text style={styles.meta}>
          Customer notes: {job.customerNotes ?? 'None'}
        </Text>
        <Text style={styles.meta}>
          Internal notes: {job.internalNotes ?? 'None'}
        </Text>
      </Card>

      <Card title="Schedule">
        <Text style={styles.meta}>
          Start: {formatDateTime(job.scheduledStart)}
        </Text>
        <Text style={styles.meta}>End: {formatDateTime(job.scheduledEnd)}</Text>
        <Text style={styles.meta}>
          Estimated duration: {job.estimatedDurationMinutes ?? 'Not recorded'}{' '}
          minutes
        </Text>
        <Text style={styles.meta}>
          Assigned staff:{' '}
          {job.assignedTo
            ? `${job.assignedTo.firstName} ${job.assignedTo.lastName}`
            : 'Unassigned'}
        </Text>
      </Card>

      <Card title="Future sections">
        <Text style={styles.meta}>
          Quotes: {job.quoteCreated ? 'Created' : 'Not created yet'}
        </Text>
        <Text style={styles.meta}>
          Invoices: {job.invoiceCreated ? 'Created' : 'Not created yet'}
        </Text>
        <Text style={styles.meta}>Photos: Coming later.</Text>
        <Text style={styles.meta}>Documents: Coming later.</Text>
      </Card>

      <Card title="Activity">
        {activity.length === 0 ? (
          <Text style={styles.meta}>No job activity yet.</Text>
        ) : null}
        {activity.map((entry) => (
          <Text key={`${entry.action}-${entry.createdAt}`} style={styles.meta}>
            {formatDateTime(entry.createdAt)} · {label(entry.action)}
          </Text>
        ))}
      </Card>

      {canArchive ? (
        <Pressable
          accessibilityRole="button"
          disabled={isBusy}
          onPress={() => void archiveOrRestore()}
          style={[styles.dangerButton, job.isArchived && styles.restoreButton]}
        >
          <Text style={styles.dangerText}>
            {job.isArchived ? 'Restore job' : 'Archive job'}
          </Text>
        </Pressable>
      ) : null}

      {isBusy ? (
        <View style={styles.busy}>
          <ActivityIndicator color={colours.primary} />
          <Text style={styles.muted}>Updating job...</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function QuickAction({
  disabled,
  label: text,
  onPress,
}: {
  disabled?: boolean;
  label: string;
  onPress(): void;
}) {
  if (disabled) return null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.quickAction}
    >
      <Text style={styles.quickText}>{text}</Text>
    </Pressable>
  );
}

function ActionButton({
  danger,
  label: text,
  onPress,
}: {
  danger?: boolean;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.actionButton, danger && styles.actionDanger]}
    >
      <Text style={[styles.actionText, danger && styles.actionDangerText]}>
        {text}
      </Text>
    </Pressable>
  );
}

function Card({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  actionDanger: { backgroundColor: '#FFF1F2' },
  actionDangerText: { color: '#BE123C' },
  actionText: { color: colours.primary, fontWeight: '900' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  archived: { color: '#9F1239', fontWeight: '900', marginTop: 8 },
  busy: { alignItems: 'center', gap: 8, marginTop: 16 },
  card: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 16,
    padding: 16,
  },
  cardTitle: { color: colours.ink, fontSize: 18, fontWeight: '900' },
  container: {
    backgroundColor: colours.background,
    padding: 24,
    paddingBottom: 44,
  },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: '#9F1239',
    borderRadius: 999,
    marginTop: 18,
    padding: 14,
  },
  dangerText: { color: '#FFFFFF', fontWeight: '900' },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  loadingPage: {
    alignItems: 'center',
    backgroundColor: colours.background,
    flex: 1,
    gap: 12,
    justifyContent: 'center',
  },
  meta: { color: colours.muted, lineHeight: 21, marginTop: 8 },
  muted: { color: colours.muted },
  quickAction: {
    backgroundColor: colours.primary,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  quickText: { color: '#FFFFFF', fontWeight: '900' },
  restoreButton: { backgroundColor: colours.primary },
  subtitle: { color: colours.muted, lineHeight: 22, marginTop: 8 },
  title: { color: colours.ink, fontSize: 32, fontWeight: '900', marginTop: 4 },
});
