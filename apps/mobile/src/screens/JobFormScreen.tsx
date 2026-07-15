import type {
  Customer,
  JobPayload,
  JobPriority,
  JobStatus,
  TeamMember,
} from '@tradieos/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { useToast } from '../components/ToastProvider';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'JobForm'>;

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
  const { token } = useAuth();
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
    <ScrollView contentContainerStyle={styles.container}>
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
              error={errors.quickCustomerPhone}
              keyboardType="phone-pad"
              label="Phone"
              onChangeText={(value) =>
                setForm((current) => ({
                  ...current,
                  quickCustomer: {
                    ...(current.quickCustomer ?? {
                      addressLine1: '',
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
        <Field
          error={errors.scheduledStart}
          label="Scheduled start"
          onChangeText={(value) => update('scheduledStart', value)}
          value={form.scheduledStart}
        />
        <Field
          error={errors.scheduledEnd}
          label="Scheduled end"
          onChangeText={(value) => update('scheduledEnd', value)}
          value={form.scheduledEnd ?? ''}
        />
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
        <Field
          error={errors.addressLine1}
          label="Address line 1"
          onChangeText={(value) => update('addressLine1', value)}
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
                onPress={() => update('assignedToUserId', member.userId ?? '')}
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
  error,
  keyboardType,
  label,
  multiline,
  onChangeText,
  value,
}: {
  error?: string;
  keyboardType?: 'default' | 'number-pad' | 'phone-pad';
  label: string;
  multiline?: boolean;
  onChangeText(value: string): void;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
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
        value={value}
      />
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
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.toggle, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
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
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  field: { gap: 6, marginTop: 12 },
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
  toggle: {
    alignSelf: 'flex-start',
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
