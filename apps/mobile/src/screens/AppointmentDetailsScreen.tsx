import type {
  Appointment,
  AppointmentQuickAction,
  AppointmentTransitionAction,
  MediaAsset,
} from '@tradieos/shared';
import {
  APPOINTMENT_STATUS_COLOURS,
  APPOINTMENT_MORE_ACTIONS_DISMISS_ID,
  APPOINTMENT_SIGNATURE_ACTION_GAP,
  APPOINTMENT_SIGNATURE_PAD_HEIGHT,
  APPOINTMENT_SIGNATURE_SKIP_REASON_BUTTON_GAP,
  APPOINTMENT_SIGNATURE_SKIP_REASON_INPUT_GAP,
  APPOINTMENT_SIGNATURE_SKIP_REASON_TOP_SPACING,
  APPOINTMENT_SIGNATURE_STROKE_COLOUR,
  APPOINTMENT_SIGNATURE_STROKE_WIDTH,
  DEFAULT_BUSINESS_TIMEZONE,
  buildAppointmentSignatureStrokeSegments,
  clearAppointmentSignatureData,
  createUnsavedChangesNavigationGuard,
  formatBusinessDate,
  formatBusinessDateTime,
  formatBusinessTime,
  formatBusinessTimeRange,
  formatMediaSummary,
  getAppointmentQuickActions,
  hasAppointmentSignatureStrokes,
  hasAppointmentValidationErrors,
  isAppointmentFieldNotesDirty,
  isAppointmentCompletionSignatureScrollEnabled,
  mediaCategoryLabel,
  mediaDisplayTitle,
  mediaTypeLabel,
  normaliseAppointmentExecutionDurations,
  normaliseAppointmentFieldNotes,
  normaliseBusinessTimezone,
  roleCanCreateQuotes,
  shouldExecuteAppointmentMoreActionsMenuItem,
  validateAppointmentCompletion,
  validateAppointmentFieldWork,
} from '@tradieos/shared';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { AppointmentFieldValidationErrors } from '@tradieos/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  CommonActions,
  useFocusEffect,
  usePreventRemove,
} from '@react-navigation/native';
import type { NavigationAction } from '@react-navigation/native';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ApiRequestError,
  appointmentDetailRequest,
  archiveMediaRequest,
  captureAppointmentSignatureRequest,
  friendlyAppointmentMutationError,
  mediaRequest,
  restoreMediaRequest,
  skipAppointmentSignatureRequest,
  transitionAppointmentRequest,
  updateAppointmentWorkLogRequest,
  updateAppointmentRequest,
} from '../api/client';
import {
  canArchiveMediaInUi,
  canRestoreMediaInUi,
  friendlyMediaArchiveError,
  mediaRemovedMessage,
  mediaRestoredMessage,
} from '../api/mediaActions';
import { downloadAuthenticatedMediaFile } from '../api/mediaFiles';
import { useAuth } from '../auth/AuthContext';
import {
  MediaOverflowMenu,
  MediaRemovalConfirmation,
} from '../components/MediaOverflowMenu';
import { ScreenBackButton } from '../components/ScreenBackButton';
import { useToast } from '../components/ToastProvider';
import { keyboardAvoidingBehavior } from '../components/keyboardAvoidance';
import type { RootStackParamList } from '../navigation/types';
import {
  canAccessStackRoute,
  canCreateAppointment,
} from '../permissions/roleVisibility';
import { colours } from '../theme';
import { primaryCustomerName } from '../utils/customerDisplay';

const MORE_ACTION_DISMISS_DELAY_MS = 180;
const RESCHEDULE_DURATIONS = [30, 60, 90, 120, 180, 240];
const ACTIVE_NOTE_STATUSES = ['ARRIVED', 'IN_PROGRESS', 'PAUSED'] as const;

type Props = NativeStackScreenProps<RootStackParamList, 'AppointmentDetails'>;
type AppointmentDetailsAction =
  | AppointmentQuickAction
  | {
      id: 'edit' | 'job' | 'quote' | 'sms';
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

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60000);
}

function minutesBetween(start: string | null, end: Date) {
  if (!start) return 0;
  return Math.max(
    0,
    Math.round((end.getTime() - new Date(start).getTime()) / 60000),
  );
}

function executionDurationsForDisplay(appointment: Appointment, now: Date) {
  const baseDurations = normaliseAppointmentExecutionDurations(
    appointment.executionDurations,
  );
  const travelMinutes =
    appointment.status === 'ON_THE_WAY' && appointment.travelStartedAt
      ? minutesBetween(appointment.travelStartedAt, now)
      : (appointment.totalTravelMinutes ?? baseDurations.travelMinutes);
  const workSegmentStart =
    appointment.currentWorkStartedAt ?? appointment.workStartedAt;
  const workMinutes =
    appointment.status === 'IN_PROGRESS' && workSegmentStart
      ? (appointment.totalWorkMinutes ?? baseDurations.workMinutes) +
        minutesBetween(workSegmentStart, now)
      : (appointment.totalWorkMinutes ?? baseDurations.workMinutes);
  const pausedMinutes =
    appointment.status === 'PAUSED' && appointment.pausedAt
      ? (appointment.totalPausedMinutes ?? baseDurations.pausedMinutes) +
        minutesBetween(appointment.pausedAt, now)
      : (appointment.totalPausedMinutes ?? baseDurations.pausedMinutes);
  const elapsedStart = appointment.travelStartedAt ?? appointment.workStartedAt;
  const elapsedEnd = appointment.completedAt
    ? new Date(appointment.completedAt)
    : now;

  return {
    pausedMinutes,
    totalElapsedMinutes: elapsedStart
      ? minutesBetween(elapsedStart, elapsedEnd)
      : baseDurations.totalElapsedMinutes,
    travelMinutes,
    workMinutes,
  };
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours} hr ${remaining} min` : `${hours} hr`;
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

function logAppointmentDetailsNavigation(
  event: string,
  details: Record<string, unknown> = {},
) {
  console.info(`[AppointmentDetails] ${event}`, details);
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
  const [mediaToRemove, setMediaToRemove] = useState<MediaAsset | null>(null);
  const [busyMediaId, setBusyMediaId] = useState<string | null>(null);
  const [showArchivedMedia, setShowArchivedMedia] = useState(false);
  const [isCompletionOpen, setIsCompletionOpen] = useState(false);
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);
  const [rescheduleStart, setRescheduleStart] = useState(() => new Date());
  const [rescheduleDuration, setRescheduleDuration] = useState(120);
  const [showRescheduleDatePicker, setShowRescheduleDatePicker] =
    useState(false);
  const [showRescheduleTimePicker, setShowRescheduleTimePicker] =
    useState(false);
  const [technicianNotes, setTechnicianNotes] = useState('');
  const [workCompleted, setWorkCompleted] = useState('');
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [fieldErrors, setFieldErrors] =
    useState<AppointmentFieldValidationErrors>({});
  const [completionErrors, setCompletionErrors] =
    useState<AppointmentFieldValidationErrors>({});
  const [timerNow, setTimerNow] = useState(() => new Date());
  const pageScrollRef = useRef<ScrollView | null>(null);
  const followUpInputRef = useRef<TextInput | null>(null);
  const savedFieldNotesRef = useRef(normaliseAppointmentFieldNotes(null));
  const moreActionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMoreActionRef = useRef<string | null>(null);
  const selectedMoreActionRef = useRef<string | null>(null);
  const navigationRef = useRef(navigation);
  const mountedRef = useRef(true);
  const workLogDirtyRef = useRef(false);
  const workLogEditableRef = useRef(false);
  const workLogSavingRef = useRef(false);
  const guardRef = useRef(
    createUnsavedChangesNavigationGuard<NavigationAction>({
      dispatch(action) {
        navigationRef.current.dispatch(action);
      },
      getHasSaved() {
        return false;
      },
      getIsDirty() {
        return workLogDirtyRef.current && workLogEditableRef.current;
      },
      getIsMounted() {
        return mountedRef.current;
      },
      getIsSaving() {
        return workLogSavingRef.current;
      },
      onBeforeConfirmation() {
        Keyboard.dismiss();
      },
      onDiscard() {
        workLogDirtyRef.current = false;
      },
      requestConfirmation({ leave, stay }) {
        Alert.alert(
          'Discard unsaved notes?',
          'Your field notes have not been saved yet.',
          [
            { onPress: stay, style: 'cancel', text: 'Keep editing' },
            {
              onPress: leave,
              style: 'destructive',
              text: 'Discard',
            },
          ],
          { onDismiss: stay },
        );
      },
    }),
  );

  useEffect(() => {
    navigationRef.current = navigation;
  }, [navigation]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      logAppointmentDetailsNavigation('APPOINTMENT_DETAILS_UNMOUNTED', {
        appointmentId,
        routeKey: route.key,
      });
      mountedRef.current = false;
      guardRef.current.cleanup();
    };
  }, [appointmentId, route.key]);

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
      savedFieldNotesRef.current = normaliseAppointmentFieldNotes(
        response.appointment.workLog,
      );
      workLogDirtyRef.current = false;
      setFieldErrors({});
      setCompletionErrors({});
      navigation.setOptions({ title: response.appointment.appointmentNumber });
      try {
        const mediaResponse = await mediaRequest(token, {
          archived: showArchivedMedia ? 'true' : undefined,
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
    }, [appointmentId, showArchivedMedia, token]),
  );

  useEffect(() => {
    if (
      !appointment ||
      !['ON_THE_WAY', 'IN_PROGRESS', 'PAUSED'].includes(appointment.status)
    ) {
      return undefined;
    }
    const interval = setInterval(() => setTimerNow(new Date()), 15000);
    return () => clearInterval(interval);
  }, [appointment?.id, appointment?.status]);

  const hasUnsavedWorkLog =
    Boolean(appointment) &&
    isAppointmentFieldNotesDirty(
      {
        followUpNotes,
        followUpRequired,
        technicianNotes,
        workCompleted,
      },
      savedFieldNotesRef.current,
    );
  const canEditCurrentWorkLog = canEditWorkLog(appointment, user);
  const requestMainBack = useCallback(() => {
    const canGoBack = navigation.canGoBack();
    logAppointmentDetailsNavigation('APPOINTMENT_DETAILS_MAIN_PRESS', {
      appointmentId,
      canGoBack,
      dirty: workLogDirtyRef.current,
      editable: workLogEditableRef.current,
      routeKey: route.key,
      routeName: route.name,
    });

    Keyboard.dismiss();

    if (canGoBack) {
      logAppointmentDetailsNavigation(
        'APPOINTMENT_DETAILS_GO_BACK_DISPATCHED',
        {
          appointmentId,
          dirty: workLogDirtyRef.current,
        },
      );
      navigation.goBack();
      return;
    }

    logAppointmentDetailsNavigation('APPOINTMENT_DETAILS_FALLBACK_TO_MAIN', {
      appointmentId,
      dirty: workLogDirtyRef.current,
    });
    const fallbackAction = CommonActions.navigate('Main');
    if (workLogDirtyRef.current && workLogEditableRef.current) {
      guardRef.current.handlePreventedAction(fallbackAction);
      return;
    }
    navigation.dispatch(fallbackAction);
  }, [appointmentId, navigation, route.key, route.name]);

  useEffect(() => {
    navigation.setOptions({
      headerBackVisible: false,
      headerLeft: () => (
        <ScreenBackButton
          accessibilityLabel="Back to Main"
          label="Main"
          onPress={requestMainBack}
        />
      ),
      title: appointment?.appointmentNumber ?? 'Appointment',
    });
  }, [appointment?.appointmentNumber, navigation, requestMainBack]);

  useEffect(() => {
    workLogDirtyRef.current = hasUnsavedWorkLog;
  }, [hasUnsavedWorkLog]);

  useEffect(() => {
    workLogEditableRef.current = canEditCurrentWorkLog;
  }, [canEditCurrentWorkLog]);

  useEffect(() => {
    workLogSavingRef.current = busyText === 'Saving field notes...';
  }, [busyText]);

  usePreventRemove(
    hasUnsavedWorkLog &&
      canEditCurrentWorkLog &&
      busyText !== 'Saving field notes...',
    ({ data }) => {
      guardRef.current.handlePreventedAction(data.action as NavigationAction);
    },
  );

  const focusFieldNoteFollowUp = useCallback(() => {
    pageScrollRef.current?.scrollToEnd({ animated: true });
    setTimeout(() => followUpInputRef.current?.focus(), 120);
  }, []);

  const clearFieldError = useCallback(
    (field: keyof AppointmentFieldValidationErrors) => {
      setFieldErrors((current) => {
        if (!current[field]) return current;
        const next = { ...current };
        delete next[field];
        return next;
      });
      setCompletionErrors((current) => {
        if (!current[field]) return current;
        const next = { ...current };
        delete next[field];
        return next;
      });
    },
    [],
  );

  const updateWorkCompleted = useCallback(
    (value: string) => {
      setWorkCompleted(value);
      if (value.trim()) clearFieldError('workCompleted');
    },
    [clearFieldError],
  );

  const updateFollowUpRequired = useCallback(
    (value: boolean) => {
      setFollowUpRequired(value);
      if (!value) clearFieldError('followUpNotes');
    },
    [clearFieldError],
  );

  const updateFollowUpNotes = useCallback(
    (value: string) => {
      setFollowUpNotes(value);
      if (!followUpRequired || value.trim()) clearFieldError('followUpNotes');
    },
    [clearFieldError, followUpRequired],
  );

  const validateFieldNotesForSave = useCallback(() => {
    const errors = validateAppointmentFieldWork({
      followUpNotes,
      followUpRequired,
    });
    setFieldErrors(errors);
    if (errors.followUpNotes) {
      focusFieldNoteFollowUp();
      return false;
    }
    return true;
  }, [focusFieldNoteFollowUp, followUpNotes, followUpRequired]);

  const validateCompletion = useCallback(() => {
    const errors = validateAppointmentCompletion({
      canSkipSignature: ['OWNER', 'ADMIN'].includes(user?.role ?? ''),
      followUpNotes,
      followUpRequired,
      hasSignature: Boolean(
        appointment?.signature?.capturedAt || appointment?.signature?.skippedAt,
      ),
      workCompleted,
    });
    setCompletionErrors(errors);
    if (errors.followUpNotes) {
      focusFieldNoteFollowUp();
    }
    return !hasAppointmentValidationErrors(errors);
  }, [
    appointment?.signature?.capturedAt,
    appointment?.signature?.skippedAt,
    focusFieldNoteFollowUp,
    followUpNotes,
    followUpRequired,
    user?.role,
    workCompleted,
  ]);

  const dismissMoreActions = useCallback(() => {
    if (moreActionTimerRef.current) {
      clearTimeout(moreActionTimerRef.current);
      moreActionTimerRef.current = null;
    }
    pendingMoreActionRef.current = null;
    selectedMoreActionRef.current = null;
    setIsMoreOpen(false);
  }, []);

  const openMoreActions = useCallback(() => {
    dismissMoreActions();
    setIsMoreOpen(true);
  }, [dismissMoreActions]);

  useFocusEffect(
    useCallback(() => {
      return () => dismissMoreActions();
    }, [dismissMoreActions]),
  );

  async function transition(action: AppointmentTransitionAction | 'cancel') {
    if (!token || !appointment || busyText) return;
    if (action === 'complete' && !validateCompletion()) {
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
      if (action === 'complete') {
        setTechnicianNotes(response.appointment.workLog?.technicianNotes ?? '');
        setWorkCompleted(response.appointment.workLog?.workCompleted ?? '');
        setFollowUpRequired(
          response.appointment.workLog?.followUpRequired ?? false,
        );
        setFollowUpNotes(response.appointment.workLog?.followUpNotes ?? '');
        savedFieldNotesRef.current = normaliseAppointmentFieldNotes(
          response.appointment.workLog,
        );
        workLogDirtyRef.current = false;
        guardRef.current.cleanup();
        setFieldErrors({});
        setCompletionErrors({});
      }
      setAppointment(response.appointment);
      setIsCompletionOpen(false);
      showToast({
        message:
          action === 'confirm'
            ? 'Appointment confirmed.'
            : action === 'complete'
              ? 'Appointment completed.'
              : `${response.appointment.appointmentNumber} updated.`,
        tone: 'success',
      });
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.code === 'WORK_COMPLETED_REQUIRED') {
          setCompletionErrors({
            workCompleted: 'Please enter the work completed.',
          });
        }
        if (error.code === 'FOLLOW_UP_NOTES_REQUIRED') {
          setCompletionErrors({
            followUpNotes: 'Please describe the follow-up required.',
          });
          focusFieldNoteFollowUp();
        }
        if (error.code === 'SIGNATURE_REQUIRED') {
          setCompletionErrors({
            signature:
              'Capture the customer signature or record an authorised skip reason.',
          });
        }
      }
      showToast({
        message: friendlyAppointmentMutationError(error),
        tone: 'error',
      });
    } finally {
      setBusyText(null);
    }
  }

  function openRescheduleModal() {
    if (!appointment || busyText) return;
    setRescheduleStart(new Date(appointment.scheduledStart));
    setRescheduleDuration(
      appointment.estimatedDurationMinutes ?? durationMinutes(appointment),
    );
    setShowRescheduleDatePicker(false);
    setShowRescheduleTimePicker(false);
    setIsRescheduleOpen(true);
  }

  function onRescheduleDateChange(date?: Date) {
    if (!date) return;
    setRescheduleStart((current) => {
      const next = new Date(current);
      next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
      return next;
    });
  }

  function onRescheduleTimeChange(date?: Date) {
    if (!date) return;
    setRescheduleStart((current) => {
      const next = new Date(current);
      next.setHours(date.getHours(), date.getMinutes(), 0, 0);
      return next;
    });
  }

  async function saveReschedule() {
    if (!token || !appointment || busyText) return;
    const scheduledEnd = addMinutes(rescheduleStart, rescheduleDuration);

    setBusyText('Rescheduling appointment...');
    try {
      const response = await updateAppointmentRequest(token, appointment.id, {
        allowConflictOverride: user?.role === 'OWNER',
        appointmentType: appointment.appointmentType,
        assignedUserId: appointment.assignedUserId,
        estimatedDurationMinutes: rescheduleDuration,
        jobId: appointment.jobId,
        notes: appointment.notes ?? undefined,
        accessInstructions: appointment.accessInstructions ?? undefined,
        addressLine1: appointment.addressLine1,
        addressLine2: appointment.addressLine2 ?? undefined,
        customerSiteId: appointment.customerSiteId,
        locationSource: appointment.locationSource,
        postcode: appointment.postcode,
        scheduledEnd: scheduledEnd.toISOString(),
        scheduledStart: rescheduleStart.toISOString(),
        state: appointment.state,
        status: appointment.status === 'CONFIRMED' ? 'CONFIRMED' : 'SCHEDULED',
        suburb: appointment.suburb,
        travelDistanceKm: appointment.travelDistanceKm,
        travelDurationMinutes: appointment.travelDurationMinutes,
      });
      setAppointment(response.appointment);
      setIsRescheduleOpen(false);
      showToast({
        message: 'Appointment rescheduled.',
        tone: 'success',
      });
    } catch (error) {
      showToast({
        message: friendlyAppointmentMutationError(error),
        tone: 'error',
      });
    } finally {
      setBusyText(null);
    }
  }

  async function saveWorkLog() {
    if (!token || !appointment || busyText) return;
    if (!validateFieldNotesForSave()) return;
    setBusyText('Saving field notes...');
    try {
      const response = await updateAppointmentWorkLogRequest(
        token,
        appointment.id,
        {
          followUpNotes,
          followUpRequired,
          technicianNotes,
          workCompleted,
        },
      );
      setTechnicianNotes(response.appointment.workLog?.technicianNotes ?? '');
      setWorkCompleted(response.appointment.workLog?.workCompleted ?? '');
      setFollowUpRequired(
        response.appointment.workLog?.followUpRequired ?? false,
      );
      setFollowUpNotes(response.appointment.workLog?.followUpNotes ?? '');
      savedFieldNotesRef.current = normaliseAppointmentFieldNotes(
        response.appointment.workLog,
      );
      workLogDirtyRef.current = false;
      guardRef.current.cleanup();
      setFieldErrors({});
      setCompletionErrors({});
      setAppointment(response.appointment);
      showToast({ message: 'Field notes saved.', tone: 'success' });
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.code === 'FOLLOW_UP_NOTES_REQUIRED'
      ) {
        setFieldErrors({
          followUpNotes: 'Please describe the follow-up required.',
        });
        focusFieldNoteFollowUp();
      }
      showToast({
        message:
          error instanceof Error
            ? error.message
            : "We couldn't save your field notes.",
        tone: 'error',
      });
    } finally {
      setBusyText(null);
    }
  }

  async function saveSignature(
    input: Parameters<typeof captureAppointmentSignatureRequest>[2],
  ) {
    if (!token || !appointment || busyText) return;
    setBusyText('Saving customer signature...');
    try {
      const response = await captureAppointmentSignatureRequest(
        token,
        appointment.id,
        input,
      );
      clearFieldError('signature');
      setAppointment(response.appointment);
      showToast({ message: 'Customer signature saved.', tone: 'success' });
    } catch (error) {
      showToast({
        message:
          error instanceof Error
            ? error.message
            : "We couldn't save the signature.",
        tone: 'error',
      });
    } finally {
      setBusyText(null);
    }
  }

  async function skipSignature(reason: string) {
    if (!token || !appointment || busyText) return;
    setBusyText('Recording signature skip...');
    try {
      const response = await skipAppointmentSignatureRequest(
        token,
        appointment.id,
        { reason },
      );
      clearFieldError('signature');
      clearFieldError('signatureSkipReason');
      setAppointment(response.appointment);
      showToast({ message: 'Signature skip recorded.', tone: 'success' });
    } catch (error) {
      showToast({
        message:
          error instanceof Error
            ? error.message
            : "We couldn't skip the signature.",
        tone: 'error',
      });
    } finally {
      setBusyText(null);
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
      await loadAppointment();
    } catch (error) {
      setMedia(previousMedia);
      showToast({
        message: friendlyMediaArchiveError(error),
        tone: 'error',
      });
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
      await loadAppointment();
    } catch {
      showToast({
        message: "We couldn't restore this file. Please try again.",
        tone: 'error',
      });
    } finally {
      setBusyMediaId(null);
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
    [
      'confirm',
      'startTravel',
      'start',
      'arrive',
      'pause',
      'resume',
      'complete',
    ].includes(action.id),
  );
  const completeAction = quickActions.find(
    (action) => action.id === 'complete',
  );
  const reassignAction = quickActions.find(
    (action) => action.id === 'reassign',
  );
  const callAction = quickActions.find((action) => action.id === 'call');
  const rescheduleAction = quickActions.find(
    (action) => action.id === 'reschedule',
  );
  const cancelAction = quickActions.find((action) => action.id === 'cancel');
  const canEditAppointment = canCreateAppointment(user?.role);
  const canAddMedia = canAccessStackRoute(user?.role, 'MediaEvidence');
  const canCreateQuote = roleCanCreateQuotes(user?.role ?? 'READ_ONLY');
  const primaryActions = [
    navigateAction,
    workflowAction && workflowAction.id !== 'complete' ? workflowAction : null,
    completeAction,
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
    canCreateQuote
      ? {
          id: 'quote' as const,
          label: 'Create Quote',
          onPress: () =>
            navigation.navigate('QuoteForm', {
              appointmentId: appointment.id,
              customerId: appointment.job.customer.id,
              customerSiteId: appointment.customerSiteId ?? undefined,
              jobId: appointment.jobId,
            }),
        }
      : null,
    rescheduleAction,
    cancelAction
      ? {
          ...cancelAction,
          label: 'Cancel appointment',
        }
      : null,
  ];
  const secondaryActions = secondaryActionCandidates.filter(
    isAppointmentDetailsAction,
  );
  const executionDurations = executionDurationsForDisplay(
    appointment,
    timerNow,
  );
  const workLogEditable = canEditCurrentWorkLog;

  return (
    <ScrollView contentContainerStyle={styles.container} ref={pageScrollRef}>
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
          <QuickAction label="More" onPress={openMoreActions} />
        ) : null}
      </View>

      <Card title="Customer">
        <Text style={styles.meta}>{primaryCustomerName(customer)}</Text>
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

      <Card title="Execution timer">
        <View style={styles.timerGrid}>
          <TimerMetric
            label="Travel"
            value={formatDuration(executionDurations.travelMinutes)}
          />
          <TimerMetric
            label="Work"
            value={formatDuration(executionDurations.workMinutes)}
          />
          <TimerMetric
            label="Paused"
            value={formatDuration(executionDurations.pausedMinutes)}
          />
          <TimerMetric
            label="Elapsed"
            value={formatDuration(executionDurations.totalElapsedMinutes)}
          />
        </View>
        <Text style={styles.meta}>
          Timers use server-recorded transition timestamps and update locally
          while this screen is open.
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
        {workLogEditable ? (
          <>
            <Text style={styles.inputLabel}>Technician notes</Text>
            <TextInput
              multiline
              onChangeText={setTechnicianNotes}
              placeholder="Internal notes for the business."
              placeholderTextColor={colours.muted}
              style={styles.textArea}
              value={technicianNotes}
            />
            <Text style={styles.inputLabel}>Work completed</Text>
            <TextInput
              multiline
              onChangeText={updateWorkCompleted}
              placeholder="Example: Replaced faulty switch and tested circuit."
              placeholderTextColor={colours.muted}
              style={[
                styles.textArea,
                completionErrors.workCompleted && styles.inputError,
              ]}
              value={workCompleted}
            />
            {completionErrors.workCompleted ? (
              <Text accessibilityLiveRegion="polite" style={styles.errorText}>
                {completionErrors.workCompleted}
              </Text>
            ) : null}
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Follow-up required</Text>
                <Text style={styles.meta}>
                  Flag another visit or admin follow-up.
                </Text>
              </View>
              <Switch
                onValueChange={updateFollowUpRequired}
                value={followUpRequired}
              />
            </View>
            {followUpRequired ? (
              <>
                <TextInput
                  ref={followUpInputRef}
                  multiline
                  onChangeText={updateFollowUpNotes}
                  placeholder="What follow-up is needed?"
                  placeholderTextColor={colours.muted}
                  style={[
                    styles.textArea,
                    fieldErrors.followUpNotes && styles.inputError,
                  ]}
                  value={followUpNotes}
                />
                {fieldErrors.followUpNotes ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={styles.errorText}
                  >
                    {fieldErrors.followUpNotes}
                  </Text>
                ) : null}
              </>
            ) : null}
            {hasUnsavedWorkLog ? (
              <Pressable
                accessibilityRole="button"
                disabled={Boolean(busyText)}
                onPress={() => void saveWorkLog()}
                style={[
                  styles.saveFieldNotesButton,
                  Boolean(busyText) && styles.disabledAction,
                ]}
              >
                <Text style={styles.quickTextPrimary}>
                  {busyText === 'Saving field notes...'
                    ? 'Saving...'
                    : 'Save field notes'}
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <>
            <Text style={styles.meta}>
              Technician notes:{' '}
              {appointment.workLog?.technicianNotes ??
                'No technician notes yet.'}
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
          </>
        )}
      </Card>

      <Card title="Photos & documents">
        {['OWNER', 'ADMIN', 'OFFICE_MANAGER'].includes(user?.role ?? '') ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowArchivedMedia((value) => !value)}
            style={styles.archiveFilter}
          >
            <Text style={styles.archiveFilterText}>
              {showArchivedMedia ? 'Showing archived' : 'Showing active'}
            </Text>
          </Pressable>
        ) : null}
        {media.length === 0 ? (
          <Text style={styles.meta}>
            No evidence uploaded for this appointment.
          </Text>
        ) : (
          <>
            <Text style={styles.mediaSummary}>
              {formatMediaSummary({
                documents: media.filter((item) => item.mediaType !== 'IMAGE')
                  .length,
                photos: media.filter((item) => item.mediaType === 'IMAGE')
                  .length,
              })}
            </Text>
            <View style={styles.mediaGrid}>
              {media.map((item) => (
                <AppointmentMediaTile
                  appointmentStatus={appointment.status}
                  item={item}
                  key={item.id}
                  onPress={() =>
                    navigation.navigate('MediaViewer', { mediaId: item.id })
                  }
                  onRemove={() => setMediaToRemove(item)}
                  onRestore={() => void restoreMedia(item)}
                  user={user}
                  busy={busyMediaId === item.id}
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
          selectedMoreActionRef.current = action.id;
          if (!shouldExecuteAppointmentMoreActionsMenuItem(action.id)) {
            dismissMoreActions();
            return;
          }
          dismissMoreActions();
          pendingMoreActionRef.current = action.id;
          moreActionTimerRef.current = setTimeout(() => {
            moreActionTimerRef.current = null;
            pendingMoreActionRef.current = null;
            void runQuickAction(action);
          }, MORE_ACTION_DISMISS_DELAY_MS);
        }}
        onCancel={dismissMoreActions}
        onDismiss={dismissMoreActions}
        visible={isMoreOpen}
      />
      <RescheduleModal
        appointment={appointment}
        busy={Boolean(busyText)}
        duration={rescheduleDuration}
        onCancel={() => {
          setIsRescheduleOpen(false);
          setShowRescheduleDatePicker(false);
          setShowRescheduleTimePicker(false);
        }}
        onChangeDate={onRescheduleDateChange}
        onChangeDuration={setRescheduleDuration}
        onChangeTime={onRescheduleTimeChange}
        onSave={() => void saveReschedule()}
        setShowDatePicker={setShowRescheduleDatePicker}
        setShowTimePicker={setShowRescheduleTimePicker}
        showDatePicker={showRescheduleDatePicker}
        showTimePicker={showRescheduleTimePicker}
        start={rescheduleStart}
        timezone={businessTimezone}
        visible={isRescheduleOpen}
      />
      <CompletionModal
        appointment={appointment}
        busy={Boolean(busyText)}
        errors={completionErrors}
        followUpNotes={followUpNotes}
        followUpRequired={followUpRequired}
        mediaCount={media.length}
        onCancel={() => setIsCompletionOpen(false)}
        onConfirm={() => void transition('complete')}
        onSaveSignature={(input) => void saveSignature(input)}
        onSkipSignature={(reason) => void skipSignature(reason)}
        setFollowUpNotes={updateFollowUpNotes}
        setFollowUpRequired={updateFollowUpRequired}
        setTechnicianNotes={setTechnicianNotes}
        setWorkCompleted={updateWorkCompleted}
        technicianNotes={technicianNotes}
        visible={isCompletionOpen}
        workCompleted={workCompleted}
        canSkipSignature={['OWNER', 'ADMIN'].includes(user?.role ?? '')}
      />
      <MediaRemovalConfirmation
        busy={Boolean(busyMediaId)}
        media={mediaToRemove}
        onCancel={() => setMediaToRemove(null)}
        onConfirm={() => mediaToRemove && void archiveMedia(mediaToRemove)}
        visible={Boolean(mediaToRemove)}
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
      openRescheduleModal();
      return;
    }
    if (action.id === 'reassign') {
      navigation.navigate('AppointmentReassign', {
        appointmentId: appointment.id,
      });
      return;
    }
    if (action.id === 'confirm') {
      confirmAppointment();
      return;
    }
    if (action.id === 'cancel') {
      confirmCancelAppointment();
      return;
    }
    if (action.id === 'startTravel') await transition('start-travel');
    if (action.id === 'start') await transition('start');
    if (action.id === 'arrive') await transition('arrive');
    if (action.id === 'pause') await transition('pause');
    if (action.id === 'resume') await transition('resume');
    if (action.id === 'complete') {
      setCompletionErrors(
        validateAppointmentCompletion({
          canSkipSignature: ['OWNER', 'ADMIN'].includes(user?.role ?? ''),
          followUpNotes,
          followUpRequired,
          hasSignature: Boolean(
            appointment.signature?.capturedAt ||
            appointment.signature?.skippedAt,
          ),
          workCompleted,
        }),
      );
      setIsCompletionOpen(true);
    }
  }

  function confirmAppointment() {
    if (!appointment || busyText) return;
    const technician = appointment.assignedUser
      ? `${appointment.assignedUser.firstName} ${appointment.assignedUser.lastName}`
      : 'Unassigned';
    Alert.alert(
      'Confirm this appointment?',
      [
        `Customer: ${primaryCustomerName(customer)}`,
        `When: ${formatDateTime(appointment.scheduledStart, businessTimezone)}`,
        `Technician: ${technician}`,
      ].join('\n'),
      [
        { style: 'cancel', text: 'Cancel' },
        {
          onPress: () => void transition('confirm'),
          text: 'Confirm',
        },
      ],
    );
  }

  function confirmCancelAppointment() {
    if (!appointment || busyText) return;
    Alert.alert(
      'Cancel appointment?',
      'This appointment will be cancelled and pending customer reminders will be stopped.',
      [
        { style: 'cancel', text: 'Keep appointment' },
        {
          onPress: () => void transition('cancel'),
          style: 'destructive',
          text: 'Cancel appointment',
        },
      ],
    );
  }
}

function actionText(action: AppointmentTransitionAction | 'cancel') {
  if (action === 'confirm') return 'Confirming appointment...';
  if (action === 'start-travel') return 'Starting travel...';
  if (action === 'start') return 'Starting work...';
  if (action === 'arrive') return 'Marking arrival...';
  if (action === 'pause') return 'Pausing work...';
  if (action === 'resume') return 'Resuming work...';
  if (action === 'complete') return 'Completing appointment...';
  return 'Cancelling appointment...';
}

function canEditWorkLog(
  appointment: Appointment | null,
  user: ReturnType<typeof useAuth>['user'],
) {
  if (!appointment || !user) return false;
  if (!ACTIVE_NOTE_STATUSES.includes(appointment.status as never)) return false;
  if (user.role === 'TECHNICIAN') return appointment.assignedUserId === user.id;
  return ['OWNER', 'ADMIN', 'OFFICE_MANAGER', 'SCHEDULER'].includes(user.role);
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
  appointmentStatus,
  busy,
  item,
  onRemove,
  onPress,
  onRestore,
  timezone,
  token,
  user,
}: {
  appointmentStatus: Appointment['status'];
  busy?: boolean;
  item: MediaAsset;
  onRemove(): void;
  onPress(): void;
  onRestore(): void;
  timezone: string;
  token: string | null;
  user: ReturnType<typeof useAuth>['user'];
}) {
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(
    item.mediaType === 'IMAGE',
  );
  const [isMenuOpen, setIsMenuOpen] = useState(false);

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
    <View style={styles.mediaTileShell}>
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
          ) : thumbnailUri ? (
            <Image
              resizeMode="cover"
              source={{ uri: thumbnailUri }}
              style={styles.mediaThumbImage}
            />
          ) : (
            <Text style={styles.mediaThumbText}>
              {item.mediaType === 'PDF' ? 'PDF' : 'DOC'}
            </Text>
          )}
        </View>
        <View style={styles.mediaDetails}>
          <Text numberOfLines={2} style={styles.mediaName}>
            {mediaDisplayTitle(item)}
          </Text>
          <Text numberOfLines={1} style={styles.mediaMeta}>
            {mediaCategoryLabel(item.category)} ·{' '}
            {mediaTypeLabel(item.mediaType)}
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
      <MediaOverflowMenu
        busy={busy}
        canArchive={canArchiveMediaInUi(user, item, { appointmentStatus })}
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
          onPress();
        }}
        open={isMenuOpen}
      />
    </View>
  );
}

function CompletionModal({
  appointment,
  busy,
  canSkipSignature,
  errors,
  followUpNotes,
  followUpRequired,
  mediaCount,
  onCancel,
  onConfirm,
  onSaveSignature,
  onSkipSignature,
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
  canSkipSignature: boolean;
  errors: AppointmentFieldValidationErrors;
  followUpNotes: string;
  followUpRequired: boolean;
  mediaCount: number;
  onCancel(): void;
  onConfirm(): void;
  onSaveSignature(
    input: Parameters<typeof captureAppointmentSignatureRequest>[2],
  ): void;
  onSkipSignature(reason: string): void;
  setFollowUpNotes(value: string): void;
  setFollowUpRequired(value: boolean): void;
  setTechnicianNotes(value: string): void;
  setWorkCompleted(value: string): void;
  technicianNotes: string;
  visible: boolean;
  workCompleted: string;
}) {
  const insets = useSafeAreaInsets();
  const completionScrollRef = useRef<ScrollView | null>(null);
  const [customerName, setCustomerName] = useState(
    appointment.signature?.customerName ??
      appointment.job.customer.displayName ??
      '',
  );
  const [signerTitle, setSignerTitle] = useState(
    appointment.signature?.signerTitle ?? '',
  );
  const [signatureData, setSignatureData] = useState<
    Parameters<typeof captureAppointmentSignatureRequest>[2]['signatureData']
  >({
    height: APPOINTMENT_SIGNATURE_PAD_HEIGHT,
    strokes: [],
    width: 320,
  });
  const [skipReason, setSkipReason] = useState(
    appointment.signature?.skipReason ?? '',
  );
  const [signatureActive, setSignatureActive] = useState(false);
  useEffect(() => {
    setCustomerName(
      appointment.signature?.customerName ??
        appointment.job.customer.displayName ??
        '',
    );
    setSignerTitle(appointment.signature?.signerTitle ?? '');
    setSignatureData({
      height: APPOINTMENT_SIGNATURE_PAD_HEIGHT,
      strokes: [],
      width: 320,
    });
    setSkipReason(appointment.signature?.skipReason ?? '');
    setSignatureActive(false);
  }, [
    appointment.id,
    appointment.job.customer.displayName,
    appointment.signature,
  ]);
  useEffect(() => {
    if (!visible) {
      setSignatureActive(false);
    }
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    if (errors.workCompleted) {
      completionScrollRef.current?.scrollTo({ animated: true, y: 80 });
      return;
    }
    if (errors.followUpNotes) {
      completionScrollRef.current?.scrollTo({ animated: true, y: 260 });
      return;
    }
    if (errors.signature) {
      completionScrollRef.current?.scrollToEnd({ animated: true });
    }
  }, [errors.followUpNotes, errors.signature, errors.workCompleted, visible]);

  const hasPendingSignature = hasAppointmentSignatureStrokes(signatureData);
  const checklist = [
    {
      label: 'Work completed summary entered',
      state: workCompleted.trim() ? 'Complete' : 'Missing',
    },
    {
      label: 'Required photos checked',
      state: mediaCount > 0 ? 'Complete' : 'Optional warning',
    },
    {
      label: 'Customer signature captured',
      state: appointment.signature?.capturedAt
        ? 'Complete'
        : appointment.signature?.skippedAt
          ? 'Skipped with reason'
          : 'Missing',
    },
    { label: 'Materials used reviewed', state: 'Optional' },
  ];
  const canComplete = !busy;
  const executionDurations = normaliseAppointmentExecutionDurations(
    appointment.executionDurations,
  );
  const clearSignature = useCallback(() => {
    setSignatureActive(false);
    setSignatureData(clearAppointmentSignatureData);
  }, []);
  const cancelCompletion = useCallback(() => {
    setSignatureActive(false);
    onCancel();
  }, [onCancel]);

  return (
    <Modal
      animationType="slide"
      onRequestClose={cancelCompletion}
      transparent
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={keyboardAvoidingBehavior}
        style={styles.completionKeyboardAvoider}
      >
        <View
          style={[
            styles.completionBackdrop,
            {
              paddingBottom: Math.max(insets.bottom + 12, 20),
              paddingTop: Math.max(insets.top + 12, 20),
            },
          ]}
        >
          <View style={styles.completionCard}>
            <View style={styles.completionHeader}>
              <Text style={styles.moreTitle}>Complete this appointment?</Text>
              <Text style={styles.meta}>
                {primaryCustomerName(appointment.job.customer)} ·{' '}
                {appointment.job.title}
              </Text>
            </View>

            <ScrollView
              contentContainerStyle={styles.completionScrollContent}
              keyboardShouldPersistTaps="handled"
              ref={completionScrollRef}
              scrollEnabled={isAppointmentCompletionSignatureScrollEnabled(
                signatureActive,
              )}
              showsVerticalScrollIndicator
              style={styles.completionScroll}
            >
              <View style={styles.checklistCard}>
                {checklist.map((item) => (
                  <View key={item.label} style={styles.checklistRow}>
                    <Text style={styles.checklistLabel}>{item.label}</Text>
                    <Text
                      style={[
                        styles.checklistState,
                        item.state === 'Missing' && styles.checklistMissing,
                      ]}
                    >
                      {item.state}
                    </Text>
                  </View>
                ))}
              </View>

              <Text style={styles.inputLabel}>Work completed</Text>
              <TextInput
                multiline
                onChangeText={setWorkCompleted}
                placeholder="Example: Replaced faulty switch and tested circuit."
                style={[
                  styles.textArea,
                  errors.workCompleted && styles.inputError,
                ]}
                value={workCompleted}
              />
              {errors.workCompleted ? (
                <Text accessibilityLiveRegion="polite" style={styles.errorText}>
                  {errors.workCompleted}
                </Text>
              ) : null}

              <Text style={styles.inputLabel}>Technician notes</Text>
              <TextInput
                multiline
                onChangeText={setTechnicianNotes}
                placeholder="Internal notes for the business."
                style={styles.textArea}
                value={technicianNotes}
              />

              <View style={styles.switchRow}>
                <View style={styles.switchCopy}>
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
                <>
                  <TextInput
                    multiline
                    onChangeText={setFollowUpNotes}
                    placeholder="What follow-up is needed?"
                    style={[
                      styles.textArea,
                      errors.followUpNotes && styles.inputError,
                    ]}
                    value={followUpNotes}
                  />
                  {errors.followUpNotes ? (
                    <Text
                      accessibilityLiveRegion="polite"
                      style={styles.errorText}
                    >
                      {errors.followUpNotes}
                    </Text>
                  ) : null}
                </>
              ) : null}

              <View style={styles.signatureSection}>
                <Text style={styles.inputLabel}>Customer signature</Text>
                {appointment.signature?.capturedAt ? (
                  <SignatureSummary
                    title="Signature captured"
                    subtitle={`${appointment.signature.customerName ?? 'Customer'} · ${formatDateTime(
                      appointment.signature.capturedAt,
                    )}`}
                  />
                ) : appointment.signature?.skippedAt ? (
                  <SignatureSummary
                    title="Signature skipped"
                    subtitle={
                      appointment.signature.skipReason ?? 'Reason recorded'
                    }
                  />
                ) : (
                  <>
                    <TextInput
                      onChangeText={setCustomerName}
                      placeholder="Customer name"
                      placeholderTextColor={colours.muted}
                      style={styles.textInput}
                      value={customerName}
                    />
                    <TextInput
                      onChangeText={setSignerTitle}
                      placeholder="Relationship/title (optional)"
                      placeholderTextColor={colours.muted}
                      style={styles.textInput}
                      value={signerTitle}
                    />
                    <Text style={styles.consentText}>
                      I confirm the work described above has been completed.
                    </Text>
                    <SignaturePad
                      disabled={busy}
                      onBeginSignature={() => setSignatureActive(true)}
                      onChange={setSignatureData}
                      onEndSignature={() => setSignatureActive(false)}
                      signatureData={signatureData}
                    />
                    <View style={styles.signatureActions}>
                      <Pressable
                        accessibilityRole="button"
                        disabled={busy || !hasPendingSignature}
                        onPress={clearSignature}
                        style={[
                          styles.quickAction,
                          styles.signatureActionButton,
                          (busy || !hasPendingSignature) &&
                            styles.disabledAction,
                        ]}
                      >
                        <Text style={styles.quickText}>Clear signature</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={
                          busy || !hasPendingSignature || !customerName.trim()
                        }
                        onPress={() =>
                          onSaveSignature({
                            consentText:
                              'I confirm the work described above has been completed.',
                            customerName,
                            signatureData,
                            signerTitle,
                          })
                        }
                        style={[
                          styles.quickAction,
                          styles.quickActionPrimary,
                          styles.signatureActionButton,
                          (busy ||
                            !hasPendingSignature ||
                            !customerName.trim()) &&
                            styles.disabledAction,
                        ]}
                      >
                        <Text style={styles.quickTextPrimary}>
                          Save signature
                        </Text>
                      </Pressable>
                    </View>
                    {errors.signature ? (
                      <Text
                        accessibilityLiveRegion="polite"
                        style={styles.errorText}
                      >
                        {errors.signature}
                      </Text>
                    ) : null}
                    {canSkipSignature ? (
                      <View style={styles.skipSignatureSection}>
                        <Text
                          style={[styles.inputLabel, styles.skipReasonLabel]}
                        >
                          Skip reason
                        </Text>
                        <TextInput
                          multiline
                          onChangeText={setSkipReason}
                          placeholder="Why is the customer signature unavailable?"
                          placeholderTextColor={colours.muted}
                          style={[styles.textArea, styles.skipReasonInput]}
                          value={skipReason}
                        />
                        <Pressable
                          accessibilityRole="button"
                          disabled={busy || !skipReason.trim()}
                          onPress={() => onSkipSignature(skipReason)}
                          style={[
                            styles.quickAction,
                            styles.skipSignatureButton,
                            busy || !skipReason.trim()
                              ? styles.disabledAction
                              : undefined,
                          ]}
                        >
                          <Text style={styles.quickText}>
                            Skip signature with reason
                          </Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </>
                )}
              </View>

              <Card title="Completion review">
                <Text style={styles.meta}>Job: {appointment.job.title}</Text>
                <Text style={styles.meta}>
                  Customer: {primaryCustomerName(appointment.job.customer)}
                </Text>
                <Text style={styles.meta}>
                  Media: {mediaCount} {mediaCount === 1 ? 'file' : 'files'}
                </Text>
                <Text style={styles.meta}>
                  Travel: {formatDuration(executionDurations.travelMinutes)} ·
                  Work: {formatDuration(executionDurations.workMinutes)} ·
                  Paused: {formatDuration(executionDurations.pausedMinutes)}
                </Text>
              </Card>
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable
                style={[styles.quickAction, styles.modalActionButton]}
                onPress={cancelCompletion}
              >
                <Text style={styles.quickText}>Decide later</Text>
              </Pressable>
              <Pressable
                disabled={!canComplete}
                style={[
                  styles.quickAction,
                  styles.modalActionButton,
                  styles.quickActionPrimary,
                  !canComplete && styles.disabledAction,
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
      </KeyboardAvoidingView>
    </Modal>
  );
}

function MoreActionsMenu({
  actions,
  busy,
  onAction,
  onCancel,
  onDismiss,
  visible,
}: {
  actions: AppointmentDetailsAction[];
  busy: boolean;
  onAction(action: AppointmentDetailsAction): void;
  onCancel(): void;
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
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            key={APPOINTMENT_MORE_ACTIONS_DISMISS_ID}
            onPress={(event) => {
              event.stopPropagation();
              onCancel();
            }}
            style={[styles.moreAction, busy && styles.disabledAction]}
          >
            <Text style={styles.moreActionText}>Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function RescheduleModal({
  appointment,
  busy,
  duration,
  onCancel,
  onChangeDate,
  onChangeDuration,
  onChangeTime,
  onSave,
  setShowDatePicker,
  setShowTimePicker,
  showDatePicker,
  showTimePicker,
  start,
  timezone,
  visible,
}: {
  appointment: Appointment;
  busy: boolean;
  duration: number;
  onCancel(): void;
  onChangeDate(value?: Date): void;
  onChangeDuration(value: number): void;
  onChangeTime(value?: Date): void;
  onSave(): void;
  setShowDatePicker(value: boolean): void;
  setShowTimePicker(value: boolean): void;
  showDatePicker: boolean;
  showTimePicker: boolean;
  start: Date;
  timezone: string;
  visible: boolean;
}) {
  const end = addMinutes(start, duration);
  const technician = appointment.assignedUser
    ? `${appointment.assignedUser.firstName} ${appointment.assignedUser.lastName}`
    : 'Unassigned';

  return (
    <Modal
      animationType="slide"
      onRequestClose={onCancel}
      transparent
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={keyboardAvoidingBehavior}
        style={styles.modalKeyboardAvoider}
      >
        <Pressable
          accessibilityLabel="Close reschedule appointment"
          accessibilityRole="button"
          onPress={onCancel}
          style={styles.modalBackdrop}
        >
          <Pressable
            accessibilityLabel="Reschedule appointment"
            onPress={(event) => event.stopPropagation()}
            style={styles.rescheduleCard}
          >
            <ScrollView
              contentContainerStyle={styles.rescheduleContent}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.modalTitle}>Reschedule appointment</Text>
              <Text style={styles.meta}>
                Current:{' '}
                {formatBusinessDateTime(appointment.scheduledStart, timezone)} ·{' '}
                {formatBusinessTime(appointment.scheduledEnd, timezone)}
              </Text>
              <Text style={styles.meta}>Technician: {technician}</Text>

              <RescheduleDateTimeButton
                label="New date"
                mode="date"
                onChange={onChangeDate}
                setVisible={setShowDatePicker}
                timezone={timezone}
                value={start}
                visible={showDatePicker}
              />
              <RescheduleDateTimeButton
                label="New start time"
                mode="time"
                onChange={onChangeTime}
                setVisible={setShowTimePicker}
                timezone={timezone}
                value={start}
                visible={showTimePicker}
              />

              <Text style={styles.inputLabel}>Duration</Text>
              <View style={styles.rescheduleDurationRow}>
                {RESCHEDULE_DURATIONS.map((option) => (
                  <Pressable
                    accessibilityRole="button"
                    key={option}
                    onPress={() => onChangeDuration(option)}
                    style={[
                      styles.rescheduleDurationChip,
                      duration === option &&
                        styles.rescheduleDurationChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.rescheduleDurationText,
                        duration === option &&
                          styles.rescheduleDurationTextActive,
                      ]}
                    >
                      {option} min
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.rescheduleSummary}>
                <Text style={styles.inputLabel}>New appointment time</Text>
                <Text style={styles.modalBodyStrong}>
                  {formatBusinessDate(start, timezone)}
                </Text>
                <Text style={styles.meta}>
                  {formatBusinessTimeRange(start, end, timezone)}
                </Text>
              </View>
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={onCancel}
                style={[styles.quickAction, busy && styles.disabledAction]}
              >
                <Text style={styles.quickText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={onSave}
                style={[
                  styles.quickAction,
                  styles.quickActionPrimary,
                  busy && styles.disabledAction,
                ]}
              >
                <Text style={styles.quickTextPrimary}>
                  {busy ? 'Saving...' : 'Save reschedule'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function RescheduleDateTimeButton({
  label: text,
  mode,
  onChange,
  setVisible,
  timezone,
  value,
  visible,
}: {
  label: string;
  mode: 'date' | 'time';
  onChange(value?: Date): void;
  setVisible(value: boolean): void;
  timezone: string;
  value: Date;
  visible: boolean;
}) {
  return (
    <View style={styles.rescheduleField}>
      <Text style={styles.inputLabel}>{text}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => setVisible(true)}
        style={styles.rescheduleInputButton}
      >
        <Text style={styles.rescheduleInputText}>
          {mode === 'date'
            ? formatBusinessDate(value, timezone)
            : formatBusinessTime(value, timezone)}
        </Text>
      </Pressable>
      {visible ? (
        <DateTimePicker
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          mode={mode}
          onChange={(_, selectedDate) => {
            if (Platform.OS !== 'ios') setVisible(false);
            onChange(selectedDate);
          }}
          value={value}
        />
      ) : null}
      {visible && Platform.OS === 'ios' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setVisible(false)}
          style={styles.rescheduleDoneButton}
        >
          <Text style={styles.rescheduleDoneText}>Done</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function SignatureSummary({
  subtitle,
  title,
}: {
  subtitle: string;
  title: string;
}) {
  return (
    <View style={styles.signatureSummary}>
      <Text style={styles.signatureSummaryTitle}>{title}</Text>
      <Text style={styles.meta}>{subtitle}</Text>
    </View>
  );
}

function TimerMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.timerMetric}>
      <Text style={styles.timerMetricLabel}>{label}</Text>
      <Text style={styles.timerMetricValue}>{value}</Text>
    </View>
  );
}

function SignaturePad({
  disabled,
  onBeginSignature,
  onChange,
  onEndSignature,
  signatureData,
}: {
  disabled: boolean;
  onBeginSignature(): void;
  onChange(
    value: Parameters<
      typeof captureAppointmentSignatureRequest
    >[2]['signatureData'],
  ): void;
  onEndSignature(): void;
  signatureData: Parameters<
    typeof captureAppointmentSignatureRequest
  >[2]['signatureData'];
}) {
  const [layout, setLayout] = useState({
    height: signatureData.height,
    width: signatureData.width,
  });
  const strokesRef = useRef(signatureData.strokes);
  const layoutRef = useRef(layout);
  const disabledRef = useRef(disabled);
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: () => !disabledRef.current,
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onPanResponderGrant: (event) => {
        onBeginSignature();
        const point = {
          x: Math.max(0, event.nativeEvent.locationX),
          y: Math.max(0, event.nativeEvent.locationY),
        };
        strokesRef.current = [...strokesRef.current, [point]];
        onChange({ ...layoutRef.current, strokes: strokesRef.current });
      },
      onPanResponderMove: (event) => {
        const currentStroke =
          strokesRef.current[strokesRef.current.length - 1] ?? [];
        const nextStroke = [
          ...currentStroke,
          {
            x: Math.max(0, event.nativeEvent.locationX),
            y: Math.max(0, event.nativeEvent.locationY),
          },
        ];
        strokesRef.current = [...strokesRef.current.slice(0, -1), nextStroke];
        onChange({ ...layoutRef.current, strokes: strokesRef.current });
      },
      onPanResponderRelease: () => {
        onEndSignature();
      },
      onPanResponderTerminate: () => {
        onEndSignature();
      },
      onShouldBlockNativeResponder: () => true,
    }),
  ).current;

  useEffect(() => {
    strokesRef.current = signatureData.strokes;
  }, [signatureData.strokes]);

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  const signatureSegments =
    buildAppointmentSignatureStrokeSegments(signatureData);

  return (
    <View style={styles.signaturePadBlock}>
      <View style={styles.signaturePadContainer}>
        <View
          accessibilityLabel="Customer signature pad"
          accessibilityRole="adjustable"
          onLayout={(event) => {
            const nextLayout = {
              height: Math.round(event.nativeEvent.layout.height),
              width: Math.round(event.nativeEvent.layout.width),
            };
            setLayout(nextLayout);
            onChange({ ...nextLayout, strokes: signatureData.strokes });
          }}
          style={styles.signaturePad}
          {...panResponder.panHandlers}
        >
          {signatureSegments.map((segment) => (
            <View
              key={`${segment.strokeIndex}-${segment.segmentIndex}`}
              style={[
                styles.signatureStrokeSegment,
                {
                  left: segment.x,
                  top: segment.y,
                  transform: [{ rotateZ: `${segment.angleDegrees}deg` }],
                  width: Math.max(
                    segment.length,
                    APPOINTMENT_SIGNATURE_STROKE_WIDTH,
                  ),
                },
              ]}
            />
          ))}
          {signatureData.strokes.map((stroke, strokeIndex) => {
            const point = stroke[0];
            return stroke.length === 1 && point ? (
              <View
                key={`${strokeIndex}-single-point`}
                style={[
                  styles.signatureSinglePoint,
                  {
                    left: point.x - APPOINTMENT_SIGNATURE_STROKE_WIDTH / 2,
                    top: point.y - APPOINTMENT_SIGNATURE_STROKE_WIDTH / 2,
                  },
                ]}
              />
            ) : null;
          })}
          {signatureData.strokes.length === 0 ? (
            <Text style={styles.signatureHint}>Customer signs here</Text>
          ) : null}
        </View>
      </View>
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
  archiveFilter: {
    alignSelf: 'flex-start',
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  archiveFilterText: { color: colours.primary, fontWeight: '900' },
  card: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 16,
    padding: 16,
  },
  cardTitle: { color: colours.ink, fontSize: 18, fontWeight: '900' },
  checklistCard: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    marginTop: 14,
    padding: 12,
  },
  checklistLabel: { color: colours.ink, flex: 1, fontWeight: '800' },
  checklistMissing: { color: '#BE123C' },
  checklistRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  checklistState: { color: colours.primary, fontSize: 12, fontWeight: '900' },
  completionBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.32)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  completionCard: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 24,
    borderWidth: 1,
    maxHeight: '100%',
    maxWidth: 520,
    overflow: 'hidden',
    width: '94%',
  },
  completionHeader: {
    borderBottomColor: colours.border,
    borderBottomWidth: 1,
    paddingBottom: 12,
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  completionKeyboardAvoider: { flex: 1 },
  completionScroll: { alignSelf: 'stretch' },
  completionScrollContent: {
    paddingBottom: 18,
    paddingHorizontal: 18,
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
  errorText: {
    color: '#BE123C',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
    marginTop: 6,
  },
  inputError: {
    borderColor: '#BE123C',
    borderWidth: 1.5,
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
  mediaTileShell: { position: 'relative' },
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
    paddingRight: 60,
  },
  disabledAction: { opacity: 0.55 },
  inputLabel: {
    color: colours.ink,
    fontSize: 13,
    fontWeight: '900',
    marginTop: 14,
  },
  consentText: {
    color: colours.muted,
    fontStyle: 'italic',
    lineHeight: 20,
    marginTop: 10,
  },
  modalActions: {
    borderTopColor: colours.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    padding: 18,
    paddingTop: 12,
  },
  modalActionButton: { flex: 1 },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.32)',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  modalBodyStrong: {
    color: colours.ink,
    fontSize: 18,
    fontWeight: '900',
    marginTop: 6,
  },
  modalKeyboardAvoider: { flex: 1 },
  modalTitle: { color: colours.ink, fontSize: 22, fontWeight: '900' },
  moreAction: {
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: 14,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  moreActionDanger: { backgroundColor: '#FFE4E6' },
  moreActionDangerText: { color: '#BE123C' },
  moreActionText: {
    color: colours.primary,
    fontWeight: '900',
    textAlign: 'center',
  },
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
  rescheduleCard: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 22,
    borderWidth: 1,
    maxHeight: '90%',
    maxWidth: 520,
    overflow: 'hidden',
    width: '94%',
  },
  rescheduleContent: { padding: 18, paddingBottom: 8 },
  rescheduleDoneButton: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rescheduleDoneText: { color: colours.primary, fontWeight: '900' },
  rescheduleDurationChip: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rescheduleDurationChipActive: {
    backgroundColor: colours.primary,
    borderColor: colours.primary,
  },
  rescheduleDurationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  rescheduleDurationText: { color: colours.primary, fontWeight: '900' },
  rescheduleDurationTextActive: { color: '#FFFFFF' },
  rescheduleField: { marginTop: 14 },
  rescheduleInputButton: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 8,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  rescheduleInputText: { color: colours.ink, fontWeight: '900' },
  rescheduleSummary: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 16,
    padding: 14,
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
  saveFieldNotesButton: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: colours.primary,
    borderRadius: 999,
    justifyContent: 'center',
    marginBottom: 4,
    marginTop: 16,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  switchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  switchCopy: { flex: 1 },
  signatureActionButton: { flex: 1 },
  signatureActions: {
    flexDirection: 'row',
    gap: APPOINTMENT_SIGNATURE_ACTION_GAP,
    marginBottom: 8,
    marginTop: 14,
  },
  signatureHint: {
    color: colours.muted,
    fontWeight: '800',
    left: 18,
    position: 'absolute',
    top: 18,
  },
  signaturePad: {
    backgroundColor: '#FFFFFF',
    borderColor: colours.border,
    borderRadius: 16,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexGrow: 0,
    flexShrink: 0,
    height: APPOINTMENT_SIGNATURE_PAD_HEIGHT,
    minHeight: APPOINTMENT_SIGNATURE_PAD_HEIGHT,
    overflow: 'hidden',
  },
  signaturePadBlock: {
    flexShrink: 0,
    marginTop: 10,
  },
  signaturePadContainer: {
    flexGrow: 0,
    flexShrink: 0,
    height: APPOINTMENT_SIGNATURE_PAD_HEIGHT,
    minHeight: APPOINTMENT_SIGNATURE_PAD_HEIGHT,
  },
  signatureSinglePoint: {
    backgroundColor: APPOINTMENT_SIGNATURE_STROKE_COLOUR,
    borderRadius: APPOINTMENT_SIGNATURE_STROKE_WIDTH / 2,
    height: APPOINTMENT_SIGNATURE_STROKE_WIDTH,
    position: 'absolute',
    width: APPOINTMENT_SIGNATURE_STROKE_WIDTH,
  },
  signatureStrokeSegment: {
    backgroundColor: APPOINTMENT_SIGNATURE_STROKE_COLOUR,
    borderRadius: APPOINTMENT_SIGNATURE_STROKE_WIDTH / 2,
    height: APPOINTMENT_SIGNATURE_STROKE_WIDTH,
    position: 'absolute',
  },
  signatureSummary: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 10,
    padding: 12,
  },
  signatureSummaryTitle: {
    color: '#047857',
    fontSize: 15,
    fontWeight: '900',
  },
  signatureSection: {
    flexShrink: 0,
    marginTop: 4,
  },
  skipReasonInput: {
    marginTop: APPOINTMENT_SIGNATURE_SKIP_REASON_INPUT_GAP,
  },
  skipReasonLabel: {
    marginTop: 0,
  },
  skipSignatureButton: {
    marginTop: APPOINTMENT_SIGNATURE_SKIP_REASON_BUTTON_GAP,
  },
  skipSignatureSection: {
    marginTop: APPOINTMENT_SIGNATURE_SKIP_REASON_TOP_SPACING,
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
  textInput: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colours.ink,
    marginTop: 10,
    minHeight: 48,
    padding: 12,
  },
  timerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  timerMetric: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: '45%',
    padding: 12,
  },
  timerMetricLabel: { color: colours.muted, fontSize: 12, fontWeight: '800' },
  timerMetricValue: { color: colours.ink, fontSize: 20, fontWeight: '900' },
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
