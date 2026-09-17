import type {
  BusinessOperatingHours,
  CustomerCommunicationSettings,
  InvoicePaymentInstructions,
} from '@tradieos/shared';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  businessOperatingHoursRequest,
  businessPaymentInstructionsRequest,
  communicationSettingsRequest,
  updateBusinessOperatingHoursRequest,
  updateBusinessPaymentInstructionsRequest,
  updateCommunicationSettingsRequest,
} from '../api/client';
import {
  DEFAULT_BUSINESS_END_TIME,
  DEFAULT_BUSINESS_START_TIME,
  formatBusinessClockTime,
  formatBusinessOperatingHours,
  isOvernightBusinessHours,
  validateBusinessOperatingHours,
} from '@tradieos/shared';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { canViewBusinessSettings } from '../permissions/roleVisibility';
import { colours } from '../theme';

export function SettingsScreen() {
  const { logout, signOutAllDevices, token, user } = useAuth();
  const [communicationSettings, setCommunicationSettings] =
    useState<CustomerCommunicationSettings | null>(null);
  const [paymentInstructions, setPaymentInstructions] =
    useState<InvoicePaymentInstructions | null>(null);
  const [operatingHours, setOperatingHours] =
    useState<BusinessOperatingHours | null>(null);
  const [operatingHoursForm, setOperatingHoursForm] =
    useState<BusinessOperatingHours>({
      businessEndTime:
        user?.business.businessEndTime ?? DEFAULT_BUSINESS_END_TIME,
      businessStartTime:
        user?.business.businessStartTime ?? DEFAULT_BUSINESS_START_TIME,
    });
  const [operatingHoursPicker, setOperatingHoursPicker] = useState<
    keyof BusinessOperatingHours | null
  >(null);
  const [paymentForm, setPaymentForm] = useState({
    accountName: '',
    accountNumber: '',
    bankName: '',
    bsb: '',
    customInstructions: '',
  });
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [operatingHoursError, setOperatingHoursError] = useState<string | null>(
    null,
  );
  const canAccessSettings = canViewBusinessSettings(user?.role);

  useEffect(() => {
    if (!token || !canAccessSettings) return;
    communicationSettingsRequest(token)
      .then((response) => setCommunicationSettings(response.settings))
      .catch(() => setCommunicationSettings(null));
    businessPaymentInstructionsRequest(token)
      .then((response) => {
        setPaymentInstructions(response.paymentInstructions);
        setPaymentForm({
          accountName: response.paymentInstructions.accountName ?? '',
          accountNumber: response.paymentInstructions.accountNumber ?? '',
          bankName: response.paymentInstructions.bankName ?? '',
          bsb: response.paymentInstructions.bsb ?? '',
          customInstructions:
            response.paymentInstructions.customInstructions ?? '',
        });
      })
      .catch(() => setPaymentInstructions(null));
    businessOperatingHoursRequest(token)
      .then((response) => {
        setOperatingHours(response.operatingHours);
        setOperatingHoursForm(response.operatingHours);
      })
      .catch(() => {
        setOperatingHours(null);
        setOperatingHoursForm({
          businessEndTime:
            user?.business.businessEndTime ?? DEFAULT_BUSINESS_END_TIME,
          businessStartTime:
            user?.business.businessStartTime ?? DEFAULT_BUSINESS_START_TIME,
        });
      });
  }, [
    canAccessSettings,
    token,
    user?.business.businessEndTime,
    user?.business.businessStartTime,
  ]);

  async function saveOperatingHours() {
    if (!token || settingsBusy) return;
    setOperatingHoursError(null);
    const validationError = validateBusinessOperatingHours(
      operatingHoursForm.businessStartTime,
      operatingHoursForm.businessEndTime,
    );

    if (validationError) {
      setOperatingHoursError(validationError);
      return;
    }

    setSettingsBusy(true);
    try {
      const response = await updateBusinessOperatingHoursRequest(
        token,
        operatingHoursForm,
      );
      setOperatingHours(response.operatingHours);
      setOperatingHoursForm(response.operatingHours);
    } catch (error) {
      setOperatingHoursError(
        error instanceof Error
          ? error.message
          : 'Could not save business hours.',
      );
    } finally {
      setSettingsBusy(false);
    }
  }

  async function savePaymentInstructions() {
    if (!token || settingsBusy) return;
    setSettingsBusy(true);
    try {
      const response = await updateBusinessPaymentInstructionsRequest(token, {
        accountName: paymentForm.accountName,
        accountNumber: paymentForm.accountNumber,
        bankName: paymentForm.bankName,
        bsb: paymentForm.bsb,
        customInstructions: paymentForm.customInstructions,
      });
      setPaymentInstructions(response.paymentInstructions);
      setPaymentForm({
        accountName: response.paymentInstructions.accountName ?? '',
        accountNumber: response.paymentInstructions.accountNumber ?? '',
        bankName: response.paymentInstructions.bankName ?? '',
        bsb: response.paymentInstructions.bsb ?? '',
        customInstructions:
          response.paymentInstructions.customInstructions ?? '',
      });
    } finally {
      setSettingsBusy(false);
    }
  }

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
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
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

            <View style={styles.card}>
              <Text style={styles.label}>Business hours</Text>
              <Text style={styles.meta}>
                Default operating hours for this workspace. Scheduling, conflict
                checks and technician assignment rules are unchanged.
              </Text>
              <View style={styles.hoursRow}>
                <ClockTimeField
                  label="Start time"
                  onPress={() => setOperatingHoursPicker('businessStartTime')}
                  value={operatingHoursForm.businessStartTime}
                />
                <ClockTimeField
                  label="End time"
                  onPress={() => setOperatingHoursPicker('businessEndTime')}
                  value={operatingHoursForm.businessEndTime}
                />
              </View>
              <Text style={styles.meta}>
                {formatBusinessOperatingHours(operatingHoursForm)}
                {isOvernightBusinessHours(
                  operatingHoursForm.businessStartTime,
                  operatingHoursForm.businessEndTime,
                )
                  ? ' · Ends the following day'
                  : ''}
              </Text>
              {operatingHoursPicker ? (
                <View style={styles.pickerContainer}>
                  <DateTimePicker
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    mode="time"
                    onChange={(_, selectedDate) => {
                      if (Platform.OS !== 'ios') setOperatingHoursPicker(null);
                      if (!selectedDate) return;
                      setOperatingHoursForm((current) => ({
                        ...current,
                        [operatingHoursPicker]: clockTimeFromDate(selectedDate),
                      }));
                    }}
                    value={dateFromClockTime(
                      operatingHoursForm[operatingHoursPicker],
                    )}
                  />
                  {Platform.OS === 'ios' ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setOperatingHoursPicker(null)}
                      style={styles.doneButton}
                    >
                      <Text style={styles.doneText}>Done</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              {operatingHoursError ? (
                <Text style={styles.errorText}>{operatingHoursError}</Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={settingsBusy}
                onPress={() => void saveOperatingHours()}
                style={({ pressed }) => [
                  styles.saveButton,
                  pressed && styles.buttonPressed,
                  settingsBusy && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.saveText}>Save business hours</Text>
              </Pressable>
              {operatingHours ? (
                <Text style={styles.meta}>Business hours are configured.</Text>
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>Invoice payment details</Text>
              <Text style={styles.meta}>
                These bank details appear on customer invoice links, invoice
                PDFs and invoice emails.
              </Text>
              <TextInput
                accessibilityLabel="Account name"
                onChangeText={(accountName) =>
                  setPaymentForm((current) => ({ ...current, accountName }))
                }
                placeholder="Account name"
                style={styles.input}
                value={paymentForm.accountName}
              />
              <TextInput
                accessibilityLabel="Bank name"
                onChangeText={(bankName) =>
                  setPaymentForm((current) => ({ ...current, bankName }))
                }
                placeholder="Bank name (optional)"
                style={styles.input}
                value={paymentForm.bankName}
              />
              <TextInput
                accessibilityLabel="BSB"
                keyboardType="number-pad"
                onChangeText={(bsb) =>
                  setPaymentForm((current) => ({ ...current, bsb }))
                }
                placeholder="BSB"
                style={styles.input}
                value={paymentForm.bsb}
              />
              <TextInput
                accessibilityLabel="Account number"
                keyboardType="number-pad"
                onChangeText={(accountNumber) =>
                  setPaymentForm((current) => ({ ...current, accountNumber }))
                }
                placeholder="Account number"
                style={styles.input}
                value={paymentForm.accountNumber}
              />
              <TextInput
                accessibilityLabel="Payment instructions"
                multiline
                onChangeText={(customInstructions) =>
                  setPaymentForm((current) => ({
                    ...current,
                    customInstructions,
                  }))
                }
                placeholder="Additional payment instructions (optional)"
                style={[styles.input, styles.textArea]}
                value={paymentForm.customInstructions}
              />
              <Pressable
                accessibilityRole="button"
                disabled={settingsBusy}
                onPress={() => void savePaymentInstructions()}
                style={({ pressed }) => [
                  styles.saveButton,
                  pressed && styles.buttonPressed,
                  settingsBusy && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.saveText}>Save payment details</Text>
              </Pressable>
              {paymentInstructions?.hasBankDetails ? (
                <Text style={styles.meta}>Payment details are configured.</Text>
              ) : (
                <Text style={styles.meta}>
                  Add account name, BSB and account number to show bank details
                  on invoices.
                </Text>
              )}
            </View>

            {communicationSettings ? (
              <View style={styles.card}>
                <Text style={styles.label}>Communication settings</Text>
                <Text style={styles.meta}>
                  Appointment confirmations and reminders use the configured
                  TradeOS email service when delivery is enabled. Appointment
                  SMS is not enabled here.
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

function ClockTimeField({
  label,
  onPress,
  value,
}: {
  label: string;
  onPress(): void;
  value: string;
}) {
  return (
    <View style={styles.hoursField}>
      <Text style={styles.inputLabel}>{label}</Text>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={onPress}
        style={styles.inputButton}
      >
        <Text style={styles.inputButtonText}>
          {formatBusinessClockTime(value)}
        </Text>
      </Pressable>
    </View>
  );
}

function dateFromClockTime(value: string) {
  const [hours = 0, minutes = 0] = value.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function clockTimeFromDate(value: Date) {
  return `${String(value.getHours()).padStart(2, '0')}:${String(
    value.getMinutes(),
  ).padStart(2, '0')}`;
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
  input: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colours.ink,
    fontSize: 15,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  hoursField: { flex: 1 },
  hoursRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  inputLabel: {
    color: colours.ink,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 12,
  },
  inputButton: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  inputButtonText: { color: colours.ink, fontSize: 15, fontWeight: '800' },
  pickerContainer: { marginTop: 8 },
  doneButton: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  doneText: { color: colours.primary, fontWeight: '800' },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colours.primary,
    borderRadius: 14,
    marginTop: 14,
    paddingVertical: 14,
  },
  saveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
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
  textArea: { minHeight: 96, textAlignVertical: 'top' },
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
