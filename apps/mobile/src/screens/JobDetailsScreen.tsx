import type { Appointment, Job, JobStatus } from '@tradieos/shared';
import {
  DEFAULT_BUSINESS_TIMEZONE,
  formatBusinessDateTime,
  formatBusinessTimeRange,
  normaliseBusinessTimezone,
} from '@tradieos/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
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
  transitionAppointmentRequest,
  updateJobStatusRequest,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import type { RootStackParamList } from '../navigation/types';
import {
  canArchiveJob,
  canCreateAppointment,
  canManageJob,
} from '../permissions/roleVisibility';
import { colours } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'JobDetails'>;

function label(value: string) {
  return value.replaceAll('_', ' ');
}

function formatDateTime(
  value: string | null,
  timezone: string = DEFAULT_BUSINESS_TIMEZONE,
) {
  if (!value) return 'Not recorded';
  return formatBusinessDateTime(value, timezone);
}

export function JobDetailsScreen({ navigation, route }: Props) {
  const { jobId } = route.params;
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const businessTimezone = normaliseBusinessTimezone(user?.business.timezone);
  const [job, setJob] = useState<Job | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [timeline, setTimeline] = useState<
    Array<{ action: string; createdAt: string; entityType: string }>
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);

  const canEdit = canManageJob(user?.role);
  const canArchive = canArchiveJob(user?.role);
  const canScheduleAppointment = canCreateAppointment(user?.role);
  const canUpdateStatus = canEdit;

  async function loadJob() {
    if (!token) return;
    setIsLoading(true);
    try {
      const response = await jobDetailRequest(token, jobId);
      setJob(response.job);
      setAppointments(response.appointments);
      setTimeline(response.timeline);
      navigation.setOptions({ title: response.job.jobNumber });
    } catch {
      showToast({ message: "We couldn't load this job.", tone: 'error' });
    } finally {
      setIsLoading(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      void loadJob();
    }, [jobId, token]),
  );

  async function changeStatus(status: JobStatus) {
    if (!token || !job || isBusy) return;
    setIsBusy(true);
    try {
      const response = await updateJobStatusRequest(token, job.id, status);
      setJob(response.job);
      setAppointments(response.appointments);
      setTimeline(response.timeline);
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
      setAppointments(response.appointments);
      setTimeline(response.timeline);
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

  async function transitionAppointment(
    appointmentId: string,
    action: 'start-travel' | 'start' | 'arrive' | 'cancel',
  ) {
    if (!token || isBusy) return;
    setIsBusy(true);
    try {
      await transitionAppointmentRequest(token, appointmentId, action);
      await loadJob();
      showToast({ message: `Appointment ${action} updated.`, tone: 'success' });
    } catch (error) {
      showToast({
        message:
          error instanceof Error
            ? error.message
            : "We couldn't update this appointment.",
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
        {canScheduleAppointment ? (
          <QuickAction
            label="Schedule Appointment"
            onPress={() =>
              navigation.navigate('AppointmentForm', {
                customerId: job.customerId,
                jobId: job.id,
              })
            }
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

      <Card title="Appointments">
        {appointments.length === 0 ? (
          <Text style={styles.meta}>No appointments booked yet.</Text>
        ) : null}
        {appointments.map((appointment) => (
          <View key={appointment.id} style={styles.appointmentCard}>
            <Text style={styles.appointmentTitle}>
              {appointment.appointmentNumber} ·{' '}
              {label(appointment.appointmentType)}
            </Text>
            <Text style={styles.meta}>
              {formatDateTime(appointment.scheduledStart, businessTimezone)} ·{' '}
              {formatBusinessTimeRange(
                appointment.scheduledStart,
                appointment.scheduledEnd,
                businessTimezone,
              )}
            </Text>
            <Text style={styles.meta}>Status: {label(appointment.status)}</Text>
            <Text style={styles.meta}>
              Technician:{' '}
              {appointment.assignedUser
                ? `${appointment.assignedUser.firstName} ${appointment.assignedUser.lastName}`
                : 'Unassigned'}
            </Text>
            <Text style={styles.meta}>
              Notes: {appointment.notes ?? 'No appointment notes.'}
            </Text>
            {canUpdateStatus ? (
              <View style={styles.actions}>
                {canEdit ? (
                  <ActionButton
                    label="Reassign"
                    onPress={() =>
                      navigation.navigate('AppointmentReassign', {
                        appointmentId: appointment.id,
                      })
                    }
                  />
                ) : null}
                <ActionButton
                  label="Start travel"
                  onPress={() =>
                    void transitionAppointment(appointment.id, 'start-travel')
                  }
                />
                <ActionButton
                  label="Arrive"
                  onPress={() =>
                    void transitionAppointment(appointment.id, 'arrive')
                  }
                />
                <ActionButton
                  label="Complete"
                  onPress={() =>
                    navigation.navigate('AppointmentDetails', {
                      appointmentId: appointment.id,
                    })
                  }
                />
                <ActionButton
                  danger
                  label="Cancel"
                  onPress={() =>
                    void transitionAppointment(appointment.id, 'cancel')
                  }
                />
              </View>
            ) : null}
          </View>
        ))}
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

      <Card title="Timeline">
        {timeline.length === 0 ? (
          <Text style={styles.meta}>No job timeline yet.</Text>
        ) : null}
        {timeline.map((entry) => (
          <Text
            key={`${entry.entityType}-${entry.action}-${entry.createdAt}`}
            style={styles.meta}
          >
            {formatDateTime(entry.createdAt, businessTimezone)} ·{' '}
            {label(entry.action)}
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
  appointmentCard: {
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
  appointmentTitle: { color: colours.ink, fontWeight: '900' },
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
