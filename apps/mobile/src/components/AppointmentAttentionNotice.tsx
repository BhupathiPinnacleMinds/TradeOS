import type { Appointment } from '@tradieos/shared';
import {
  appointmentAttentionLabel,
  formatMemberLeaveType,
} from '@tradieos/shared';
import { StyleSheet, Text, View } from 'react-native';
import { colours } from '../theme';

export function AppointmentAttentionNotice({
  appointment,
  compact = false,
  viewerId,
}: {
  appointment: Appointment;
  compact?: boolean;
  viewerId?: string | null;
}) {
  const attention = appointmentAttentionLabel(appointment, viewerId);
  if (!attention) return null;
  const technicians = appointment.availabilityConflict?.technicians ?? [];
  return (
    <View
      accessibilityRole="alert"
      style={[styles.notice, compact && styles.compact]}
    >
      <Text style={styles.title}>⚠ {attention.title}</Text>
      <Text style={styles.detail}>
        {technicians
          .map(
            (member) =>
              `${member.name} · ${formatMemberLeaveType(member.leaveType)}`,
          )
          .join(', ')}
      </Text>
      {!compact ? <Text style={styles.detail}>{attention.detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    backgroundColor: '#FFFBEB',
    borderColor: colours.warning,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    marginTop: 10,
    padding: 12,
  },
  compact: { padding: 8 },
  title: { color: '#92400E', fontWeight: '800' },
  detail: { color: colours.ink, lineHeight: 19 },
});
