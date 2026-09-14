import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  MemberLeave,
  MemberLeavePayload,
  MemberLeaveType,
} from '@tradieos/shared';
import {
  formatDateOnlyForDisplay,
  formatMemberLeaveDateRange,
  formatMemberLeaveType,
  getBusinessDateParts,
  MEMBER_LEAVE_TYPES,
  validateMemberLeaveRange,
} from '@tradieos/shared';
import {
  cancelMyLeaveRequest,
  createMyLeaveRequest,
  myLeaveRequest,
  updateMyLeaveRequest,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { keyboardAvoidingBehavior } from '../components/keyboardAvoidance';
import { useToast } from '../components/ToastProvider';
import { colours } from '../theme';

type DateField = 'endDate' | 'startDate';

export function MyLeaveScreen() {
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const [records, setRecords] = useState<MemberLeave[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingLeave, setEditingLeave] = useState<MemberLeave | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [pickerField, setPickerField] = useState<DateField | null>(null);
  const [form, setForm] = useState<MemberLeavePayload>(() =>
    emptyLeaveForm(user?.business.timezone),
  );
  const [formError, setFormError] = useState<string | null>(null);

  const activeRecords = useMemo(
    () => records.filter((record) => record.status === 'ACTIVE'),
    [records],
  );

  async function loadLeave(options: { silent?: boolean } = {}) {
    if (!token) return;
    if (!options.silent) setIsLoading(true);
    try {
      const response = await myLeaveRequest(token);
      setRecords(response.records);
    } catch (error) {
      showToast({
        message:
          error instanceof Error ? error.message : 'Could not load leave.',
        tone: 'error',
      });
    } finally {
      if (!options.silent) setIsLoading(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      void loadLeave({ silent: records.length > 0 });
      return undefined;
    }, [records.length, token]),
  );

  async function refresh() {
    setIsRefreshing(true);
    try {
      await loadLeave({ silent: true });
    } finally {
      setIsRefreshing(false);
    }
  }

  function openCreate() {
    setEditingLeave(null);
    setForm(emptyLeaveForm(user?.business.timezone));
    setFormError(null);
    setFormVisible(true);
  }

  function openEdit(leave: MemberLeave) {
    setEditingLeave(leave);
    setForm({
      endDate: leave.endDate,
      note: leave.note ?? '',
      startDate: leave.startDate,
      type: leave.type,
    });
    setFormError(null);
    setFormVisible(true);
  }

  async function saveLeave() {
    if (!token || isSaving) return;
    const validationError = validateMemberLeaveRange(
      form.startDate,
      form.endDate,
    );
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setIsSaving(true);
    setFormError(null);
    try {
      if (editingLeave) {
        await updateMyLeaveRequest(token, editingLeave.id, form);
      } else {
        await createMyLeaveRequest(token, form);
      }
      setFormVisible(false);
      setEditingLeave(null);
      await loadLeave({ silent: true });
      showToast({ message: 'Availability updated.', tone: 'success' });
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'Could not save this leave entry.',
      );
    } finally {
      setIsSaving(false);
    }
  }

  function confirmCancel(leave: MemberLeave) {
    Alert.alert(
      'Cancel this leave entry?',
      'Cancelling makes you available for future scheduling again.',
      [
        { style: 'cancel', text: 'Keep leave' },
        {
          style: 'destructive',
          text: 'Cancel leave',
          onPress: () => void cancelLeave(leave.id),
        },
      ],
    );
  }

  async function cancelLeave(leaveId: string) {
    if (!token || isSaving) return;
    setIsSaving(true);
    try {
      await cancelMyLeaveRequest(token, leaveId);
      await loadLeave({ silent: true });
      showToast({ message: 'Leave entry cancelled.', tone: 'success' });
    } catch (error) {
      showToast({
        message:
          error instanceof Error ? error.message : 'Could not cancel leave.',
        tone: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            colors={[colours.primary]}
            onRefresh={() => void refresh()}
            refreshing={isRefreshing}
            tintColor={colours.primary}
          />
        }
      >
        <Text style={styles.eyebrow}>SELF-SERVICE</Text>
        <Text style={styles.title}>My availability</Text>
        <Text style={styles.subtitle}>
          Add sick leave, planned leave or unavailable days. This does not
          change appointment scheduling rules yet.
        </Text>

        <Pressable
          accessibilityRole="button"
          onPress={openCreate}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryText}>+ Add leave</Text>
        </Pressable>

        {isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colours.primary} />
            <Text style={styles.stateText}>Loading your availability...</Text>
          </View>
        ) : null}

        {!isLoading && activeRecords.length === 0 ? (
          <View style={styles.stateCard}>
            <Text style={styles.emptyTitle}>No current or upcoming leave</Text>
            <Text style={styles.stateText}>
              Add leave when you are unavailable for scheduling.
            </Text>
          </View>
        ) : null}

        {activeRecords.map((leave) => (
          <View key={leave.id} style={styles.leaveCard}>
            <Text style={styles.leaveType}>
              {formatMemberLeaveType(leave.type)}
            </Text>
            <Text style={styles.leaveDate}>
              {formatMemberLeaveDateRange(leave.startDate, leave.endDate)}
            </Text>
            {leave.note ? <Text style={styles.note}>{leave.note}</Text> : null}
            <Text style={styles.status}>Active</Text>
            <View style={styles.cardActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => openEdit(leave)}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryText}>Edit</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => confirmCancel(leave)}
                style={styles.cancelButton}
              >
                <Text style={styles.cancelText}>Cancel leave</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>

      <Modal
        animationType="slide"
        onRequestClose={() => setFormVisible(false)}
        transparent
        visible={formVisible}
      >
        <KeyboardAvoidingView
          behavior={keyboardAvoidingBehavior}
          style={styles.modalKeyboard}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <ScrollView
                keyboardDismissMode={
                  Platform.OS === 'ios' ? 'interactive' : 'on-drag'
                }
                keyboardShouldPersistTaps="handled"
              >
                <Text style={styles.modalTitle}>
                  {editingLeave ? 'Edit leave' : 'Add leave'}
                </Text>
                <Text style={styles.fieldLabel}>Leave type</Text>
                <View style={styles.typeGrid}>
                  {MEMBER_LEAVE_TYPES.map((type) => (
                    <Pressable
                      accessibilityRole="button"
                      key={type}
                      onPress={() =>
                        setForm((current) => ({ ...current, type }))
                      }
                      style={[
                        styles.typeChip,
                        form.type === type && styles.typeChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.typeChipText,
                          form.type === type && styles.typeChipTextActive,
                        ]}
                      >
                        {formatMemberLeaveType(type)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <DateOnlyField
                  label="Start date"
                  onPress={() => setPickerField('startDate')}
                  value={form.startDate}
                />
                <DateOnlyField
                  label="End date"
                  onPress={() => setPickerField('endDate')}
                  value={form.endDate}
                />
                {pickerField ? (
                  <View style={styles.pickerContainer}>
                    <DateTimePicker
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      mode="date"
                      onChange={(_, selectedDate) => {
                        if (Platform.OS !== 'ios') setPickerField(null);
                        if (!selectedDate) return;
                        setForm((current) => ({
                          ...current,
                          [pickerField]: dateOnlyFromDate(selectedDate),
                        }));
                      }}
                      value={dateFromDateOnly(form[pickerField])}
                    />
                    {Platform.OS === 'ios' ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setPickerField(null)}
                        style={styles.doneButton}
                      >
                        <Text style={styles.doneText}>Done</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
                <Text style={styles.fieldLabel}>Optional note</Text>
                <TextInput
                  multiline
                  onChangeText={(note) =>
                    setForm((current) => ({ ...current, note }))
                  }
                  placeholder="Reason or context for the team owner"
                  placeholderTextColor={colours.muted}
                  style={[styles.input, styles.textArea]}
                  value={form.note ?? ''}
                />
                {formError ? (
                  <Text style={styles.error}>{formError}</Text>
                ) : null}
                <View style={styles.modalActions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isSaving}
                    onPress={() => setFormVisible(false)}
                    style={styles.modalSecondary}
                  >
                    <Text style={styles.modalSecondaryText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isSaving}
                    onPress={() => void saveLeave()}
                    style={[styles.modalPrimary, isSaving && styles.disabled]}
                  >
                    {isSaving ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : null}
                    <Text style={styles.modalPrimaryText}>
                      {editingLeave ? 'Save leave' : 'Add leave'}
                    </Text>
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function DateOnlyField({
  label,
  onPress,
  value,
}: {
  label: string;
  onPress(): void;
  value: string;
}) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={onPress}
        style={styles.dateButton}
      >
        <Text style={styles.dateButtonText}>
          {formatDateOnlyForDisplay(value)}
        </Text>
      </Pressable>
    </View>
  );
}

function emptyLeaveForm(timezone?: string | null): MemberLeavePayload {
  const parts = getBusinessDateParts(new Date(), timezone ?? undefined);
  const today = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(
    parts.day,
  ).padStart(2, '0')}`;
  return {
    endDate: today,
    note: '',
    startDate: today,
    type: 'UNAVAILABLE',
  };
}

function dateFromDateOnly(value: string) {
  const [year = 2000, month = 1, day = 1] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function dateOnlyFromDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(value.getDate()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colours.background },
  container: { padding: 20, paddingBottom: 44 },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  title: { color: colours.ink, fontSize: 30, fontWeight: '900', marginTop: 6 },
  subtitle: { color: colours.muted, lineHeight: 22, marginTop: 8 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colours.primary,
    borderRadius: 16,
    marginTop: 18,
    paddingVertical: 15,
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  stateCard: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 18,
    padding: 18,
  },
  stateText: {
    color: colours.muted,
    lineHeight: 20,
    marginTop: 8,
    textAlign: 'center',
  },
  emptyTitle: { color: colours.ink, fontSize: 17, fontWeight: '900' },
  leaveCard: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 14,
    padding: 18,
  },
  leaveType: { color: colours.ink, fontSize: 18, fontWeight: '900' },
  leaveDate: {
    color: colours.primary,
    fontSize: 16,
    fontWeight: '800',
    marginTop: 6,
  },
  note: { color: colours.muted, lineHeight: 20, marginTop: 8 },
  status: {
    alignSelf: 'flex-start',
    backgroundColor: '#DCFCE7',
    borderRadius: 999,
    color: '#166534',
    fontWeight: '900',
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  cardActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 13,
  },
  secondaryText: { color: colours.ink, fontWeight: '900' },
  cancelButton: {
    alignItems: 'center',
    backgroundColor: '#FFF1F2',
    borderColor: '#FECDD3',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 13,
  },
  cancelText: { color: '#9F1239', fontWeight: '900' },
  modalKeyboard: { flex: 1 },
  modalBackdrop: {
    backgroundColor: 'rgba(15, 23, 42, 0.38)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colours.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '88%',
    padding: 20,
  },
  modalTitle: { color: colours.ink, fontSize: 22, fontWeight: '900' },
  fieldLabel: {
    color: colours.ink,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 14,
  },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  typeChip: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  typeChipActive: {
    backgroundColor: colours.primary,
    borderColor: colours.primary,
  },
  typeChipText: { color: colours.muted, fontWeight: '800' },
  typeChipTextActive: { color: '#FFFFFF' },
  dateButton: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  dateButtonText: { color: colours.ink, fontSize: 16, fontWeight: '800' },
  pickerContainer: { marginTop: 8 },
  doneButton: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  doneText: { color: colours.primary, fontWeight: '800' },
  input: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colours.ink,
    fontSize: 16,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  textArea: { minHeight: 96, textAlignVertical: 'top' },
  error: { color: '#B00020', lineHeight: 20, marginTop: 12 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 18 },
  modalSecondary: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 14,
  },
  modalSecondaryText: { color: colours.ink, fontWeight: '900' },
  modalPrimary: {
    alignItems: 'center',
    backgroundColor: colours.primary,
    borderRadius: 14,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 14,
  },
  modalPrimaryText: { color: '#FFFFFF', fontWeight: '900' },
  disabled: { opacity: 0.6 },
});
