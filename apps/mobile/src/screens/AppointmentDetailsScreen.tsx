import type { Appointment, AppointmentQuickAction } from '@tradieos/shared';
import {
  APPOINTMENT_STATUS_COLOURS,
  getAppointmentQuickActions,
} from '@tradieos/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import type React from 'react';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  appointmentDetailRequest,
  transitionAppointmentRequest,
  updateAppointmentRequest,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'AppointmentDetails'>;

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

export function AppointmentDetailsScreen({ navigation, route }: Props) {
  const { appointmentId } = route.params;
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyText, setBusyText] = useState<string | null>(null);

  async function loadAppointment() {
    if (!token) return;
    setIsLoading(true);
    try {
      const response = await appointmentDetailRequest(token, appointmentId);
      setAppointment(response.appointment);
      navigation.setOptions({ title: response.appointment.appointmentNumber });
    } catch (error) {
      showToast({
        message:
          error instanceof Error
            ? error.message
            : "We couldn't load this appointment.",
        tone: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      void loadAppointment();
    }, [appointmentId, token]),
  );

  async function transition(
    action: 'start' | 'arrive' | 'complete' | 'cancel',
  ) {
    if (!token || !appointment || busyText) return;
    setBusyText(actionText(action));
    try {
      const response = await transitionAppointmentRequest(
        token,
        appointment.id,
        action,
      );
      setAppointment(response.appointment);
      showToast({
        message: `${response.appointment.appointmentNumber} updated.`,
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
        <Text style={styles.title}>Appointment not found</Text>
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
  const canReassign = [
    'OWNER',
    'ADMIN',
    'OFFICE_MANAGER',
    'SCHEDULER',
  ].includes(user?.role ?? '');

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
        {canReassign ? (
          <QuickAction
            label="Reassign Technician"
            onPress={() =>
              navigation.navigate('AppointmentReassign', {
                appointmentId: appointment.id,
              })
            }
            primary
          />
        ) : null}
        {quickActions.map((action) => (
          <QuickAction
            key={action.id}
            label={action.label}
            onPress={() => void runQuickAction(action)}
          />
        ))}
        {customer.phone ? (
          <QuickAction
            label="SMS"
            onPress={() => void Linking.openURL(`sms:${customer.phone}`)}
          />
        ) : null}
        <QuickAction
          label="Job"
          onPress={() =>
            navigation.navigate('JobDetails', { jobId: appointment.jobId })
          }
        />
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
          Start: {formatDateTime(appointment.scheduledStart)}
        </Text>
        <Text style={styles.meta}>
          End: {formatDateTime(appointment.scheduledEnd)}
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

      <Card title="Future scheduling">
        <Text style={styles.meta}>
          Drag-and-drop calendar movement, technician working hours, lunch
          breaks and route planning are prepared at the API architecture level
          and can be expanded without replacing appointments.
        </Text>
      </Card>

      <BlockingLoader text={busyText} />
    </ScrollView>
  );

  async function runQuickAction(action: AppointmentQuickAction) {
    if (!appointment) return;
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
    if (action.id === 'start') await transition('start');
    if (action.id === 'arrive') await transition('arrive');
    if (action.id === 'complete') await transition('complete');
  }
}

function actionText(action: 'start' | 'arrive' | 'complete' | 'cancel') {
  if (action === 'start') return 'Starting appointment...';
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
  quickAction: {
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  quickActionPrimary: { backgroundColor: colours.primary },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  quickText: { color: colours.primary, fontWeight: '900' },
  quickTextPrimary: { color: '#FFFFFF' },
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
