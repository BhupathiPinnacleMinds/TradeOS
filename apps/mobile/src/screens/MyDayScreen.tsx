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
  normaliseBusinessTimezone,
} from '@tradieos/shared';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type React from 'react';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
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
  myDayRequest,
  transitionAppointmentRequest,
  type ApiRequestError,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'MyDay'>;
type MyDayData = Awaited<ReturnType<typeof myDayRequest>>;

export function MyDayScreen({ navigation }: Props) {
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const [data, setData] = useState<MyDayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAppointmentId, setBusyAppointmentId] = useState<string | null>(
    null,
  );
  const timezone = normaliseBusinessTimezone(
    data?.businessTimezone ?? user?.business.timezone,
  );

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
      void load();
    }, [load]),
  );

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
        <Text style={styles.title}>
          Good morning{user?.firstName ? `, ${user.firstName}` : ''}
        </Text>
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

            <Section title="Next appointment">
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

            <Section title="Today's assigned appointments">
              {data.appointments.length === 0 ? (
                <Text style={styles.meta}>
                  No appointments assigned to you today.
                </Text>
              ) : (
                data.appointments.map((appointment) => (
                  <AppointmentCard
                    appointment={appointment}
                    busy={busyAppointmentId === appointment.id}
                    key={appointment.id}
                    onNavigate={() => openMaps(appointment)}
                    onOpen={() =>
                      navigation.navigate('AppointmentDetails', {
                        appointmentId: appointment.id,
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
    return (
      <Text style={styles.meta}>
        Nothing else assigned today. Nice little pocket of breathing room.
      </Text>
    );
  }
  return (
    <AppointmentCard
      appointment={appointment}
      busy={busyAppointmentId === appointment.id}
      onNavigate={() => openMaps(appointment)}
      onOpen={() =>
        navigation.navigate('AppointmentDetails', {
          appointmentId: appointment.id,
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
  onNavigate,
  onOpen,
  onTransition,
  role,
  timezone,
  userId,
}: {
  appointment: Appointment;
  busy: boolean;
  onNavigate(): void;
  onOpen(): void;
  onTransition(action: AppointmentTransitionAction): void;
  role?: Parameters<typeof getAllowedAppointmentTransitions>[0]['userRole'];
  timezone: string;
  userId?: string;
}) {
  const colour = APPOINTMENT_STATUS_COLOURS[appointment.status];
  const transitions = getAllowedAppointmentTransitions({
    currentStatus: appointment.status,
    isAssignedTechnician: appointment.assignedUserId === userId,
    userRole: role,
  });
  const nextAction = transitions[0];
  const address = [
    appointment.addressLine1,
    appointment.suburb,
    appointment.state,
    appointment.postcode,
  ]
    .filter(Boolean)
    .join(', ');

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
        {appointment.job.customer.companyName ??
          appointment.job.customer.displayName}
      </Text>
      <Text style={styles.meta}>
        {appointment.suburb} · {appointment.job.priority} priority ·{' '}
        {formatBusinessTimeRange(
          appointment.scheduledStart,
          appointment.scheduledEnd,
          timezone,
        )}
      </Text>
      <View style={styles.actionRow}>
        {address ? (
          <Pressable style={styles.secondaryButton} onPress={onNavigate}>
            <Text style={styles.secondaryButtonText}>Navigate</Text>
          </Pressable>
        ) : null}
        {nextAction ? (
          <Pressable
            disabled={busy}
            style={[styles.primaryButton, busy && styles.disabledButton]}
            onPress={() => onTransition(nextAction.action)}
          >
            {busy ? <ActivityIndicator color="#FFFFFF" /> : null}
            <Text style={styles.primaryButtonText}>{nextAction.label}</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.secondaryButton} onPress={onOpen}>
            <Text style={styles.secondaryButtonText}>View details</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
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
