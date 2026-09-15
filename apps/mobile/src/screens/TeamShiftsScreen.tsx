import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState, type SetStateAction } from 'react';
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
  MemberShift,
  MemberShiftPayload,
  TeamMember,
} from '@tradieos/shared';
import {
  addDaysToDateOnly,
  formatBusinessClockTime,
  formatDateOnlyForDisplay,
  formatMemberLeaveType,
  formatMemberShiftTimeRange,
  getBusinessDateParts,
  getMemberShiftDates,
  isMemberOnLeave,
  isOvernightMemberShift,
  shiftOverlapsMemberLeave,
  validateMemberShiftPayload,
} from '@tradieos/shared';
import {
  cancelTeamShiftRequest,
  createTeamShiftRequest,
  membersRequest,
  teamLeaveRequest,
  teamShiftsRequest,
  updateTeamShiftRequest,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { keyboardAvoidingBehavior } from '../components/keyboardAvoidance';
import { useToast } from '../components/ToastProvider';
import { colours } from '../theme';

type PickerField = 'endTime' | 'shiftDate' | 'startTime';

export function TeamShiftsScreen() {
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const [selectedDate, setSelectedDate] = useState(() =>
    businessDateOnly(user?.business.timezone),
  );
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [shifts, setShifts] = useState<MemberShift[]>([]);
  const [leave, setLeave] = useState<MemberLeave[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [editingShift, setEditingShift] = useState<MemberShift | null>(null);
  const [pickerField, setPickerField] = useState<PickerField | null>(null);
  const [form, setForm] = useState<MemberShiftPayload>(() =>
    emptyShiftForm(selectedDate),
  );
  const [formError, setFormError] = useState<string | null>(null);

  const activeMembers = useMemo(
    () => members.filter((member) => member.status === 'ACTIVE'),
    [members],
  );
  const leaveByMember = useMemo(() => {
    const map = new Map<string, MemberLeave[]>();
    leave.forEach((record) => {
      const current = map.get(record.memberId) ?? [];
      current.push(record);
      map.set(record.memberId, current);
    });
    return map;
  }, [leave]);

  async function loadShifts(options: { silent?: boolean } = {}) {
    if (!token) return;
    if (!options.silent) setIsLoading(true);

    try {
      const [memberRecords, shiftRecords, leaveRecords] = await Promise.all([
        membersRequest(token),
        teamShiftsRequest(token, { date: selectedDate }),
        teamLeaveRequest(token),
      ]);
      setMembers(memberRecords);
      setShifts(shiftRecords.records);
      setLeave(leaveRecords.records);
    } catch (error) {
      showToast({
        message:
          error instanceof Error
            ? error.message
            : 'Could not load team shifts.',
        tone: 'error',
      });
    } finally {
      if (!options.silent) setIsLoading(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      void loadShifts({ silent: shifts.length > 0 || members.length > 0 });
      return undefined;
    }, [members.length, selectedDate, shifts.length, token]),
  );

  async function refresh() {
    setIsRefreshing(true);
    try {
      await loadShifts({ silent: true });
    } finally {
      setIsRefreshing(false);
    }
  }

  function openCreate(memberId?: string) {
    setEditingShift(null);
    setForm(emptyShiftForm(selectedDate, memberId ?? activeMembers[0]?.id));
    setFormError(null);
    setFormVisible(true);
  }

  function openEdit(shift: MemberShift) {
    setEditingShift(shift);
    setForm({
      endTime: shift.endTime,
      memberId: shift.memberId,
      note: shift.note ?? '',
      shiftDate: shift.shiftDate,
      startTime: shift.startTime,
    });
    setFormError(null);
    setFormVisible(true);
  }

  async function saveShift() {
    if (!token || isSaving) return;
    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setIsSaving(true);
    setFormError(null);
    try {
      if (editingShift) {
        await updateTeamShiftRequest(token, editingShift.id, form);
      } else {
        await createTeamShiftRequest(token, form);
      }
      setFormVisible(false);
      setEditingShift(null);
      setSelectedDate(form.shiftDate);
      await loadShifts({ silent: true });
      showToast({ message: 'Team shift saved.', tone: 'success' });
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Could not save team shift.',
      );
    } finally {
      setIsSaving(false);
    }
  }

  function validateForm() {
    if (!form.memberId) return 'Choose a team member.';
    const validationError = validateMemberShiftPayload(form);
    if (validationError) return validationError;
    const memberLeave = leaveByMember.get(form.memberId) ?? [];
    if (shiftOverlapsMemberLeave(form, memberLeave)) {
      return 'This team member is on leave for the selected shift date.';
    }
    return null;
  }

  function confirmCancel(shift: MemberShift) {
    Alert.alert(
      'Cancel this shift?',
      'Cancelled shifts are kept for history.',
      [
        { style: 'cancel', text: 'Keep shift' },
        {
          style: 'destructive',
          text: 'Cancel shift',
          onPress: () => void cancelShift(shift.id),
        },
      ],
    );
  }

  async function cancelShift(shiftId: string) {
    if (!token || isSaving) return;
    setIsSaving(true);
    try {
      await cancelTeamShiftRequest(token, shiftId);
      await loadShifts({ silent: true });
      showToast({ message: 'Shift cancelled.', tone: 'success' });
    } catch (error) {
      showToast({
        message:
          error instanceof Error ? error.message : 'Could not cancel shift.',
        tone: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  }

  const shiftsByMember = activeMembers.map((member) => ({
    leave: leaveByMember
      .get(member.id)
      ?.filter((record) => isMemberOnLeave(record, selectedDate)),
    member,
    shifts: shifts.filter((shift) => shift.memberId === member.id),
  }));

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
        <Text style={styles.eyebrow}>OWNER SCHEDULE</Text>
        <Text style={styles.title}>Team shifts</Text>
        <Text style={styles.subtitle}>
          Manage one-off shifts for active team members. Appointment assignment
          validation is not enabled yet.
        </Text>

        <View style={styles.dateCard}>
          <Text style={styles.dateLabel}>Selected date</Text>
          <Text style={styles.dateValue}>
            {formatDateOnlyForDisplay(selectedDate)}
          </Text>
          <View style={styles.dateActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                setSelectedDate(addDaysToDateOnly(selectedDate, -1))
              }
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryText}>Previous</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                setSelectedDate(businessDateOnly(user?.business.timezone))
              }
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryText}>Today</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                setSelectedDate(addDaysToDateOnly(selectedDate, 1))
              }
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryText}>Next</Text>
            </Pressable>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => openCreate()}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryText}>+ Add shift</Text>
        </Pressable>

        {isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colours.primary} />
            <Text style={styles.stateText}>Loading team shifts...</Text>
          </View>
        ) : null}

        {!isLoading && shiftsByMember.length === 0 ? (
          <View style={styles.stateCard}>
            <Text style={styles.emptyTitle}>No active team members</Text>
            <Text style={styles.stateText}>
              Active team members will appear here for shift planning.
            </Text>
          </View>
        ) : null}

        {shiftsByMember.map(
          ({ leave: memberLeave, member, shifts: memberShifts }) => (
            <View key={member.id} style={styles.memberCard}>
              <View style={styles.memberHeader}>
                <View>
                  <Text style={styles.memberName}>{member.name}</Text>
                  <Text style={styles.memberEmail}>{member.email}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={(memberLeave?.length ?? 0) > 0}
                  onPress={() => openCreate(member.id)}
                  style={[
                    styles.smallPrimary,
                    (memberLeave?.length ?? 0) > 0 && styles.disabled,
                  ]}
                >
                  <Text style={styles.smallPrimaryText}>Add</Text>
                </Pressable>
              </View>

              {memberLeave?.length ? (
                <View style={styles.leaveBadge}>
                  <Text style={styles.leaveBadgeText}>
                    On leave ·{' '}
                    {formatMemberLeaveType(
                      memberLeave[0]?.type ?? 'UNAVAILABLE',
                    )}
                  </Text>
                </View>
              ) : null}

              {memberShifts.length === 0 ? (
                <Text style={styles.noShift}>No shift scheduled.</Text>
              ) : (
                memberShifts.map((shift) => (
                  <View key={shift.id} style={styles.shiftRow}>
                    <View style={styles.shiftMain}>
                      <Text style={styles.shiftTime}>
                        {formatMemberShiftTimeRange(shift)}
                      </Text>
                      {isOvernightMemberShift(shift) ? (
                        <Text style={styles.overnight}>
                          Ends the following day
                        </Text>
                      ) : null}
                      {shift.note ? (
                        <Text style={styles.shiftNote}>{shift.note}</Text>
                      ) : null}
                    </View>
                    <View style={styles.shiftActions}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => openEdit(shift)}
                        style={styles.actionChip}
                      >
                        <Text style={styles.actionText}>Edit</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => confirmCancel(shift)}
                        style={styles.dangerChip}
                      >
                        <Text style={styles.dangerText}>Cancel</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </View>
          ),
        )}
      </ScrollView>

      <ShiftModal
        activeMembers={activeMembers}
        editingShift={editingShift}
        form={form}
        formError={formError}
        isSaving={isSaving}
        leaveByMember={leaveByMember}
        onClose={() => setFormVisible(false)}
        onSave={() => void saveShift()}
        pickerField={pickerField}
        setForm={setForm}
        setPickerField={setPickerField}
        visible={formVisible}
      />
    </SafeAreaView>
  );
}

function ShiftModal({
  activeMembers,
  editingShift,
  form,
  formError,
  isSaving,
  leaveByMember,
  onClose,
  onSave,
  pickerField,
  setForm,
  setPickerField,
  visible,
}: {
  activeMembers: TeamMember[];
  editingShift: MemberShift | null;
  form: MemberShiftPayload;
  formError: string | null;
  isSaving: boolean;
  leaveByMember: Map<string, MemberLeave[]>;
  onClose(): void;
  onSave(): void;
  pickerField: PickerField | null;
  setForm(value: SetStateAction<MemberShiftPayload>): void;
  setPickerField(value: PickerField | null): void;
  visible: boolean;
}) {
  const memberLeave = leaveByMember.get(form.memberId) ?? [];
  const shiftDates = getMemberShiftDates(form);
  const selectedMemberOnLeave = memberLeave.some((leave) =>
    shiftDates.some((date) => isMemberOnLeave(leave, date)),
  );

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={visible}
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
                {editingShift ? 'Edit shift' : 'Add shift'}
              </Text>
              <Text style={styles.fieldLabel}>Team member</Text>
              <ScrollView
                horizontal
                keyboardShouldPersistTaps="handled"
                showsHorizontalScrollIndicator={false}
                style={styles.memberPicker}
              >
                {activeMembers.map((member) => (
                  <Pressable
                    accessibilityRole="button"
                    key={member.id}
                    onPress={() =>
                      setForm((current) => ({
                        ...current,
                        memberId: member.id,
                      }))
                    }
                    style={[
                      styles.memberChip,
                      form.memberId === member.id && styles.memberChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.memberChipText,
                        form.memberId === member.id &&
                          styles.memberChipTextActive,
                      ]}
                    >
                      {member.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              {selectedMemberOnLeave ? (
                <Text style={styles.warningText}>
                  On leave for this shift date. Choose another date or cancel
                  the leave entry first.
                </Text>
              ) : null}
              <PickerFieldButton
                label="Date"
                onPress={() => setPickerField('shiftDate')}
                value={formatDateOnlyForDisplay(form.shiftDate)}
              />
              <View style={styles.timeRow}>
                <PickerFieldButton
                  label="Start time"
                  onPress={() => setPickerField('startTime')}
                  value={formatBusinessClockTime(form.startTime)}
                />
                <PickerFieldButton
                  label="End time"
                  onPress={() => setPickerField('endTime')}
                  value={formatBusinessClockTime(form.endTime)}
                />
              </View>
              {isOvernightMemberShift(form) ? (
                <Text style={styles.overnight}>Ends the following day</Text>
              ) : null}
              {pickerField ? (
                <View style={styles.pickerContainer}>
                  <DateTimePicker
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    mode={pickerField === 'shiftDate' ? 'date' : 'time'}
                    onChange={(_, value) => {
                      if (Platform.OS !== 'ios') setPickerField(null);
                      if (!value) return;
                      setForm((current) => ({
                        ...current,
                        [pickerField]:
                          pickerField === 'shiftDate'
                            ? dateOnlyFromDate(value)
                            : timeOnlyFromDate(value),
                      }));
                    }}
                    value={
                      pickerField === 'shiftDate'
                        ? dateFromDateOnly(form.shiftDate)
                        : dateFromTimeOnly(form[pickerField])
                    }
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
                placeholder="Shift context"
                placeholderTextColor={colours.muted}
                style={[styles.input, styles.textArea]}
                value={form.note ?? ''}
              />
              {formError ? <Text style={styles.error}>{formError}</Text> : null}
              <View style={styles.modalActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={isSaving}
                  onPress={onClose}
                  style={styles.modalSecondary}
                >
                  <Text style={styles.modalSecondaryText}>Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={isSaving || selectedMemberOnLeave}
                  onPress={onSave}
                  style={[
                    styles.modalPrimary,
                    (isSaving || selectedMemberOnLeave) && styles.disabled,
                  ]}
                >
                  {isSaving ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : null}
                  <Text style={styles.modalPrimaryText}>Save shift</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PickerFieldButton({
  label,
  onPress,
  value,
}: {
  label: string;
  onPress(): void;
  value: string;
}) {
  return (
    <View style={styles.pickerField}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={onPress}
        style={styles.dateButton}
      >
        <Text style={styles.dateButtonText}>{value}</Text>
      </Pressable>
    </View>
  );
}

function businessDateOnly(timezone?: string | null) {
  const parts = getBusinessDateParts(new Date(), timezone ?? undefined);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(
    parts.day,
  ).padStart(2, '0')}`;
}

function emptyShiftForm(date: string, memberId = ''): MemberShiftPayload {
  return {
    endTime: '17:00',
    memberId,
    note: '',
    shiftDate: date,
    startTime: '08:00',
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

function dateFromTimeOnly(value: string) {
  const [hours = 8, minutes = 0] = value.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function timeOnlyFromDate(value: Date) {
  return `${String(value.getHours()).padStart(2, '0')}:${String(
    value.getMinutes(),
  ).padStart(2, '0')}`;
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
  dateCard: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 18,
    padding: 16,
  },
  dateLabel: { color: colours.muted, fontSize: 12, fontWeight: '900' },
  dateValue: {
    color: colours.ink,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 4,
  },
  dateActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colours.primary,
    borderRadius: 16,
    marginTop: 18,
    paddingVertical: 15,
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryText: { color: colours.ink, fontWeight: '900' },
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
  memberCard: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 14,
    padding: 16,
  },
  memberHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  memberName: { color: colours.ink, fontSize: 17, fontWeight: '900' },
  memberEmail: { color: colours.muted, marginTop: 3 },
  smallPrimary: {
    backgroundColor: colours.primary,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  smallPrimaryText: { color: '#FFFFFF', fontWeight: '900' },
  leaveBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  leaveBadgeText: { color: '#92400E', fontWeight: '900' },
  noShift: { color: colours.muted, marginTop: 14 },
  shiftRow: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
    marginTop: 12,
    padding: 14,
  },
  shiftMain: { flex: 1 },
  shiftTime: { color: colours.ink, fontSize: 16, fontWeight: '900' },
  overnight: { color: colours.primary, fontWeight: '800', marginTop: 5 },
  shiftNote: { color: colours.muted, lineHeight: 20, marginTop: 6 },
  shiftActions: { flexDirection: 'row', gap: 8 },
  actionChip: {
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionText: { color: colours.primary, fontWeight: '900' },
  dangerChip: {
    backgroundColor: '#FFF1F2',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dangerText: { color: '#9F1239', fontWeight: '900' },
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
  memberPicker: { marginTop: 8 },
  memberChip: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  memberChipActive: {
    backgroundColor: colours.primary,
    borderColor: colours.primary,
  },
  memberChipText: { color: colours.muted, fontWeight: '800' },
  memberChipTextActive: { color: '#FFFFFF' },
  warningText: {
    color: '#92400E',
    fontWeight: '800',
    lineHeight: 20,
    marginTop: 10,
  },
  pickerField: { flex: 1 },
  timeRow: { flexDirection: 'row', gap: 10 },
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
  textArea: { minHeight: 88, textAlignVertical: 'top' },
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
  disabled: { opacity: 0.55 },
});
