import type {
  Appointment,
  AppointmentTransitionAction,
  Job,
  JobDetailResponse,
  JobStatus,
  MediaAsset,
} from '@tradieos/shared';
import {
  DEFAULT_BUSINESS_TIMEZONE,
  formatAudCents,
  formatBusinessDateTime,
  formatMediaCount,
  formatBusinessTimeRange,
  getAppointmentQuickActions,
  mediaDisplayTitle,
  normaliseBusinessTimezone,
  roleCanCreateQuotes,
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
  archiveMediaRequest,
  archiveJobRequest,
  friendlyAppointmentMutationError,
  jobDetailRequest,
  mediaRequest,
  restoreJobRequest,
  restoreMediaRequest,
  transitionAppointmentRequest,
  updateJobStatusRequest,
} from '../api/client';
import {
  canArchiveMediaInUi,
  canRestoreMediaInUi,
  friendlyMediaArchiveError,
  mediaRemovedMessage,
  mediaRestoredMessage,
} from '../api/mediaActions';
import { useAuth } from '../auth/AuthContext';
import {
  MediaOverflowMenu,
  MediaRemovalConfirmation,
} from '../components/MediaOverflowMenu';
import { useToast } from '../components/ToastProvider';
import type { RootStackParamList } from '../navigation/types';
import {
  canAccessStackRoute,
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

function appointmentTransitionActionId(
  actionId: string,
): AppointmentTransitionAction {
  if (actionId === 'confirm') return 'confirm';
  if (actionId === 'startTravel') return 'start-travel';
  if (
    actionId === 'start' ||
    actionId === 'arrive' ||
    actionId === 'pause' ||
    actionId === 'resume'
  ) {
    return actionId;
  }
  return 'cancel';
}

export function JobDetailsScreen({ navigation, route }: Props) {
  const { jobId } = route.params;
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const businessTimezone = normaliseBusinessTimezone(user?.business.timezone);
  const [job, setJob] = useState<Job | null>(null);
  const [sourceQuote, setSourceQuote] =
    useState<JobDetailResponse['sourceQuote']>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [timeline, setTimeline] = useState<
    Array<{ action: string; createdAt: string; entityType: string }>
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [mediaToRemove, setMediaToRemove] = useState<MediaAsset | null>(null);
  const [busyMediaId, setBusyMediaId] = useState<string | null>(null);
  const [showArchivedMedia, setShowArchivedMedia] = useState(false);

  const canEdit = canManageJob(user?.role);
  const canArchive = canArchiveJob(user?.role);
  const canScheduleAppointment = canCreateAppointment(user?.role);
  const canUpdateStatus = canEdit;
  const canAddMedia = canAccessStackRoute(user?.role, 'MediaEvidence');
  const canCreateQuote = roleCanCreateQuotes(user?.role ?? 'READ_ONLY');

  async function loadJob() {
    if (!token) return;
    setIsLoading(true);
    try {
      const [response, mediaResponse] = await Promise.all([
        jobDetailRequest(token, jobId),
        mediaRequest(token, {
          archived: showArchivedMedia ? 'true' : undefined,
          jobId,
        }),
      ]);
      setJob(response.job);
      setSourceQuote(response.sourceQuote);
      setAppointments(response.appointments);
      setTimeline(response.timeline);
      setMedia(mediaResponse.records);
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
    }, [jobId, showArchivedMedia, token]),
  );

  async function changeStatus(status: JobStatus) {
    if (!token || !job || isBusy) return;
    setIsBusy(true);
    try {
      const response = await updateJobStatusRequest(token, job.id, status);
      setJob(response.job);
      setSourceQuote(response.sourceQuote);
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
      setSourceQuote(response.sourceQuote);
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

  async function archiveMedia(mediaItem: MediaAsset) {
    if (!token || busyMediaId) return;
    const previousMedia = media;
    setBusyMediaId(mediaItem.id);
    setMediaToRemove(null);
    setMedia((current) => current.filter((item) => item.id !== mediaItem.id));
    try {
      await archiveMediaRequest(token, mediaItem.id);
      showToast({
        message: mediaRemovedMessage(mediaItem),
        tone: 'success',
      });
      await loadJob();
    } catch (error) {
      setMedia(previousMedia);
      showToast({ message: friendlyMediaArchiveError(error), tone: 'error' });
    } finally {
      setBusyMediaId(null);
    }
  }

  async function restoreMedia(mediaItem: MediaAsset) {
    if (!token || busyMediaId) return;
    setBusyMediaId(mediaItem.id);
    try {
      await restoreMediaRequest(token, mediaItem.id);
      showToast({
        message: mediaRestoredMessage(mediaItem),
        tone: 'success',
      });
      await loadJob();
    } catch {
      showToast({
        message: "We couldn't restore this file. Please try again.",
        tone: 'error',
      });
    } finally {
      setBusyMediaId(null);
    }
  }

  async function transitionAppointment(
    appointmentId: string,
    action: AppointmentTransitionAction,
  ) {
    if (!token || isBusy) return;
    setIsBusy(true);
    try {
      await transitionAppointmentRequest(token, appointmentId, action);
      await loadJob();
      showToast({
        message:
          action === 'confirm'
            ? 'Appointment confirmed.'
            : `Appointment ${action} updated.`,
        tone: 'success',
      });
    } catch (error) {
      showToast({
        message: friendlyAppointmentMutationError(error),
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
        {canCreateQuote ? (
          <QuickAction
            label={sourceQuote ? 'New Additional Quote' : 'Create Quote'}
            onPress={() =>
              navigation.navigate('QuoteForm', {
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

      {['OWNER', 'ADMIN', 'OFFICE_MANAGER'].includes(user?.role ?? '') ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowArchivedMedia((value) => !value)}
          style={styles.archiveFilter}
        >
          <Text style={styles.archiveFilterText}>
            {showArchivedMedia
              ? 'Showing archived media'
              : 'Showing active media'}
          </Text>
        </Pressable>
      ) : null}

      <Card title="Photos">
        <MediaList
          busyMediaId={busyMediaId}
          emptyText="No photos captured yet."
          media={media.filter((item) => item.mediaType === 'IMAGE')}
          navigation={navigation}
          onRemove={setMediaToRemove}
          onRestore={restoreMedia}
          user={user}
        />
        {canAddMedia ? (
          <ActionButton
            label="Add photo evidence"
            onPress={() =>
              navigation.navigate('MediaEvidence', {
                customerId: job.customerId,
                jobId: job.id,
              })
            }
          />
        ) : null}
      </Card>

      <Card title="Documents">
        <MediaList
          busyMediaId={busyMediaId}
          emptyText="No job documents yet."
          media={media.filter((item) => item.mediaType !== 'IMAGE')}
          navigation={navigation}
          onRemove={setMediaToRemove}
          onRestore={restoreMedia}
          user={user}
        />
        {canAddMedia ? (
          <ActionButton
            label="Add document"
            onPress={() =>
              navigation.navigate('MediaEvidence', {
                customerId: job.customerId,
                jobId: job.id,
              })
            }
          />
        ) : null}
      </Card>

      <Card title="Appointments">
        {appointments.length === 0 ? (
          <Text style={styles.meta}>No appointments booked yet.</Text>
        ) : null}
        {appointments.map((appointment) => {
          const appointmentActions = getAppointmentQuickActions({
            hasAddress: Boolean(appointment.addressLine1),
            hasPhone: Boolean(appointment.job.customer.phone),
            isAssignedUser: appointment.assignedUserId === user?.id,
            role: user?.role,
            status: appointment.status,
          });
          const workflowActions = appointmentActions.filter((action) =>
            [
              'confirm',
              'startTravel',
              'start',
              'arrive',
              'pause',
              'resume',
            ].includes(action.id),
          );
          const cancelAction = appointmentActions.find(
            (action) => action.id === 'cancel',
          );
          const canCompleteAppointment = appointmentActions.some(
            (action) => action.id === 'complete',
          );

          return (
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
              <Text style={styles.meta}>
                Status: {label(appointment.status)}
              </Text>
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
                      label="Reassign Technician"
                      onPress={() =>
                        navigation.navigate('AppointmentReassign', {
                          appointmentId: appointment.id,
                        })
                      }
                    />
                  ) : null}
                  {workflowActions.map((action) => (
                    <ActionButton
                      key={action.id}
                      label={action.label}
                      onPress={() =>
                        void transitionAppointment(
                          appointment.id,
                          appointmentTransitionActionId(action.id),
                        )
                      }
                    />
                  ))}
                  {canCompleteAppointment ? (
                    <ActionButton
                      label="Complete work"
                      onPress={() =>
                        navigation.navigate('AppointmentDetails', {
                          appointmentId: appointment.id,
                        })
                      }
                    />
                  ) : null}
                  {cancelAction ? (
                    <ActionButton
                      danger
                      label={cancelAction.label}
                      onPress={() =>
                        void transitionAppointment(appointment.id, 'cancel')
                      }
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </Card>

      <Card title="Future sections">
        {sourceQuote ? (
          <View style={styles.sourceQuoteCard}>
            <Text style={styles.cardTitle}>Source Quote</Text>
            <Text style={styles.meta}>{sourceQuote.quoteNumber}</Text>
            <Text style={styles.meta}>
              Accepted total: {formatAudCents(sourceQuote.totalCents)}
            </Text>
            <ActionButton
              label="View Quote"
              onPress={() =>
                navigation.navigate('QuoteDetails', { quoteId: sourceQuote.id })
              }
            />
          </View>
        ) : null}
        <Text style={styles.meta}>
          Quotes: {job.quoteCreated ? 'Created' : 'Not created yet'}
        </Text>
        {canCreateQuote && !job.quoteCreated ? (
          <ActionButton
            label={sourceQuote ? 'New additional quote' : 'Create quote'}
            onPress={() =>
              navigation.navigate('QuoteForm', {
                customerId: job.customerId,
                jobId: job.id,
              })
            }
          />
        ) : null}
        <Text style={styles.meta}>
          Invoices: {job.invoiceCreated ? 'Created' : 'Not created yet'}
        </Text>
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
      <MediaRemovalConfirmation
        busy={Boolean(busyMediaId)}
        media={mediaToRemove}
        onCancel={() => setMediaToRemove(null)}
        onConfirm={() => mediaToRemove && void archiveMedia(mediaToRemove)}
        visible={Boolean(mediaToRemove)}
      />
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

function MediaList({
  busyMediaId,
  emptyText,
  media,
  navigation,
  onRemove,
  onRestore,
  user,
}: {
  busyMediaId: string | null;
  emptyText: string;
  media: MediaAsset[];
  navigation: Props['navigation'];
  onRemove(media: MediaAsset): void;
  onRestore(media: MediaAsset): void;
  user: ReturnType<typeof useAuth>['user'];
}) {
  if (media.length === 0) {
    return <Text style={styles.meta}>{emptyText}</Text>;
  }
  const countNoun = media.every((item) => item.mediaType === 'IMAGE')
    ? 'photo'
    : 'document';
  return (
    <View style={styles.mediaGrid}>
      <Text style={styles.mediaSummary}>
        {formatMediaCount(media.length, countNoun)}
      </Text>
      {media.map((item) => (
        <MediaTile
          busy={busyMediaId === item.id}
          item={item}
          key={item.id}
          navigation={navigation}
          onRemove={() => onRemove(item)}
          onRestore={() => onRestore(item)}
          user={user}
        />
      ))}
      {false &&
        media.map((item) => (
          <Pressable
            key={item.id}
            onPress={() =>
              navigation.navigate('MediaViewer', { mediaId: item.id })
            }
            style={styles.mediaTile}
          >
            <Text style={styles.mediaIcon}>
              {item.mediaType === 'IMAGE' ? '🖼️' : '📄'}
            </Text>
            <Text numberOfLines={1} style={styles.mediaName}>
              {item.caption ?? item.originalFileName}
            </Text>
            <Text style={styles.meta}>{label(item.category)}</Text>
          </Pressable>
        ))}
    </View>
  );
}

function MediaTile({
  busy,
  item,
  navigation,
  onRemove,
  onRestore,
  user,
}: {
  busy: boolean;
  item: MediaAsset;
  navigation: Props['navigation'];
  onRemove(): void;
  onRestore(): void;
  user: ReturnType<typeof useAuth>['user'];
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const view = () => navigation.navigate('MediaViewer', { mediaId: item.id });
  return (
    <View style={styles.mediaTileShell}>
      <Pressable onPress={view} style={styles.mediaTile}>
        <Text style={styles.mediaIcon}>
          {item.mediaType === 'IMAGE' ? '🖼️' : '📄'}
        </Text>
        <Text numberOfLines={2} style={styles.mediaName}>
          {mediaDisplayTitle(item)}
        </Text>
        <Text style={styles.meta}>{label(item.category)}</Text>
      </Pressable>
      <MediaOverflowMenu
        busy={busy}
        canArchive={canArchiveMediaInUi(user, item)}
        canRestore={canRestoreMediaInUi(user, item)}
        media={item}
        onArchive={() => {
          setIsMenuOpen(false);
          onRemove();
        }}
        onClose={() => setIsMenuOpen(false)}
        onOpen={() => setIsMenuOpen(true)}
        onRestore={() => {
          setIsMenuOpen(false);
          onRestore();
        }}
        onView={() => {
          setIsMenuOpen(false);
          view();
        }}
        open={isMenuOpen}
      />
    </View>
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
  archiveFilter: {
    alignSelf: 'flex-start',
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  archiveFilterText: { color: colours.primary, fontWeight: '900' },
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
  sourceQuoteCard: {
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
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
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  mediaIcon: { fontSize: 28 },
  mediaName: { color: colours.ink, fontWeight: '900' },
  mediaSummary: { color: colours.muted, fontWeight: '800', marginTop: 2 },
  mediaTileShell: { position: 'relative' },
  mediaTile: {
    backgroundColor: colours.card,
    borderRadius: 16,
    gap: 4,
    minWidth: 132,
    padding: 12,
    paddingRight: 60,
  },
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
