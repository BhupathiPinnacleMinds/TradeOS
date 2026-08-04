import type {
  Appointment,
  AppointmentAvailabilityResponse,
  AppointmentReassignmentTechnician,
} from '@tradieos/shared';
import {
  formatBusinessDateTime,
  normaliseBusinessTimezone,
} from '@tradieos/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  appointmentAvailabilityRequest,
  appointmentReassignmentOptionsRequest,
  friendlyAppointmentMutationError,
  reassignAppointmentRequest,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'AppointmentReassign'>;

function formatDateTime(value: string, timezone: string) {
  return formatBusinessDateTime(value, timezone);
}

function technicianName(appointment: Appointment) {
  return appointment.assignedUser
    ? `${appointment.assignedUser.firstName} ${appointment.assignedUser.lastName}`
    : 'Unassigned';
}

function appointmentAddress(appointment: Appointment) {
  return [
    appointment.addressLine1,
    appointment.addressLine2,
    appointment.suburb,
    appointment.state,
    appointment.postcode,
  ]
    .filter(Boolean)
    .join(', ');
}

export function AppointmentReassignScreen({ navigation, route }: Props) {
  const { appointmentId } = route.params;
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const businessTimezone = normaliseBusinessTimezone(user?.business.timezone);
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [technicians, setTechnicians] = useState<
    AppointmentReassignmentTechnician[]
  >([]);
  const [recommendation, setRecommendation] = useState<{
    technicianId: string | null;
    technicianName: string | null;
    reason: string;
  } | null>(null);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<
    string | null
  >(null);
  const [reason, setReason] = useState('');
  const [availability, setAvailability] =
    useState<AppointmentAvailabilityResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const canOverrideConflict = ['OWNER', 'ADMIN'].includes(user?.role ?? '');
  const selectedTechnician = useMemo(
    () =>
      technicians.find(
        (technician) => technician.userId === selectedTechnicianId,
      ) ?? null,
    [selectedTechnicianId, technicians],
  );

  const loadOptions = useCallback(
    async (shouldApply: () => boolean = () => true) => {
      if (!token) return;
      if (shouldApply()) setIsLoading(true);
      try {
        const response = await appointmentReassignmentOptionsRequest(
          token,
          appointmentId,
        );
        if (!shouldApply()) return;
        setAppointment(response.appointment);
        setTechnicians(response.technicians);
        setRecommendation(response.recommendation);
        setSelectedTechnicianId(
          response.recommendation.technicianId ??
            response.appointment.assignedUserId,
        );
      } catch (error) {
        if (shouldApply()) {
          showToast({
            message:
              error instanceof Error
                ? error.message
                : "We couldn't load reassignment options.",
            tone: 'error',
          });
        }
      } finally {
        if (shouldApply()) setIsLoading(false);
      }
    },
    [appointmentId, showToast, token],
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void loadOptions(() => active);
      return () => {
        active = false;
      };
    }, [loadOptions]),
  );

  async function selectTechnician(technicianId: string | null) {
    if (!token || !appointment) return;
    setSelectedTechnicianId(technicianId);
    setAvailability(null);
    setIsChecking(true);
    try {
      const response = await appointmentAvailabilityRequest(token, {
        assignedUserId: technicianId,
        excludeAppointmentId: appointment.id,
        scheduledEnd: appointment.scheduledEnd,
        scheduledStart: appointment.scheduledStart,
      });
      setAvailability(response);
    } catch (error) {
      showToast({
        message:
          error instanceof Error
            ? error.message
            : "We couldn't check technician availability.",
        tone: 'error',
      });
    } finally {
      setIsChecking(false);
    }
  }

  function confirmSave(allowConflictOverride = false) {
    if (!appointment || !selectedTechnician) return;
    Alert.alert(
      'Change technician?',
      `${technicianName(appointment)}\n↓\n${selectedTechnician.name}\n\nAppointment\n${formatDateTime(
        appointment.scheduledStart,
        businessTimezone,
      )}`,
      [
        { style: 'cancel', text: 'Cancel' },
        {
          onPress: () => void save(allowConflictOverride),
          text: 'Confirm',
        },
      ],
    );
  }

  async function save(allowConflictOverride = false) {
    if (!token || !appointment || !selectedTechnician || isSaving) return;
    setIsSaving(true);
    try {
      const response = await reassignAppointmentRequest(token, appointment.id, {
        allowConflictOverride,
        assignedUserId: selectedTechnician.userId,
        reason: reason.trim() || undefined,
      });
      showToast({
        message: `Appointment reassigned to ${technicianName(response.appointment)}.`,
        tone: 'success',
      });
      navigation.goBack();
    } catch (error) {
      showToast({
        message: friendlyAppointmentMutationError(error),
        tone: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.loadingPage}>
        <ActivityIndicator color={colours.primary} />
        <Text style={styles.meta}>Loading technicians...</Text>
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

  const hasConflict = Boolean(availability?.hasConflict);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.eyebrow}>REASSIGN APPOINTMENT</Text>
      <Text style={styles.title}>{appointment.job.title}</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Appointment summary</Text>
        <Text style={styles.meta}>
          Customer:{' '}
          {appointment.job.customer.companyName ??
            appointment.job.customer.displayName}
        </Text>
        <Text style={styles.meta}>Job: {appointment.job.jobNumber}</Text>
        <Text style={styles.meta}>
          Current technician: {technicianName(appointment)}
        </Text>
        <Text style={styles.meta}>
          Time: {formatDateTime(appointment.scheduledStart, businessTimezone)}
        </Text>
        <Text style={styles.meta}>
          Location: {appointmentAddress(appointment)}
        </Text>
      </View>

      {recommendation?.technicianId ? (
        <View style={[styles.card, styles.recommendedCard]}>
          <Text style={styles.cardTitle}>⭐ Recommended</Text>
          <Text style={styles.recommendedName}>
            {recommendation.technicianName}
          </Text>
          <Text style={styles.meta}>{recommendation.reason}</Text>
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>Available technicians</Text>
      {technicians.map((technician) => (
        <Pressable
          accessibilityRole="button"
          key={technician.userId}
          onPress={() => void selectTechnician(technician.userId)}
          style={[
            styles.technicianCard,
            selectedTechnicianId === technician.userId &&
              styles.technicianSelected,
          ]}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {technician.name
                .split(' ')
                .map((part) => part[0])
                .join('')
                .slice(0, 2)}
            </Text>
          </View>
          <View style={styles.technicianCopy}>
            <Text style={styles.technicianName}>{technician.name}</Text>
            <Text style={styles.meta}>
              {technician.role.replaceAll('_', ' ')} ·{' '}
              {technician.todayWorkload} appointments today
            </Text>
            <Text style={styles.meta}>
              {technician.upcomingToday} upcoming today
            </Text>
            <Text
              style={[
                styles.availability,
                technician.isAvailable
                  ? styles.availabilityGood
                  : styles.availabilityWarn,
              ]}
            >
              {technician.isAvailable
                ? 'Available'
                : technician.availabilityReason}
            </Text>
          </View>
        </Pressable>
      ))}

      {isChecking ? (
        <View style={styles.inlineState}>
          <ActivityIndicator color={colours.primary} />
          <Text style={styles.meta}>Checking availability...</Text>
        </View>
      ) : null}

      {hasConflict ? (
        <View style={styles.conflictCard}>
          <Text style={styles.conflictTitle}>
            This technician already has another appointment at this time.
          </Text>
          <Text style={styles.meta}>{availability?.reason}</Text>
          <View style={styles.actions}>
            <ActionButton
              label="Choose another"
              onPress={() => setAvailability(null)}
            />
            {canOverrideConflict ? (
              <ActionButton
                danger
                label="Override"
                onPress={() => confirmSave(true)}
              />
            ) : null}
          </View>
        </View>
      ) : null}

      <TextInput
        multiline
        onChangeText={setReason}
        placeholder="Optional reason for audit history"
        placeholderTextColor={colours.muted}
        style={styles.reasonInput}
        value={reason}
      />

      <ActionButton
        disabled={!selectedTechnician || isSaving || hasConflict}
        label={isSaving ? 'Saving...' : 'Confirm reassignment'}
        onPress={() => confirmSave(false)}
        primary
      />
    </ScrollView>
  );
}

function ActionButton({
  danger,
  disabled,
  label,
  onPress,
  primary,
}: {
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onPress(): void;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.actionButton,
        primary && styles.primaryButton,
        danger && styles.dangerButton,
        disabled && styles.disabledButton,
      ]}
    >
      <Text
        style={[
          styles.actionText,
          primary && styles.primaryText,
          danger && styles.dangerText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  actionText: { color: colours.primary, fontWeight: '900' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  avatar: {
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  avatarText: { color: colours.primary, fontWeight: '900' },
  availability: { fontWeight: '900', marginTop: 8 },
  availabilityGood: { color: '#047857' },
  availabilityWarn: { color: '#B45309' },
  card: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 16,
    padding: 16,
  },
  cardTitle: { color: colours.ink, fontSize: 18, fontWeight: '900' },
  conflictCard: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FDBA74',
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 16,
    padding: 16,
  },
  conflictTitle: { color: '#9A3412', fontWeight: '900' },
  container: {
    backgroundColor: colours.background,
    padding: 24,
    paddingBottom: 44,
  },
  dangerButton: { backgroundColor: '#FFF1F2' },
  dangerText: { color: '#BE123C' },
  disabledButton: { opacity: 0.45 },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  inlineState: { alignItems: 'center', gap: 8, marginTop: 16 },
  loadingPage: {
    alignItems: 'center',
    backgroundColor: colours.background,
    flex: 1,
    gap: 12,
    justifyContent: 'center',
  },
  meta: { color: colours.muted, lineHeight: 21, marginTop: 6 },
  primaryButton: { backgroundColor: colours.primary },
  primaryText: { color: '#FFFFFF' },
  reasonInput: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    color: colours.ink,
    marginTop: 20,
    minHeight: 92,
    padding: 14,
    textAlignVertical: 'top',
  },
  recommendedCard: { borderColor: '#A78BFA' },
  recommendedName: { color: colours.ink, fontSize: 22, fontWeight: '900' },
  sectionTitle: {
    color: colours.ink,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 24,
  },
  technicianCard: {
    alignItems: 'flex-start',
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
    padding: 14,
  },
  technicianCopy: { flex: 1 },
  technicianName: { color: colours.ink, fontSize: 17, fontWeight: '900' },
  technicianSelected: { borderColor: colours.primary, borderWidth: 2 },
  title: { color: colours.ink, fontSize: 32, fontWeight: '900', marginTop: 4 },
});
