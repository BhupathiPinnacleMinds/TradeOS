import type {
  Appointment,
  AppointmentTransitionAction,
} from '@tradieos/shared';
import {
  APPOINTMENT_STATUS_COLOURS,
  formatBusinessDate,
  formatBusinessTime,
  formatBusinessTimeRange,
  getAllowedAppointmentTransitions,
  getBusinessGreeting,
  isExpiredUnstartedAppointment,
  normaliseBusinessTimezone,
} from '@tradieos/shared';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  friendlyAppointmentMutationError,
  myDayRequest,
  transitionAppointmentRequest,
  type ApiRequestError,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';
import {
  primaryCustomerName,
  secondaryCustomerCompany,
} from '../utils/customerDisplay';

type Props = NativeStackScreenProps<RootStackParamList, 'MyDay'>;
type MyDayData = Awaited<ReturnType<typeof myDayRequest>>;
type MyDayCardAction = {
  kind: 'primary' | 'secondary';
  label: string;
  onPress(): void;
};
const CURRENT_STATUSES = ['IN_PROGRESS', 'PAUSED', 'ARRIVED', 'ON_THE_WAY'];

export function MyDayScreen({ navigation }: Props) {
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const [data, setData] = useState<MyDayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAppointmentId, setBusyAppointmentId] = useState<string | null>(
    null,
  );
  const [greetingNow, setGreetingNow] = useState(() => new Date());
  const timezone = normaliseBusinessTimezone(
    data?.businessTimezone ?? user?.business.timezone,
  );
  const greeting = getBusinessGreeting({
    firstName: user?.firstName,
    now: greetingNow,
    timezone,
  });

  const load = useCallback(
    async (showLoader = true) => {
      if (!token) return;
      if (showLoader) setIsLoading(true);
      setError(null);
      try {
        setData(await myDayRequest(token));
      } catch (loadError) {
        setError(friendlyError(loadError));
      } finally {
        setIsLoading(false);
      }
    },
    [token],
  );

  useFocusEffect(
    useCallback(() => {
      setGreetingNow(new Date());
      void load();
    }, [load]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setGreetingNow(new Date());
      }
    });
    return () => subscription.remove();
  }, []);

  async function runTransition(
    appointment: Appointment,
    action: AppointmentTransitionAction,
  ) {
    if (!token || busyAppointmentId) return;
    if (action === 'complete') {
      navigation.navigate('AppointmentDetails', {
        appointmentId: appointment.id,
      });
      return;
    }
    setBusyAppointmentId(appointment.id);
    try {
      await transitionAppointmentRequest(token, appointment.id, action);
      showToast({ message: 'Appointment updated.', tone: 'success' });
      await load(false);
    } catch (transitionError) {
      showToast({ message: friendlyError(transitionError), tone: 'error' });
    } finally {
      setBusyAppointmentId(null);
    }
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={() => void load()}
          />
        }
      >
        <Text style={styles.eyebrow}>
          {formatBusinessDate(data?.businessDate ?? new Date(), timezone)}
        </Text>
        <Text style={styles.title}>{greeting}</Text>
        <Text style={styles.subtitle}>
          {data?.businessName ?? user?.business.name ?? 'Your field day'}
        </Text>

        {isLoading && !data ? (
          <StateCard text="Loading your assigned appointments..." />
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>My Day unavailable</Text>
            <Text style={styles.meta}>{error}</Text>
            <Pressable style={styles.primaryButton} onPress={() => void load()}>
              <Text style={styles.primaryButtonText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {data ? (
          <>
            <View style={styles.summaryGrid}>
              <Summary label="Completed" value={data.completedCount} />
              <Summary label="Remaining" value={data.remainingCount} />
              <Summary label="Urgent" value={data.urgentCount} />
            </View>

            <Section
              title={
                data.nextAppointment &&
                CURRENT_STATUSES.includes(data.nextAppointment.status)
                  ? 'Current appointment'
                  : 'Next appointment'
              }
            >
              <NextAppointment
                appointment={data.nextAppointment}
                busyAppointmentId={busyAppointmentId}
                navigation={navigation}
                onTransition={(appointment, action) =>
                  void runTransition(appointment, action)
                }
                role={user?.role}
                timezone={timezone}
                userId={user?.id}
              />
            </Section>

            <Section title="Later today">
              {data.laterToday.length === 0 ? (
                <Text style={styles.meta}>
                  No other appointments scheduled today.
                </Text>
              ) : (
                data.laterToday.map((appointment) => (
                  <AppointmentCard
                    appointment={appointment}
                    busy={busyAppointmentId === appointment.id}
                    key={appointment.id}
                    onCall={() => callCustomer(appointment)}
                    onNavigate={() => openMaps(appointment)}
                    onOpen={() =>
                      navigation.navigate('AppointmentDetails', {
                        appointmentId: appointment.id,
                      })
                    }
                    onEvidence={() =>
                      navigation.navigate('MediaEvidence', {
                        appointmentId: appointment.id,
                        customerId: appointment.job.customer.id,
                        jobId: appointment.jobId,
                      })
                    }
                    onTransition={(action) =>
                      void runTransition(appointment, action)
                    }
                    role={user?.role}
                    timezone={timezone}
                    userId={user?.id}
                  />
                ))
              )}
            </Section>

            <Section title="Completed today">
              {data.completedToday.length === 0 ? (
                data.remainingCount === 0 ? (
                  <Text style={styles.meta}>
                    All of today's appointments are complete.
                  </Text>
                ) : (
                  <Text style={styles.meta}>
                    No completed appointments yet.
                  </Text>
                )
              ) : (
                data.completedToday.map((appointment) => (
                  <AppointmentCard
                    appointment={appointment}
                    busy={busyAppointmentId === appointment.id}
                    key={appointment.id}
                    onCall={() => callCustomer(appointment)}
                    onNavigate={() => openMaps(appointment)}
                    onOpen={() =>
                      navigation.navigate('AppointmentDetails', {
                        appointmentId: appointment.id,
                      })
                    }
                    onEvidence={() =>
                      navigation.navigate('MediaEvidence', {
                        appointmentId: appointment.id,
                        customerId: appointment.job.customer.id,
                        jobId: appointment.jobId,
                      })
                    }
                    onTransition={(action) =>
                      void runTransition(appointment, action)
                    }
                    role={user?.role}
                    timezone={timezone}
                    userId={user?.id}
                  />
                ))
              )}
            </Section>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function NextAppointment({
  appointment,
  busyAppointmentId,
  navigation,
  onTransition,
  role,
  timezone,
  userId,
}: {
  appointment: Appointment | null;
  busyAppointmentId: string | null;
  navigation: Props['navigation'];
  onTransition(
    appointment: Appointment,
    action: AppointmentTransitionAction,
  ): void;
  role?: Parameters<typeof getAllowedAppointmentTransitions>[0]['userRole'];
  timezone: string;
  userId?: string;
}) {
  if (!appointment) {
    return <Text style={styles.meta}>You're all clear today.</Text>;
  }
  return (
    <AppointmentCard
      appointment={appointment}
      busy={busyAppointmentId === appointment.id}
      onCall={() => callCustomer(appointment)}
      onNavigate={() => openMaps(appointment)}
      onOpen={() =>
        navigation.navigate('AppointmentDetails', {
          appointmentId: appointment.id,
        })
      }
      onEvidence={() =>
        navigation.navigate('MediaEvidence', {
          appointmentId: appointment.id,
          customerId: appointment.job.customer.id,
          jobId: appointment.jobId,
        })
      }
      onTransition={(action) => onTransition(appointment, action)}
      role={role}
      timezone={timezone}
      userId={userId}
    />
  );
}

function AppointmentCard({
  appointment,
  busy,
  onCall,
  onNavigate,
  onEvidence,
  onOpen,
  onTransition,
  role,
  timezone,
  userId,
}: {
  appointment: Appointment;
  busy: boolean;
  onCall(): void;
  onNavigate(): void;
  onEvidence(): void;
  onOpen(): void;
  onTransition(action: AppointmentTransitionAction): void;
  role?: Parameters<typeof getAllowedAppointmentTransitions>[0]['userRole'];
  timezone: string;
  userId?: string;
}) {
  const colour = APPOINTMENT_STATUS_COLOURS[appointment.status];
  const customerCompany = secondaryCustomerCompany(appointment.job.customer);
  const transitions = getAllowedAppointmentTransitions({
    currentStatus: appointment.status,
    isAssignedTechnician: appointment.assignedUserId === userId,
    userRole: role,
  });
  const address = [
    appointment.addressLine1,
    appointment.suburb,
    appointment.state,
    appointment.postcode,
  ]
    .filter(Boolean)
    .join(', ');
  const actions = myDayCardActions({
    appointment,
    busy,
    canNavigate: Boolean(address),
    isExpired: isExpiredUnstartedAppointment({
      scheduledEnd: appointment.scheduledEnd,
      status: appointment.status,
    }),
    onCall,
    onEvidence,
    onNavigate,
    onOpen,
    onTransition,
    transitions,
  });

  return (
    <Pressable style={styles.card} onPress={onOpen}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTime}>
          {formatBusinessTime(appointment.scheduledStart, timezone)}
        </Text>
        <View
          style={[styles.statusPill, { backgroundColor: colour.background }]}
        >
          <Text style={[styles.statusText, { color: colour.text }]}>
            {appointment.status.replaceAll('_', ' ')}
          </Text>
        </View>
      </View>
      <Text style={styles.cardTitle}>{appointment.job.title}</Text>
      <Text style={styles.meta}>
        {primaryCustomerName(appointment.job.customer)}
      </Text>
      {customerCompany ? (
        <Text style={styles.meta}>{customerCompany}</Text>
      ) : null}
      <Text style={styles.meta}>
        {appointment.suburb} · {appointment.job.priority} priority ·{' '}
        {formatBusinessTimeRange(
          appointment.scheduledStart,
          appointment.scheduledEnd,
          timezone,
        )}
      </Text>
      <View style={styles.actionRow}>
        {actions.map((action) =>
          action.kind === 'primary' ? (
            <Pressable
              disabled={busy}
              key={action.label}
              onPress={action.onPress}
              style={[styles.primaryButton, busy && styles.disabledButton]}
            >
              {busy ? <ActivityIndicator color="#FFFFFF" /> : null}
              <Text style={styles.primaryButtonText}>{action.label}</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              key={action.label}
              onPress={action.onPress}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>{action.label}</Text>
            </Pressable>
          ),
        )}
      </View>
    </Pressable>
  );
}

function myDayCardActions({
  appointment,
  busy,
  canNavigate,
  isExpired,
  onCall,
  onEvidence,
  onNavigate,
  onOpen,
  onTransition,
  transitions,
}: {
  appointment: Appointment;
  busy: boolean;
  canNavigate: boolean;
  isExpired: boolean;
  onCall(): void;
  onEvidence(): void;
  onNavigate(): void;
  onOpen(): void;
  onTransition(action: AppointmentTransitionAction): void;
  transitions: ReturnType<typeof getAllowedAppointmentTransitions>;
}): MyDayCardAction[] {
  const transition = (action: AppointmentTransitionAction) =>
    transitions.find((option) => option.action === action);
  const transitionAction = (
    action: AppointmentTransitionAction,
    label: string,
  ) => {
    const option = transition(action);
    return option
      ? {
          kind: 'primary' as const,
          label,
          onPress: () => {
            if (!busy) onTransition(option.action);
          },
        }
      : null;
  };
  const navigateAction = canNavigate
    ? { kind: 'secondary' as const, label: 'Navigate', onPress: onNavigate }
    : null;
  const callAction = appointment.job.customer.phone
    ? { kind: 'secondary' as const, label: 'Call', onPress: onCall }
    : null;
  const evidenceAction = [
    'ARRIVED',
    'IN_PROGRESS',
    'ON_THE_WAY',
    'PAUSED',
  ].includes(appointment.status)
    ? { kind: 'secondary' as const, label: 'Evidence', onPress: onEvidence }
    : null;
  const detailAction = {
    kind: 'secondary' as const,
    label: appointment.status === 'COMPLETED' ? 'View summary' : 'Details',
    onPress: onOpen,
  };

  if (isExpired) {
    const expiredActions: Array<MyDayCardAction | null> = [
      navigateAction,
      detailAction,
    ];
    return expiredActions.filter(isMyDayCardAction).slice(0, 2);
  }

  if (appointment.status === 'SCHEDULED') {
    const scheduledActions: Array<MyDayCardAction | null> = [
      navigateAction,
      detailAction,
    ];
    return scheduledActions.filter(isMyDayCardAction).slice(0, 2);
  }
  if (appointment.status === 'CONFIRMED') {
    return [navigateAction, transitionAction('start-travel', 'Start travel')]
      .filter(isMyDayCardAction)
      .slice(0, 2);
  }
  if (appointment.status === 'ON_THE_WAY') {
    return [transitionAction('arrive', 'Arrived'), evidenceAction]
      .filter(isMyDayCardAction)
      .slice(0, 2);
  }
  if (appointment.status === 'ARRIVED') {
    return [transitionAction('start', 'Start work'), evidenceAction]
      .filter(isMyDayCardAction)
      .slice(0, 2);
  }
  if (appointment.status === 'IN_PROGRESS') {
    const inProgressActions: Array<MyDayCardAction | null> = [
      transitionAction('pause', 'Pause'),
      transitionAction('complete', 'Complete'),
    ];
    return inProgressActions.filter(isMyDayCardAction).slice(0, 2);
  }
  if (appointment.status === 'PAUSED') {
    return [transitionAction('resume', 'Resume'), evidenceAction]
      .filter(isMyDayCardAction)
      .slice(0, 2);
  }
  if (appointment.status === 'COMPLETED') {
    const completedActions: Array<MyDayCardAction | null> = [
      detailAction,
      callAction,
    ];
    return completedActions.filter(isMyDayCardAction).slice(0, 2);
  }
  return [detailAction];
}

function isMyDayCardAction(
  action: MyDayCardAction | null,
): action is MyDayCardAction {
  return Boolean(action);
}

function Section({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function StateCard({ text }: { text: string }) {
  return (
    <View style={styles.card}>
      <ActivityIndicator color={colours.primary} />
      <Text style={styles.meta}>{text}</Text>
    </View>
  );
}

function openMaps(appointment: Appointment) {
  const address = [
    appointment.addressLine1,
    appointment.addressLine2,
    appointment.suburb,
    appointment.state,
    appointment.postcode,
  ]
    .filter(Boolean)
    .join(', ');
  void Linking.openURL(
    `https://maps.apple.com/?q=${encodeURIComponent(address)}`,
  );
}

function callCustomer(appointment: Appointment) {
  const phone = appointment.job.customer.phone;
  if (!phone) return;
  void Linking.openURL(`tel:${phone}`);
}

function friendlyError(error: unknown) {
  const apiError = error as ApiRequestError;
  if (apiError?.code === 'APPOINTMENT_NOT_ASSIGNED_TO_USER') {
    return "That appointment isn't assigned to you.";
  }
  if (apiError?.code === 'INVALID_STATUS_TRANSITION') {
    return "That appointment can't move to that status right now.";
  }
  if (apiError?.code === 'NETWORK_ERROR') {
    return 'Network error. Check the API is running and try again.';
  }
  if (
    apiError?.status === 403 ||
    apiError?.status === 404 ||
    apiError?.status === 400 ||
    apiError?.status === 409
  ) {
    return friendlyAppointmentMutationError(error);
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colours.background, flex: 1 },
  container: { gap: 18, padding: 20 },
  eyebrow: {
    color: colours.primary,
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  title: { color: colours.ink, fontSize: 30, fontWeight: '900' },
  subtitle: { color: colours.muted, fontSize: 16, marginTop: -12 },
  summaryGrid: { flexDirection: 'row', gap: 10 },
  summaryCard: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    padding: 14,
  },
  summaryValue: { color: colours.ink, fontSize: 24, fontWeight: '900' },
  summaryLabel: { color: colours.muted, fontSize: 12, fontWeight: '800' },
  section: { gap: 10 },
  sectionTitle: { color: colours.ink, fontSize: 18, fontWeight: '900' },
  card: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 22,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardTime: { color: colours.primary, fontSize: 18, fontWeight: '900' },
  cardTitle: { color: colours.ink, fontSize: 20, fontWeight: '900' },
  meta: { color: colours.muted, lineHeight: 21 },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  statusText: { fontSize: 11, fontWeight: '900' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colours.primary,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '900' },
  secondaryButton: {
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryButtonText: { color: colours.primary, fontWeight: '900' },
  disabledButton: { opacity: 0.65 },
  errorCard: {
    backgroundColor: '#FFF1F2',
    borderColor: '#FECDD3',
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  errorTitle: { color: '#9F1239', fontSize: 16, fontWeight: '900' },
});
