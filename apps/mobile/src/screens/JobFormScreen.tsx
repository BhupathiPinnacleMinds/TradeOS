import type {
  Customer,
  JobPayload,
  JobPriority,
  JobStatus,
  TeamMember,
} from '@tradieos/shared';
import {
  DEFAULT_BUSINESS_TIMEZONE,
  normaliseBusinessTimezone,
} from '@tradieos/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  createJobRequest,
  customerDetailRequest,
  customersRequest,
  jobDetailRequest,
  membersRequest,
  updateJobRequest,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { AddressSuggestion } from '../components/AddressAutocompleteInput';
import { AddressAutocompleteInput } from '../components/AddressAutocompleteInput';
import { useToast } from '../components/ToastProvider';
import { keyboardAvoidingBehavior } from '../components/keyboardAvoidance';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'JobForm'>;
type ScheduleField = 'scheduledStart' | 'scheduledEnd';
type PickerState = { field: ScheduleField; mode: 'date' | 'time' } | null;

const statuses: JobStatus[] = [
  'NEW',
  'SCHEDULED',
  'ON_THE_WAY',
  'IN_PROGRESS',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
];
const priorities: JobPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

function label(value: string) {
  return value.replaceAll('_', ' ');
}

function localDateTimeInput(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const hour = String(value.getHours()).padStart(2, '0');
  const minute = String(value.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function dateFromFormValue(value?: string | null) {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function mergeDatePart(current: Date, selected: Date) {
  const next = new Date(current);
  next.setFullYear(
    selected.getFullYear(),
    selected.getMonth(),
    selected.getDate(),
  );
  return next;
}

function mergeTimePart(current: Date, selected: Date) {
  const next = new Date(current);
  next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
  return next;
}

function humanDateTime(
  value?: string | null,
  timezone: string = DEFAULT_BUSINESS_TIMEZONE,
) {
  if (!value) return 'Select date and time';
  const date = dateFromFormValue(value);
  const businessTimezone = normaliseBusinessTimezone(timezone);
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    timeZone: businessTimezone,
    year: 'numeric',
  })
    .format(date)
    .replace(' at ', ', ');
}

function calculateDurationMinutes(
  scheduledStart?: string | null,
  scheduledEnd?: string | null,
) {
  if (!scheduledStart || !scheduledEnd) return null;
  const start = new Date(scheduledStart);
  const end = new Date(scheduledEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  const diffMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  return diffMinutes > 0 ? diffMinutes : null;
}

function initialPayload(customerId = ''): JobPayload {
  const start = new Date();
  start.setHours(start.getHours() + 2, 0, 0, 0);
  const end = new Date(start);
  end.setHours(end.getHours() + 2);

  return {
    addressLine1: '',
    customerId,
    postcode: '',
    priority: 'NORMAL',
    scheduledEnd: localDateTimeInput(end),
    scheduledStart: localDateTimeInput(start),
    state: 'NSW',
    status: 'SCHEDULED',
    suburb: '',
    title: '',
  };
}

export function JobFormScreen({ navigation, route }: Props) {
  const { jobId, customerId } = route.params ?? {};
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const [form, setForm] = useState<JobPayload>(initialPayload(customerId));
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [useQuickCustomer, setUseQuickCustomer] = useState(false);
  const [createdJobPrompt, setCreatedJobPrompt] = useState<{
    customerId: string;
    jobId: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [picker, setPicker] = useState<PickerState>(null);
  const businessTimezone = user?.business.timezone ?? DEFAULT_BUSINESS_TIMEZONE;

  useEffect(() => {
    navigation.setOptions({ title: jobId ? 'Edit job' : 'New job' });
  }, [jobId, navigation]);

  useEffect(() => {
    if (!token) return;
    const authToken = token;
    let mounted = true;
    async function load() {
      setIsLoading(true);
      try {
        const [customerResponse, teamResponse] = await Promise.all([
          customersRequest(authToken, {
            page: 1,
            pageSize: 100,
            sortBy: 'displayName',
          }),
          membersRequest(authToken),
        ]);
        if (!mounted) return;
        setCustomers(customerResponse.records);
        setMembers(teamResponse.filter((member) => member.status === 'ACTIVE'));

        if (jobId) {
          const response = await jobDetailRequest(authToken, jobId);
          if (!mounted) return;
          setForm({
            addressLine1: response.job.addressLine1,
            addressLine2: response.job.addressLine2 ?? undefined,
            assignedToUserId: response.job.assignedToUserId,
            customerId: response.job.customerId,
            description: response.job.description ?? undefined,
            estimatedDurationMinutes:
              response.job.estimatedDurationMinutes ?? undefined,
            internalNotes: response.job.internalNotes ?? undefined,
            postcode: response.job.postcode,
            priority: response.job.priority,
            scheduledEnd: response.job.scheduledEnd
              ? localDateTimeInput(new Date(response.job.scheduledEnd))
              : undefined,
            scheduledStart: localDateTimeInput(
              new Date(response.job.scheduledStart),
            ),
            state: response.job.state,
            status: response.job.status,
            suburb: response.job.suburb,
            title: response.job.title,
            tradeType: response.job.tradeType ?? undefined,
            accessInstructions: response.job.accessInstructions ?? undefined,
            customerNotes: response.job.customerNotes ?? undefined,
            requiresInvoice: response.job.requiresInvoice,
            requiresQuote: response.job.requiresQuote,
          });
        } else if (customerId) {
          const response = await customerDetailRequest(authToken, customerId);
          if (!mounted) return;
          setForm((current) => ({
            ...current,
            addressLine1: response.customer.addressLine1 ?? '',
            addressLine2: response.customer.addressLine2 ?? undefined,
            customerId,
            postcode: response.customer.postcode ?? '',
            state: response.customer.state ?? 'NSW',
            suburb: response.customer.suburb ?? '',
          }));
        } else if (customerResponse.records[0]) {
          const firstCustomer = customerResponse.records[0];
          setForm((current) => ({
            ...current,
            customerId: firstCustomer.id,
          }));
        }
      } catch {
        showToast({
          message: "We couldn't prepare the job form.",
          tone: 'error',
        });
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [customerId, jobId, showToast, token]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === form.customerId),
    [customers, form.customerId],
  );

  function update(
    key: keyof JobPayload,
    value: string | boolean | number | null,
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: '' }));
  }

  function updateScheduleValue(field: ScheduleField, value: Date) {
    const nextValue = localDateTimeInput(value);
    setForm((current) => {
      const next = { ...current, [field]: nextValue };
      const duration = calculateDurationMinutes(
        next.scheduledStart,
        next.scheduledEnd,
      );
      return {
        ...next,
        estimatedDurationMinutes:
          duration ?? current.estimatedDurationMinutes ?? null,
      };
    });
    setErrors((current) => ({ ...current, [field]: '' }));
  }

  function handlePickerChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (!picker) return;
    if (Platform.OS !== 'ios' && event.type === 'dismissed') {
      setPicker(null);
      return;
    }
    if (!selectedDate) return;

    const current = dateFromFormValue(form[picker.field]);
    const next =
      picker.mode === 'date'
        ? mergeDatePart(current, selectedDate)
        : mergeTimePart(current, selectedDate);
    updateScheduleValue(picker.field, next);

    if (Platform.OS !== 'ios') {
      setPicker(
        picker.mode === 'date' ? { field: picker.field, mode: 'time' } : null,
      );
    }
  }

  function completeIosPickerStep() {
    if (!picker) return;
    setPicker(
      picker.mode === 'date' ? { field: picker.field, mode: 'time' } : null,
    );
  }

  function applyAddressSuggestion(suggestion: AddressSuggestion) {
    update('addressLine1', suggestion.addressLine1);
    update('addressLine2', suggestion.addressLine2 ?? '');
    update('suburb', suggestion.suburb);
    update('state', suggestion.state);
    update('postcode', suggestion.postcode);
  }

  function validate(input: JobPayload) {
    const next: Record<string, string> = {};
    if (!input.customerId && !input.quickCustomer) {
      next.customerId = 'Choose a customer or create a quick customer.';
    }
    if (input.quickCustomer) {
      if (!input.quickCustomer.name.trim())
        next.quickCustomerName = 'Enter a customer name.';
      if (!input.quickCustomer.phone.trim())
        next.quickCustomerPhone = 'Enter a phone number.';
      if (
        input.quickCustomer.email?.trim() &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.quickCustomer.email.trim())
      ) {
        next.quickCustomerEmail = 'Enter a valid email address.';
      }
      if (!input.quickCustomer.addressLine1.trim()) {
        next.quickCustomerAddress = 'Enter a customer address.';
      }
    }
    if (!input.title.trim()) next.title = 'Enter a job title.';
    if (!input.scheduledStart) next.scheduledStart = 'Enter a scheduled start.';
    if (!input.addressLine1.trim()) next.addressLine1 = 'Enter an address.';
    if (!input.suburb.trim()) next.suburb = 'Enter a suburb.';
    if (!/^\d{4}$/.test(input.postcode.trim()))
      next.postcode = 'Enter a 4-digit postcode.';
    if (
      input.scheduledEnd &&
      new Date(input.scheduledEnd) <= new Date(input.scheduledStart)
    ) {
      next.scheduledEnd = 'End time must be after start time.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function save() {
    if (!token || isSaving) return;
    const payload: JobPayload = {
      ...form,
      assignedToUserId: form.assignedToUserId || null,
      customerId: useQuickCustomer ? undefined : form.customerId,
      quickCustomer:
        useQuickCustomer && form.quickCustomer
          ? {
              ...form.quickCustomer,
              email:
                form.quickCustomer.email?.trim().toLowerCase() || undefined,
              addressLine1: form.addressLine1,
              addressLine2: form.addressLine2,
              postcode: form.postcode,
              state: form.state,
              suburb: form.suburb,
            }
          : undefined,
      scheduledStart: new Date(form.scheduledStart).toISOString(),
      scheduledEnd: form.scheduledEnd
        ? new Date(form.scheduledEnd).toISOString()
        : null,
    };
    if (!validate(payload)) {
      showToast({
        message: 'Please check the highlighted fields.',
        tone: 'error',
      });
      return;
    }
    setIsSaving(true);
    try {
      const response = jobId
        ? await updateJobRequest(token, jobId, payload)
        : await createJobRequest(token, payload);
      showToast({
        message: jobId ? 'Job updated.' : `${response.job.jobNumber} created.`,
        tone: 'success',
      });
      if (jobId) {
        navigation.replace('JobDetails', { jobId: response.job.id });
      } else {
        setCreatedJobPrompt({
          customerId: response.job.customerId,
          jobId: response.job.id,
        });
      }
    } catch (error) {
      showToast({
        message:
          error instanceof Error ? error.message : "We couldn't save this job.",
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
        <Text style={styles.muted}>Loading job form...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={keyboardAvoidingBehavior}
      style={styles.flex}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>JOB DETAILS</Text>
        <Text style={styles.title}>{jobId ? 'Edit job' : 'New job'}</Text>
        <Text style={styles.subtitle}>
          Capture the minimum useful details so the team can get moving.
        </Text>

        <Section title="Customer">
          {!jobId ? (
            <Toggle
              active={useQuickCustomer}
              label="Create quick customer"
              onPress={() => {
                setUseQuickCustomer((current) => !current);
                setForm((current) => ({
                  ...current,
                  customerId: useQuickCustomer ? current.customerId : undefined,
                  quickCustomer: useQuickCustomer
                    ? undefined
                    : {
                        addressLine1: current.addressLine1,
                        addressLine2: current.addressLine2,
                        email: '',
                        name: '',
                        phone: '',
                        postcode: current.postcode,
                        state: current.state,
                        suburb: current.suburb,
                      },
                }));
              }}
            />
          ) : null}
          {!useQuickCustomer ? (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.pickerRow}>
                  {customers.map((customer) => (
                    <Chip
                      active={form.customerId === customer.id}
                      key={customer.id}
                      label={customer.displayName}
                      onPress={() => {
                        update('customerId', customer.id);
                        update('addressLine1', customer.addressLine1 ?? '');
                        update('addressLine2', customer.addressLine2 ?? '');
                        update('suburb', customer.suburb ?? '');
                        update('state', customer.state ?? 'NSW');
                        update('postcode', customer.postcode ?? '');
                      }}
                    />
                  ))}
                </View>
              </ScrollView>
              {errors.customerId ? (
                <Text style={styles.error}>{errors.customerId}</Text>
              ) : null}
              {selectedCustomer ? (
                <Text style={styles.muted}>
                  Selected: {selectedCustomer.displayName}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <Field
                error={errors.quickCustomerName}
                label="Customer name"
                onChangeText={(value) =>
                  setForm((current) => ({
                    ...current,
                    quickCustomer: {
                      ...(current.quickCustomer ?? {
                        addressLine1: '',
                        email: '',
                        name: '',
                        phone: '',
                        postcode: '',
                        state: 'NSW',
                        suburb: '',
                      }),
                      name: value,
                    },
                  }))
                }
                value={form.quickCustomer?.name ?? ''}
              />
              <Field
                autoCapitalize="none"
                autoComplete="email"
                error={errors.quickCustomerEmail}
                keyboardType="email-address"
                label="Email address"
                onChangeText={(value) =>
                  setForm((current) => ({
                    ...current,
                    quickCustomer: {
                      ...(current.quickCustomer ?? {
                        addressLine1: '',
                        email: '',
                        name: '',
                        phone: '',
                        postcode: '',
                        state: 'NSW',
                        suburb: '',
                      }),
                      email: value,
                    },
                  }))
                }
                textContentType="emailAddress"
                value={form.quickCustomer?.email ?? ''}
              />
              <Field
                error={errors.quickCustomerPhone}
                keyboardType="phone-pad"
                label="Phone"
                onChangeText={(value) =>
                  setForm((current) => ({
                    ...current,
                    quickCustomer: {
                      ...(current.quickCustomer ?? {
                        addressLine1: '',
                        email: '',
                        name: '',
                        phone: '',
                        postcode: '',
                        state: 'NSW',
                        suburb: '',
                      }),
                      phone: value,
                    },
                  }))
                }
                value={form.quickCustomer?.phone ?? ''}
              />
              <Text style={styles.muted}>
                The address below will be saved to the new customer and job.
              </Text>
            </>
          )}
        </Section>

        <Section title="Basics">
          <Field
            error={errors.title}
            label="Title"
            onChangeText={(value) => update('title', value)}
            value={form.title}
          />
          <Field
            label="Trade type"
            onChangeText={(value) => update('tradeType', value)}
            value={form.tradeType ?? ''}
          />
          <Field
            label="Description"
            multiline
            onChangeText={(value) => update('description', value)}
            value={form.description ?? ''}
          />
          <Picker
            label="Status"
            options={statuses}
            selected={form.status}
            onSelect={(value) => update('status', value)}
          />
          <Picker
            label="Priority"
            options={priorities}
            selected={form.priority}
            onSelect={(value) => update('priority', value)}
          />
        </Section>

        <Section title="Schedule">
          <ScheduleDateTimeField
            error={errors.scheduledStart}
            label="Scheduled start"
            onPress={() => setPicker({ field: 'scheduledStart', mode: 'date' })}
            timezone={businessTimezone}
            value={form.scheduledStart}
          />
          <ScheduleDateTimeField
            error={errors.scheduledEnd}
            label="Scheduled end"
            onPress={() => setPicker({ field: 'scheduledEnd', mode: 'date' })}
            timezone={businessTimezone}
            value={form.scheduledEnd ?? ''}
          />
          {picker ? (
            <View style={styles.pickerContainer}>
              <DateTimePicker
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                mode={picker.mode}
                onChange={handlePickerChange}
                value={dateFromFormValue(form[picker.field])}
              />
              {Platform.OS === 'ios' ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={completeIosPickerStep}
                  style={styles.doneButton}
                >
                  <Text style={styles.doneText}>
                    {picker.mode === 'date' ? 'Next: time' : 'Done'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <Field
            keyboardType="number-pad"
            label="Estimated duration minutes"
            onChangeText={(value) =>
              update('estimatedDurationMinutes', value ? Number(value) : null)
            }
            value={String(form.estimatedDurationMinutes ?? '')}
          />
        </Section>

        <Section title="Address">
          <AddressAutocompleteInput
            error={errors.addressLine1}
            label="Address line 1"
            onChangeText={(value) => update('addressLine1', value)}
            onSelectSuggestion={applyAddressSuggestion}
            value={form.addressLine1}
          />
          <Field
            label="Address line 2"
            onChangeText={(value) => update('addressLine2', value)}
            value={form.addressLine2 ?? ''}
          />
          <Field
            error={errors.suburb}
            label="Suburb"
            onChangeText={(value) => update('suburb', value)}
            value={form.suburb}
          />
          <Picker
            label="State"
            options={['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']}
            selected={form.state}
            onSelect={(value) => update('state', value)}
          />
          <Field
            error={errors.postcode}
            keyboardType="number-pad"
            label="Postcode"
            onChangeText={(value) => update('postcode', value)}
            value={form.postcode}
          />
          <Field
            label="Access instructions"
            multiline
            onChangeText={(value) => update('accessInstructions', value)}
            value={form.accessInstructions ?? ''}
          />
        </Section>

        <Section title="Assignment">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.pickerRow}>
              <Chip
                active={!form.assignedToUserId}
                label="Unassigned"
                onPress={() => update('assignedToUserId', null)}
              />
              {members.map((member) => (
                <Chip
                  active={form.assignedToUserId === member.userId}
                  key={member.id}
                  label={member.name}
                  onPress={() =>
                    update('assignedToUserId', member.userId ?? '')
                  }
                />
              ))}
            </View>
          </ScrollView>
        </Section>

        <Section title="Notes and follow-up">
          <Field
            label="Customer notes"
            multiline
            onChangeText={(value) => update('customerNotes', value)}
            value={form.customerNotes ?? ''}
          />
          <Field
            label="Internal notes"
            multiline
            onChangeText={(value) => update('internalNotes', value)}
            value={form.internalNotes ?? ''}
          />
          <View style={styles.requirementsRow}>
            <Toggle
              active={Boolean(form.requiresQuote)}
              label="Requires quote"
              onPress={() => update('requiresQuote', !form.requiresQuote)}
            />
            <Toggle
              active={Boolean(form.requiresInvoice)}
              label="Requires invoice"
              onPress={() => update('requiresInvoice', !form.requiresInvoice)}
            />
          </View>
        </Section>

        <Pressable
          disabled={isSaving}
          onPress={() => void save()}
          style={styles.saveButton}
        >
          {isSaving ? <ActivityIndicator color="#FFFFFF" /> : null}
          <Text style={styles.saveText}>
            {isSaving ? 'Saving job...' : 'Save job'}
          </Text>
        </Pressable>

        {createdJobPrompt ? (
          <View style={styles.promptCard}>
            <Text style={styles.promptTitle}>Job created successfully.</Text>
            <Text style={styles.muted}>Schedule an appointment now?</Text>
            <View style={styles.promptActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  navigation.replace('AppointmentForm', {
                    customerId: createdJobPrompt.customerId,
                    jobId: createdJobPrompt.jobId,
                  })
                }
                style={styles.promptPrimary}
              >
                <Text style={styles.promptPrimaryText}>Schedule Now</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  navigation.replace('JobDetails', {
                    jobId: createdJobPrompt.jobId,
                  })
                }
                style={styles.promptSecondary}
              >
                <Text style={styles.promptSecondaryText}>Later</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
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

function Field({
  autoCapitalize,
  autoComplete,
  error,
  keyboardType,
  label,
  multiline,
  onChangeText,
  textContentType,
  value,
}: {
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoComplete?: 'email';
  error?: string;
  keyboardType?: 'default' | 'email-address' | 'number-pad' | 'phone-pad';
  label: string;
  multiline?: boolean;
  onChangeText(value: string): void;
  textContentType?: 'emailAddress';
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={label}
        placeholderTextColor={colours.muted}
        style={[
          styles.input,
          multiline && styles.textarea,
          error && styles.inputError,
        ]}
        textContentType={textContentType}
        value={value}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function ScheduleDateTimeField({
  error,
  label,
  onPress,
  timezone,
  value,
}: {
  error?: string;
  label: string;
  onPress(): void;
  timezone: string;
  value?: string | null;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityLabel={`${label}. ${humanDateTime(value, timezone)}`}
        accessibilityRole="button"
        onPress={onPress}
        style={[styles.inputButton, error && styles.inputError]}
      >
        <Text style={styles.inputButtonText}>
          {humanDateTime(value, timezone)}
        </Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function Picker({
  label: rowLabel,
  onSelect,
  options,
  selected,
}: {
  label: string;
  onSelect(value: string): void;
  options: readonly string[];
  selected: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{rowLabel}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.pickerRow}>
          {options.map((option) => (
            <Chip
              active={selected === option}
              key={option}
              label={label(option)}
              onPress={() => onSelect(option)}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function Chip({
  active,
  label: text,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityState={{ selected: active }}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {text}
      </Text>
    </Pressable>
  );
}

function Toggle({
  active,
  label: text,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityState={{ selected: active }}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.toggle, active && styles.toggleActive]}
    >
      <Text style={[styles.toggleText, active && styles.toggleTextActive]}>
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: colours.primary },
  chipText: { color: colours.muted, fontWeight: '800' },
  chipTextActive: { color: '#FFFFFF' },
  container: {
    backgroundColor: colours.background,
    padding: 24,
    paddingBottom: 44,
  },
  error: { color: '#BE123C', fontWeight: '700', marginTop: 4 },
  doneButton: {
    alignSelf: 'flex-end',
    backgroundColor: colours.secondaryActionSurface,
    borderColor: colours.primary,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  doneText: { color: colours.primary, fontWeight: '900' },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  field: { gap: 6, marginTop: 12 },
  flex: { backgroundColor: colours.background, flex: 1 },
  input: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colours.ink,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputButton: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputButtonText: {
    color: colours.ink,
    fontSize: 16,
    fontWeight: '700',
  },
  inputError: { borderColor: '#E11D48', borderWidth: 2 },
  label: { color: colours.ink, fontWeight: '800' },
  loadingPage: {
    alignItems: 'center',
    backgroundColor: colours.background,
    flex: 1,
    gap: 12,
    justifyContent: 'center',
  },
  muted: { color: colours.muted, lineHeight: 21, marginTop: 8 },
  pickerRow: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  pickerContainer: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
  promptActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  promptCard: {
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 16,
    padding: 16,
  },
  promptPrimary: {
    backgroundColor: colours.primary,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  promptPrimaryText: { color: '#FFFFFF', fontWeight: '900' },
  promptSecondary: {
    backgroundColor: '#FFFFFF',
    borderColor: '#C7D2FE',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  promptSecondaryText: { color: colours.primary, fontWeight: '900' },
  promptTitle: { color: colours.ink, fontSize: 18, fontWeight: '900' },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colours.primary,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 20,
    padding: 14,
  },
  saveText: { color: '#FFFFFF', fontWeight: '900' },
  section: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 16,
    padding: 16,
  },
  sectionTitle: { color: colours.ink, fontSize: 18, fontWeight: '900' },
  subtitle: { color: colours.muted, lineHeight: 22, marginTop: 8 },
  textarea: { minHeight: 100, textAlignVertical: 'top' },
  title: { color: colours.ink, fontSize: 32, fontWeight: '900', marginTop: 4 },
  requirementsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
  },
  toggle: {
    alignItems: 'center',
    backgroundColor: colours.secondaryActionSurface,
    borderColor: '#C7D2FE',
    borderRadius: 999,
    borderWidth: 1,
    flexBasis: 140,
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  toggleActive: {
    backgroundColor: colours.primary,
    borderColor: colours.primary,
  },
  toggleText: { color: colours.primary, fontWeight: '900' },
  toggleTextActive: { color: '#FFFFFF' },
});
