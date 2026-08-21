import type { CustomerCommunicationSettings } from '@tradieos/shared';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  communicationSettingsRequest,
  updateCommunicationSettingsRequest,
} from '../api/client';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { canViewBusinessSettings } from '../permissions/roleVisibility';
import { colours } from '../theme';

export function SettingsScreen() {
  const { logout, signOutAllDevices, token, user } = useAuth();
  const [communicationSettings, setCommunicationSettings] =
    useState<CustomerCommunicationSettings | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const canAccessSettings = canViewBusinessSettings(user?.role);

  useEffect(() => {
    if (!token || !canAccessSettings) return;
    communicationSettingsRequest(token)
      .then((response) => setCommunicationSettings(response.settings))
      .catch(() => setCommunicationSettings(null));
  }, [canAccessSettings, token]);

  async function toggleCommunicationSetting(
    key: keyof CustomerCommunicationSettings,
  ) {
    if (!token || !communicationSettings || settingsBusy) return;
    const current = communicationSettings[key];
    if (typeof current !== 'boolean') return;
    setSettingsBusy(true);
    try {
      const response = await updateCommunicationSettingsRequest(token, {
        [key]: !current,
      });
      setCommunicationSettings(response.settings);
    } finally {
      setSettingsBusy(false);
    }
  }

  async function revokeSessions() {
    setSessionError(null);
    setSettingsBusy(true);
    try {
      await signOutAllDevices();
    } catch (error) {
      setSessionError(
        error instanceof Error
          ? error.message
          : 'Could not sign out all devices.',
      );
    } finally {
      setSettingsBusy(false);
    }
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Settings</Text>
        {!canAccessSettings ? (
          <>
            <Text style={styles.subtitle}>
              Your role can use operational tools like Calendar, Jobs and Tori,
              but business settings are limited to owners and office admins.
            </Text>

            <View style={styles.card}>
              <Text style={styles.label}>Signed in as</Text>
              <Text style={styles.value}>
                {user?.firstName} {user?.lastName}
              </Text>
              <Text style={styles.meta}>
                {user?.email} · {user?.role}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => void logout()}
              style={({ pressed }) => [
                styles.logoutButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.logoutText}>Log out</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={settingsBusy}
              onPress={() => void revokeSessions()}
              style={({ pressed }) => [
                styles.revokeButton,
                pressed && styles.buttonPressed,
                settingsBusy && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.revokeText}>Sign out all devices</Text>
            </Pressable>
            {sessionError ? (
              <Text style={styles.errorText}>{sessionError}</Text>
            ) : null}
          </>
        ) : (
          <>
            <Text style={styles.subtitle}>
              Manage your business workspace, members, defaults and
              integrations.
            </Text>

            <View style={styles.card}>
              <Text style={styles.label}>Business workspace</Text>
              <Text style={styles.value}>{user?.business.name}</Text>
              <Text style={styles.meta}>
                {user?.business.tradeType ?? 'Trade not set'} · ABN{' '}
                {user?.business.abn ?? 'not set'}
              </Text>
              <Text style={styles.meta}>
                GST{' '}
                {user?.business.gstRegistered ? 'registered' : 'not registered'}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>Signed in as</Text>
              <Text style={styles.value}>
                {user?.firstName} {user?.lastName}
              </Text>
              <Text style={styles.meta}>{user?.email}</Text>
            </View>

            {communicationSettings ? (
              <View style={styles.card}>
                <Text style={styles.label}>Communication settings</Text>
                <Text style={styles.meta}>
                  Local-safe Phase 1 reminders and confirmations. Real SMS/email
                  vendors are not connected yet.
                </Text>
                <SettingToggle
                  disabled={settingsBusy}
                  label="Appointment confirmations"
                  onPress={() =>
                    void toggleCommunicationSetting(
                      'appointmentConfirmationsEnabled',
                    )
                  }
                  value={communicationSettings.appointmentConfirmationsEnabled}
                />
                <SettingToggle
                  disabled={settingsBusy}
                  label={`Appointment reminders (${Math.round(
                    communicationSettings.appointmentReminderLeadMinutes / 60,
                  )}h before)`}
                  onPress={() =>
                    void toggleCommunicationSetting(
                      'appointmentRemindersEnabled',
                    )
                  }
                  value={communicationSettings.appointmentRemindersEnabled}
                />
                <SettingToggle
                  disabled={settingsBusy}
                  label="Quote follow-ups (3 days after send)"
                  onPress={() =>
                    void toggleCommunicationSetting('quoteFollowUpsEnabled')
                  }
                  value={communicationSettings.quoteFollowUpsEnabled}
                />
                <SettingToggle
                  disabled={settingsBusy}
                  label="Invoice due reminders"
                  onPress={() =>
                    void toggleCommunicationSetting(
                      'invoiceDueSoonRemindersEnabled',
                    )
                  }
                  value={communicationSettings.invoiceDueSoonRemindersEnabled}
                />
                <SettingToggle
                  disabled={settingsBusy}
                  label="Invoice overdue reminders"
                  onPress={() =>
                    void toggleCommunicationSetting(
                      'invoiceOverdueRemindersEnabled',
                    )
                  }
                  value={communicationSettings.invoiceOverdueRemindersEnabled}
                />
                <SettingToggle
                  disabled={settingsBusy}
                  label="Payment confirmations"
                  onPress={() =>
                    void toggleCommunicationSetting(
                      'paymentConfirmationsEnabled',
                    )
                  }
                  value={communicationSettings.paymentConfirmationsEnabled}
                />
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              onPress={() => void logout()}
              style={({ pressed }) => [
                styles.logoutButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.logoutText}>Log out</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={settingsBusy}
              onPress={() => void revokeSessions()}
              style={({ pressed }) => [
                styles.revokeButton,
                pressed && styles.buttonPressed,
                settingsBusy && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.revokeText}>Sign out all devices</Text>
            </Pressable>
            {sessionError ? (
              <Text style={styles.errorText}>{sessionError}</Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingToggle({
  disabled,
  label,
  onPress,
  value,
}: {
  disabled: boolean;
  label: string;
  onPress(): void;
  value: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={styles.settingRow}
    >
      <Text style={styles.settingLabel}>{label}</Text>
      <Text style={[styles.settingPill, value && styles.settingPillActive]}>
        {value ? 'On' : 'Off'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colours.background },
  container: { padding: 24, paddingBottom: 44 },
  title: { color: colours.ink, fontSize: 30, fontWeight: '900' },
  subtitle: { color: colours.muted, lineHeight: 22, marginTop: 8 },
  card: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 18,
    padding: 18,
  },
  label: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  value: { color: colours.ink, fontSize: 20, fontWeight: '800', marginTop: 8 },
  meta: { color: colours.muted, marginTop: 5 },
  settingLabel: { color: colours.ink, flex: 1, fontWeight: '800' },
  settingPill: {
    backgroundColor: '#F1F5F9',
    borderRadius: 999,
    color: colours.muted,
    fontWeight: '900',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  settingPillActive: { backgroundColor: '#DCFCE7', color: '#166534' },
  settingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginTop: 14,
  },
  logoutButton: {
    alignItems: 'center',
    backgroundColor: '#9F1239',
    borderRadius: 16,
    marginTop: 24,
    paddingVertical: 15,
  },
  revokeButton: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 12,
    paddingVertical: 15,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonPressed: { opacity: 0.75 },
  logoutText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  revokeText: { color: colours.ink, fontSize: 16, fontWeight: '800' },
  errorText: { color: '#B00020', lineHeight: 20, marginTop: 12 },
});
