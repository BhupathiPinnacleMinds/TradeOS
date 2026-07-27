import type {
  Appointment,
  AppointmentQuickAction,
  AppointmentTransitionAction,
  MediaAsset,
} from '@tradieos/shared';
import {
  APPOINTMENT_STATUS_COLOURS,
  DEFAULT_BUSINESS_TIMEZONE,
  formatBusinessDateTime,
  getAppointmentQuickActions,
  mediaCategoryLabel,
  mediaTypeLabel,
  normaliseBusinessTimezone,
} from '@tradieos/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  ApiRequestError,
  appointmentDetailRequest,
  mediaRequest,
  transitionAppointmentRequest,
  updateAppointmentRequest,
} from '../api/client';
import { downloadAuthenticatedMediaFile } from '../api/mediaFiles';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import type { RootStackParamList } from '../navigation/types';
import {
  canAccessStackRoute,
  canCreateAppointment,
} from '../permissions/roleVisibility';
import { colours } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'AppointmentDetails'>;
type AppointmentDetailsAction =
  | AppointmentQuickAction
  | {
      id: 'edit' | 'job' | 'sms';
      label: string;
      onPress(): void;
    };

function isAppointmentDetailsAction(
  action: AppointmentDetailsAction | null | undefined,
): action is AppointmentDetailsAction {
  return Boolean(action);
}

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

function durationMinutes(appointment: Appointment) {
  return Math.max(
    0,
    Math.round(
      (new Date(appointment.scheduledEnd).getTime() -
        new Date(appointment.scheduledStart).getTime()) /
        60000,
    ),
  );
}

function friendlyAppointmentError(error: unknown) {
  if (
    error instanceof ApiRequestError &&
    (error.status === 404 || error.code === 'APPOINTMENT_NOT_FOUND')
  ) {
    return 'This appointment is no longer available. Refresh My Day and try again.';
  }
  return error instanceof Error
    ? error.message
    : "We couldn't load this appointment.";
}

function friendlyMediaError(error: unknown) {
  if (
    error instanceof ApiRequestError &&
    error.code === 'APPOINTMENT_NOT_FOUND'
  ) {
    return 'This appointment is no longer available. Refresh My Day and try again.';
  }
  if (
    error instanceof ApiRequestError &&
    error.code === 'MEDIA_ACCESS_DENIED'
  ) {
    return 'You can only view media for appointments assigned to you.';
  }
  return error instanceof Error
    ? error.message
    : "We couldn't load appointment media.";
}

export function AppointmentDetailsScreen({ navigation, route }: Props) {
  const { appointmentId } = route.params;
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const businessTimezone = normaliseBusinessTimezone(user?.business.timezone);
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [unavailableMessage, setUnavailableMessage] = useState<string | null>(
    null,
  );
  const [busyText, setBusyText] = useState<string | null>(null);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isCompletionOpen, setIsCompletionOpen] = useState(false);
  const [technicianNotes, setTechnicianNotes] = useState('');
  const [workCompleted, setWorkCompleted] = useState('');
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [followUpNotes, setFollowUpNotes] = useState('');

  async function loadAppointment() {
    if (!token) return;
    setIsLoading(true);
    setUnavailableMessage(null);
    try {
      const response = await appointmentDetailRequest(token, appointmentId);
      setAppointment(response.appointment);
      setTechnicianNotes(response.appointment.workLog?.technicianNotes ?? '');
      setWorkCompleted(response.appointment.workLog?.workCompleted ?? '');
      setFollowUpRequired(
        response.appointment.workLog?.followUpRequired ?? false,
      );
      setFollowUpNotes(response.appointment.workLog?.followUpNotes ?? '');
      navigation.setOptions({ title: response.appointment.appointmentNumber });
      try {
        const mediaResponse = await mediaRequest(token, {
          appointmentId: response.appointment.id,
        });
        setMedia(mediaResponse.records);
      } catch (mediaError) {
        setMedia([]);
        showToast({
          message: friendlyMediaError(mediaError),
          tone: 'error',
        });
      }
    } catch (error) {
      setAppointment(null);
      setMedia([]);
      const message = friendlyAppointmentError(error);
      setUnavailableMessage(message);
      showToast({ message, tone: 'error' });
    } finally {
      setIsLoading(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      void loadAppointment();
    }, [appointmentId, token]),
  );

  async function transition(action: AppointmentTransitionAction | 'cancel') {
    if (!token || !appointment || busyText) return;
    if (action === 'complete' && !workCompleted.trim()) {
      showToast({
        message: 'Add a short work completed summary before completing.',
        tone: 'error',
      });
      return;
    }
    setBusyText(actionText(action));
    try {
      const response = await transitionAppointmentRequest(
        token,
        appointment.id,
        action,
        action === 'complete'
          ? {
              followUpNotes,
              followUpRequired,
              technicianNotes,
              workCompleted,
            }
          : undefined,
      );
      setAppointment(response.appointment);
      setIsCompletionOpen(false);
      showToast({
        message:
          action === 'complete'
            ? 'Appointment completed.'
            : `${response.appointment.appointmentNumber} updated.`,
        tone: 'success',
      });
    } catch (error) {
      showToast({
        message:
          error instanceof Error
            ? error.message
            : "We couldn't update this appointment.",
        tone: 'error',
      });
    } finally {
      setBusyText(null);
    }
  }

  async function rescheduleByOneHour() {
    if (!token || !appointment || busyText) return;
    const scheduledStart = new Date(appointment.scheduledStart);
    const scheduledEnd = new Date(appointment.scheduledEnd);
    scheduledStart.setHours(scheduledStart.getHours() + 1);
    scheduledEnd.setHours(scheduledEnd.getHours() + 1);

    setBusyText('Rescheduling appointment...');
    try {
      const response = await updateAppointmentRequest(token, appointment.id, {
        allowConflictOverride: user?.role === 'OWNER',
        appointmentType: appointment.appointmentType,
        assignedUserId: appointment.assignedUserId,
        estimatedDurationMinutes: appointment.estimatedDurationMinutes,
        jobId: appointment.jobId,
        notes: appointment.notes ?? undefined,
        accessInstructions: appointment.accessInstructions ?? undefined,
        addressLine1: appointment.addressLine1,
        addressLine2: appointment.addressLine2 ?? undefined,
        customerSiteId: appointment.customerSiteId,
        locationSource: appointment.locationSource,
        postcode: appointment.postcode,
        scheduledEnd: scheduledEnd.toISOString(),
        scheduledStart: scheduledStart.toISOString(),
        state: appointment.state,
        status: appointment.status === 'CONFIRMED' ? 'CONFIRMED' : 'SCHEDULED',
        suburb: appointment.suburb,
        travelDistanceKm: appointment.travelDistanceKm,
        travelDurationMinutes: appointment.travelDurationMinutes,
      });
      setAppointment(response.appointment);
      showToast({
        message: 'Appointment moved forward by 1 hour.',
        tone: 'success',
      });
    } catch (error) {
      showToast({
        message:
          error instanceof Error
            ? error.message
            : "We couldn't reschedule this appointment.",
        tone: 'error',
      });
    } finally {
      setBusyText(null);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.loadingPage}>
        <ActivityIndicator color={colours.primary} />
        <Text style={styles.meta}>Loading appointment...</Text>
      </View>
    );
  }

  if (!appointment) {
    return (
      <View style={styles.loadingPage}>
        <Text style={styles.title}>Appointment unavailable</Text>
        <Text style={styles.meta}>
          {unavailableMessage ??
            'This appointment is no longer available. Refresh My Day and try again.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('MyDay')}
          style={styles.primaryRecoveryButton}
        >
          <Text style={styles.primaryRecoveryText}>Back to My Day</Text>
        </Pressable>
      </View>
    );
  }

  const statusColour = APPOINTMENT_STATUS_COLOURS[appointment.status];
  const customer = appointment.job.customer;
  const address = [
    appointment.addressLine1,
    appointment.addressLine2,
    appointment.suburb,
    appointment.state,
    appointment.postcode,
  ]
    .filter(Boolean)
    .join(', ');
  const quickActions = getAppointmentQuickActions({
    hasAddress: Boolean(address),
    hasPhone: Boolean(customer.phone?.trim()),
    isAssignedUser: appointment.assignedUserId === user?.id,
    role: user?.role,
    status: appointment.status,
  });
  const terminalStatus = ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(
    appointment.status,
  );
  const navigateAction = quickActions.find(
    (action) => action.id === 'navigate',
  );
  const workflowAction = quickActions.find((action) =>
    ['startTravel', 'start', 'arrive', 'complete'].includes(action.id),
  );
  const reassignAction = quickActions.find(
    (action) => action.id === 'reassign',
  );
  const callAction = quickActions.find((action) => action.id === 'call');
  const cancelAction = quickActions.find((action) => action.id === 'cancel');
  const rescheduleAction = quickActions.find(
    (action) => action.id === 'reschedule',
  );
  const canEditAppointment = canCreateAppointment(user?.role);
  const canAddMedia = canAccessStackRoute(user?.role, 'MediaEvidence');
  const primaryActions = [
    navigateAction,
    workflowAction,
    reassignAction
      ? {
          ...reassignAction,
          label: 'Reassign Technician',
        }
      : null,
  ].filter((action): action is AppointmentQuickAction => Boolean(action));
  const secondaryActionCandidates: Array<
    AppointmentDetailsAction | null | undefined
  > = [
    callAction,
    customer.phone && callAction
      ? {
          id: 'sms' as const,
          label: 'SMS Customer',
          onPress: () => {
            void Linking.openURL(`sms:${customer.phone}`);
          },
        }
      : null,
    !terminalStatus && canEditAppointment
      ? {
          id: 'edit' as const,
          label: 'Edit Appointment',
          onPress: () =>
            navigation.navigate('AppointmentForm', {
              customerId: appointment.job.customer.id,
              customerSiteId: appointment.customerSiteId ?? undefined,
              jobId: appointment.jobId,
              selectedDate: appointment.scheduledStart,
              technicianId: appointment.assignedUserId ?? null,
            }),
        }
      : null,
    !terminalStatus
      ? {
          id: 'job' as const,
          label: 'View Job',
          onPress: () =>
            navigation.navigate('JobDetails', { jobId: appointment.jobId }),
        }
      : null,
    cancelAction,
    rescheduleAction,
  ];
  const secondaryActions = secondaryActionCandidates.filter(
    isAppointmentDetailsAction,
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.eyebrow}>{appointment.appointmentNumber}</Text>
      <Text style={styles.title}>{appointment.job.title}</Text>
      <View
        style={[
          styles.statusPill,
          { backgroundColor: statusColour.background },
        ]}
      >
        <Text style={[styles.statusText, { color: statusColour.text }]}>
          {label(appointment.status)}
        </Text>
      </View>

      <View style={styles.quickRow}>
        {terminalStatus ? (
          <QuickAction
            label="View Job"
            onPress={() =>
              navigation.navigate('JobDetails', { jobId: appointment.jobId })
            }
            primary
          />
        ) : null}
        {!terminalStatus
          ? primaryActions.map((action) => (
              <QuickAction
                key={action.id}
                label={action.label}
                onPress={() => void runQuickAction(action)}
                primary={action.id === 'reassign'}
              />
            ))
          : null}
        {secondaryActions.length ? (
          <QuickAction label="More" onPress={() => setIsMoreOpen(true)} />
        ) : null}
      </View>

      <Card title="Customer">
        <Text style={styles.meta}>
          {customer.companyName ?? customer.displayName}
        </Text>
        <Text style={styles.meta}>
          Phone: {customer.phone ?? 'Not recorded'}
        </Text>
      </Card>

      <Card title="Appointment">
        <Text style={styles.meta}>
          Start: {formatDateTime(appointment.scheduledStart, businessTimezone)}
        </Text>
        <Text style={styles.meta}>
          End: {formatDateTime(appointment.scheduledEnd, businessTimezone)}
        </Text>
        <Text style={styles.meta}>
          Duration:{' '}
          {appointment.estimatedDurationMinutes ?? durationMinutes(appointment)}{' '}
          minutes
        </Text>
        <Text style={styles.meta}>
          Technician:{' '}
          {appointment.assignedUser
            ? `${appointment.assignedUser.firstName} ${appointment.assignedUser.lastName}`
            : 'Unassigned'}
        </Text>
      </Card>

      <Card title="Address">
        <Text style={styles.meta}>{address}</Text>
        {appointment.accessInstructions ? (
          <Text style={styles.meta}>
            Access: {appointment.accessInstructions}
          </Text>
        ) : null}
      </Card>

      <Card title="Notes">
        <Text style={styles.meta}>
          {appointment.notes ?? 'No appointment notes recorded.'}
        </Text>
      </Card>

      <Card title="Field notes">
        <Text style={styles.meta}>
          Technician notes:{' '}
          {appointment.workLog?.technicianNotes ?? 'No technician notes yet.'}
        </Text>
        <Text style={styles.meta}>
          Work completed:{' '}
          {appointment.workLog?.workCompleted ?? 'Not recorded yet.'}
        </Text>
        {appointment.workLog?.followUpRequired ? (
          <Text style={styles.meta}>
            Follow-up required: {appointment.workLog.followUpNotes ?? 'Yes'}
          </Text>
        ) : null}
      </Card>

      <Card title="Photos & documents">
        {media.length === 0 ? (
          <Text style={styles.meta}>
            No evidence uploaded for this appointment.
          </Text>
        ) : (
          <>
            <Text style={styles.mediaSummary}>
              {media.filter((item) => item.mediaType === 'IMAGE').length} photos
              · {media.filter((item) => item.mediaType !== 'IMAGE').length}{' '}
              documents
            </Text>
            <View style={styles.mediaGrid}>
              {media.map((item) => (
                <AppointmentMediaTile
                  item={item}
                  key={item.id}
                  onPress={() =>
                    navigation.navigate('MediaViewer', { mediaId: item.id })
                  }
                  timezone={businessTimezone}
                  token={token}
                />
              ))}
            </View>
          </>
        )}
        {canAddMedia ? (
          <QuickAction
            label="Add evidence"
            onPress={() =>
              navigation.navigate('MediaEvidence', {
                appointmentId: appointment.id,
                customerId: appointment.job.customer.id,
                jobId: appointment.jobId,
              })
            }
            primary
          />
        ) : null}
      </Card>
      <BlockingLoader text={busyText} />
      <MoreActionsMenu
        actions={secondaryActions}
        busy={Boolean(busyText)}
        onAction={(action) => {
          setIsMoreOpen(false);
          void runQuickAction(action);
        }}
        onDismiss={() => setIsMoreOpen(false)}
        visible={isMoreOpen}
      />
      <CompletionModal
        appointment={appointment}
        busy={Boolean(busyText)}
        followUpNotes={followUpNotes}
        followUpRequired={followUpRequired}
        onCancel={() => setIsCompletionOpen(false)}
        onConfirm={() => void transition('complete')}
        setFollowUpNotes={setFollowUpNotes}
        setFollowUpRequired={setFollowUpRequired}
        setTechnicianNotes={setTechnicianNotes}
        setWorkCompleted={setWorkCompleted}
        technicianNotes={technicianNotes}
        visible={isCompletionOpen}
        workCompleted={workCompleted}
      />
    </ScrollView>
  );

  async function runQuickAction(action: AppointmentDetailsAction) {
    if (!appointment) return;
    if ('onPress' in action) {
      action.onPress();
      return;
    }
    if (action.id === 'navigate') {
      void Linking.openURL(
        `https://maps.apple.com/?q=${encodeURIComponent(address)}`,
      );
      return;
    }
    if (action.id === 'call' && customer.phone) {
      void Linking.openURL(`tel:${customer.phone}`);
      return;
    }
    if (action.id === 'viewDetails') return;
    if (action.id === 'reschedule') {
      await rescheduleByOneHour();
      return;
    }
    if (action.id === 'reassign') {
      navigation.navigate('AppointmentReassign', {
        appointmentId: appointment.id,
      });
      return;
    }
    if (action.id === 'cancel') await transition('cancel');
    if (action.id === 'startTravel') await transition('start-travel');
    if (action.id === 'start') await transition('start');
    if (action.id === 'arrive') await transition('arrive');
    if (action.id === 'complete') setIsCompletionOpen(true);
  }
}

function actionText(action: AppointmentTransitionAction | 'cancel') {
  if (action === 'start-travel') return 'Starting travel...';
  if (action === 'start') return 'Starting work...';
  if (action === 'arrive') return 'Marking arrival...';
  if (action === 'complete') return 'Completing appointment...';
  return 'Cancelling appointment...';
}

function QuickAction({
  disabled,
  label: text,
  onPress,
  primary,
}: {
  disabled?: boolean;
  label: string;
  onPress(): void;
  primary?: boolean;
}) {
  if (disabled) return null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.quickAction, primary && styles.quickActionPrimary]}
    >
      <Text style={[styles.quickText, primary && styles.quickTextPrimary]}>
        {text}
      </Text>
    </Pressable>
  );
}

function AppointmentMediaTile({
  item,
  onPress,
  timezone,
  token,
}: {
  item: MediaAsset;
  onPress(): void;
  timezone: string;
  token: string | null;
}) {
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(
    item.mediaType === 'IMAGE',
  );

  useEffect(() => {
    let isMounted = true;
    if (
      !token ||
      item.mediaType !== 'IMAGE' ||
      item.uploadStatus !== 'COMPLETED'
    ) {
      setIsPreviewLoading(false);
      return;
    }

    setIsPreviewLoading(true);
    downloadAuthenticatedMediaFile(token, item, 'inline')
      .then((uri) => {
        if (isMounted) setThumbnailUri(uri);
      })
      .catch(() => {
        if (isMounted) setThumbnailUri(null);
      })
      .finally(() => {
        if (isMounted) setIsPreviewLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [item, token]);

  return (
    <Pressable
      accessibilityLabel={`Open ${item.originalFileName}`}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.mediaTile}
    >
      <View style={styles.mediaThumb}>
        {item.mediaType === 'IMAGE' ? (
          isPreviewLoading ? (
            <ActivityIndicator color={colours.primary} />
          ) : thumbnailUri ? (
            <Image
              resizeMode="cover"
              source={{ uri: thumbnailUri }}
              style={styles.mediaThumbImage}
            />
          ) : (
            <Text style={styles.mediaThumbText}>IMG</Text>
          )
        ) : (
          <Text style={styles.mediaThumbText}>
            {item.mediaType === 'PDF' ? 'PDF' : 'DOC'}
          </Text>
        )}
      </View>
      <View style={styles.mediaDetails}>
        <Text numberOfLines={1} style={styles.mediaName}>
          {item.caption ?? item.originalFileName}
        </Text>
        <Text numberOfLines={1} style={styles.mediaMeta}>
          {mediaCategoryLabel(item.category)} · {mediaTypeLabel(item.mediaType)}
        </Text>
        <Text numberOfLines={1} style={styles.mediaMeta}>
          {Math.ceil(item.fileSizeBytes / 1024)} KB ·{' '}
          {formatBusinessDateTime(item.createdAt, timezone)}
        </Text>
        <Text numberOfLines={1} style={styles.mediaMeta}>
          {item.uploadedBy
            ? `${item.uploadedBy.firstName} ${item.uploadedBy.lastName}`
            : 'Unknown uploader'}
        </Text>
      </View>
    </Pressable>
  );
}

function CompletionModal({
  appointment,
  busy,
  followUpNotes,
  followUpRequired,
  onCancel,
  onConfirm,
  setFollowUpNotes,
  setFollowUpRequired,
  setTechnicianNotes,
  setWorkCompleted,
  technicianNotes,
  visible,
  workCompleted,
}: {
  appointment: Appointment;
  busy: boolean;
  followUpNotes: string;
  followUpRequired: boolean;
  onCancel(): void;
  onConfirm(): void;
  setFollowUpNotes(value: string): void;
  setFollowUpRequired(value: boolean): void;
  setTechnicianNotes(value: string): void;
  setWorkCompleted(value: string): void;
  technicianNotes: string;
  visible: boolean;
  workCompleted: string;
}) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onCancel}
      transparent
      visible={visible}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.completionCard}>
          <Text style={styles.moreTitle}>Complete this appointment?</Text>
          <Text style={styles.meta}>
            {appointment.job.customer.companyName ??
              appointment.job.customer.displayName}{' '}
            Â· {appointment.job.title}
          </Text>

          <Text style={styles.inputLabel}>Work completed</Text>
          <TextInput
            multiline
            onChangeText={setWorkCompleted}
            placeholder="Example: Replaced faulty switch and tested circuit."
            style={styles.textArea}
            value={workCompleted}
          />

          <Text style={styles.inputLabel}>Technician notes</Text>
          <TextInput
            multiline
            onChangeText={setTechnicianNotes}
            placeholder="Internal notes for the business."
            style={styles.textArea}
            value={technicianNotes}
          />

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>Follow-up required</Text>
              <Text style={styles.meta}>
                Keep the job open and flag another visit or admin follow-up.
              </Text>
            </View>
            <Switch
              onValueChange={setFollowUpRequired}
              value={followUpRequired}
            />
          </View>

          {followUpRequired ? (
            <TextInput
              multiline
              onChangeText={setFollowUpNotes}
              placeholder="What follow-up is needed?"
              style={styles.textArea}
              value={followUpNotes}
            />
          ) : null}

          <View style={styles.modalActions}>
            <Pressable style={styles.quickAction} onPress={onCancel}>
              <Text style={styles.quickText}>Decide later</Text>
            </Pressable>
            <Pressable
              disabled={busy || !workCompleted.trim()}
              style={[
                styles.quickAction,
                styles.quickActionPrimary,
                (busy || !workCompleted.trim()) && styles.disabledAction,
              ]}
              onPress={onConfirm}
            >
              <Text style={styles.quickTextPrimary}>
                {busy ? 'Completing...' : 'Complete appointment'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function MoreActionsMenu({
  actions,
  busy,
  onAction,
  onDismiss,
  visible,
}: {
  actions: AppointmentDetailsAction[];
  busy: boolean;
  onAction(action: AppointmentDetailsAction): void;
  onDismiss(): void;
  visible: boolean;
}) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onDismiss}
      transparent
      visible={visible}
    >
      <Pressable
        accessibilityLabel="Close appointment actions"
        accessibilityRole="button"
        onPress={onDismiss}
        style={styles.modalBackdrop}
      >
        <Pressable
          accessibilityLabel="Appointment actions"
          onPress={(event) => event.stopPropagation()}
          style={styles.moreCard}
        >
          <Text style={styles.moreTitle}>More actions</Text>
          {actions.map((action) => (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              key={action.id}
              onPress={() => onAction(action)}
              style={[
                styles.moreAction,
                action.id === 'cancel' && styles.moreActionDanger,
                busy && styles.disabledAction,
              ]}
            >
              <Text
                style={[
                  styles.moreActionText,
                  action.id === 'cancel' && styles.moreActionDangerText,
                ]}
              >
                {action.label}
              </Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
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

function BlockingLoader({ text }: { text: string | null }) {
  return (
    <Modal animationType="fade" transparent visible={Boolean(text)}>
      <View style={styles.loaderBackdrop}>
        <View style={styles.loaderCard}>
          <ActivityIndicator color={colours.primary} />
          <Text style={styles.loaderText}>{text}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 16,
    padding: 16,
  },
  cardTitle: { color: colours.ink, fontSize: 18, fontWeight: '900' },
  completionCard: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 24,
    borderWidth: 1,
    maxHeight: '92%',
    maxWidth: 520,
    padding: 18,
    width: '94%',
  },
  container: {
    backgroundColor: colours.background,
    padding: 24,
    paddingBottom: 44,
  },
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
  loaderBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.36)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  loaderCard: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderRadius: 22,
    gap: 12,
    padding: 22,
    width: '86%',
  },
  loaderText: { color: colours.ink, fontWeight: '900', textAlign: 'center' },
  meta: { color: colours.muted, lineHeight: 21, marginTop: 8 },
  mediaDetails: { flex: 1, gap: 3, minWidth: 0 },
  mediaGrid: { gap: 10, marginTop: 12 },
  mediaMeta: { color: colours.muted, fontSize: 12, fontWeight: '700' },
  mediaName: { color: colours.ink, fontWeight: '900' },
  mediaSummary: { color: colours.muted, fontWeight: '800', marginTop: 10 },
  mediaThumb: {
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: 14,
    height: 64,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 64,
  },
  mediaThumbImage: { height: '100%', width: '100%' },
  mediaThumbText: { color: colours.primary, fontWeight: '900' },
  mediaTile: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    minHeight: 92,
    padding: 12,
  },
  disabledAction: { opacity: 0.55 },
  inputLabel: {
    color: colours.ink,
    fontSize: 13,
    fontWeight: '900',
    marginTop: 14,
  },
  modalActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 16,
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.32)',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  moreAction: {
    backgroundColor: '#EEF2FF',
    borderRadius: 14,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  moreActionDanger: { backgroundColor: '#FFE4E6' },
  moreActionDangerText: { color: '#BE123C' },
  moreActionText: { color: colours.primary, fontWeight: '900' },
  moreCard: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 22,
    borderWidth: 1,
    maxWidth: 420,
    padding: 16,
    width: '92%',
  },
  moreTitle: {
    color: colours.ink,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 10,
  },
  primaryRecoveryButton: {
    backgroundColor: colours.primary,
    borderRadius: 999,
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryRecoveryText: { color: '#FFFFFF', fontWeight: '900' },
  quickAction: {
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  quickActionPrimary: { backgroundColor: colours.primary },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  quickText: { color: colours.primary, fontWeight: '900', textAlign: 'center' },
  quickTextPrimary: { color: '#FFFFFF', textAlign: 'center' },
  switchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  textArea: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colours.ink,
    minHeight: 84,
    padding: 12,
    textAlignVertical: 'top',
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusText: { fontWeight: '900' },
  title: { color: colours.ink, fontSize: 32, fontWeight: '900', marginTop: 4 },
});
