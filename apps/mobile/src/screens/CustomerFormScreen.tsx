import type {
  AustralianState,
  ContactPreference,
  CustomerDuplicateMatch,
  CustomerPayload,
  CustomerType,
} from '@tradieos/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ApiRequestError,
  createCustomerRequest,
  customerDetailRequest,
  updateCustomerRequest,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import { keyboardAvoidingBehavior } from '../components/keyboardAvoidance';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'CustomerForm'>;

const states: AustralianState[] = [
  'VIC',
  'NSW',
  'QLD',
  'SA',
  'WA',
  'TAS',
  'ACT',
  'NT',
];
const customerTypes: CustomerType[] = [
  'RESIDENTIAL',
  'COMMERCIAL',
  'REAL_ESTATE',
  'STRATA',
  'BUILDER',
  'OTHER',
];
const contactPreferences: ContactPreference[] = [
  'ANY',
  'SMS',
  'PHONE',
  'EMAIL',
];

function label(value: string) {
  return value.replaceAll('_', ' ');
}

function initialPayload(): CustomerPayload {
  return {
    contactPreference: 'ANY',
    customerType: 'RESIDENTIAL',
    tags: [],
  };
}

export function CustomerFormScreen({ navigation, route }: Props) {
  const customerId = route.params?.customerId;
  const { token } = useAuth();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState<CustomerPayload>(initialPayload());
  const [tagText, setTagText] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(Boolean(customerId));
  const [isSaving, setIsSaving] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<
    CustomerDuplicateMatch[] | null
  >(null);
  const [pendingPayload, setPendingPayload] = useState<CustomerPayload | null>(
    null,
  );

  useEffect(() => {
    navigation.setOptions({
      title: customerId ? 'Edit customer' : 'Add customer',
    });
  }, [customerId, navigation]);

  useEffect(() => {
    if (!token || !customerId) return;
    let mounted = true;
    setIsLoading(true);
    customerDetailRequest(token, customerId)
      .then(({ customer }) => {
        if (!mounted) return;
        setForm({
          addressLine1: customer.addressLine1 ?? undefined,
          addressLine2: customer.addressLine2 ?? undefined,
          alternatePhone: customer.alternatePhone ?? undefined,
          companyName: customer.companyName ?? undefined,
          contactPreference: customer.contactPreference,
          customerType: customer.customerType,
          email: customer.email ?? undefined,
          firstName: customer.firstName ?? undefined,
          lastName: customer.lastName ?? undefined,
          notes: customer.notes ?? undefined,
          phone: customer.phone ?? undefined,
          postcode: customer.postcode ?? undefined,
          state: customer.state ?? '',
          suburb: customer.suburb ?? undefined,
          tags: customer.tags,
        });
        setTagText(customer.tags.join(', '));
      })
      .catch(() => {
        showToast({
          message: "We couldn't load this customer.",
          tone: 'error',
        });
      })
      .finally(() => mounted && setIsLoading(false));
    return () => {
      mounted = false;
    };
  }, [customerId, showToast, token]);

  function update(key: keyof CustomerPayload, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: '' }));
  }

  function validate(input: CustomerPayload) {
    const next: Record<string, string> = {};
    if (!input.firstName?.trim() && !input.companyName?.trim()) {
      next.firstName = 'Enter a first name or company name.';
    }
    if (!input.email?.trim() && !input.phone?.trim()) {
      next.phone = 'Enter at least one phone or email.';
    }
    if (input.postcode && !/^\d{4}$/.test(input.postcode.trim())) {
      next.postcode = 'Postcode must be exactly 4 digits.';
    }
    if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
      next.email = 'Enter a valid email address.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function payload(allowDuplicate = false): CustomerPayload {
    return {
      ...form,
      allowDuplicate,
      email: form.email?.trim().toLowerCase(),
      tags: tagText
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    };
  }

  async function save(allowDuplicate = false) {
    if (!token || isSaving) return;
    const input = pendingPayload
      ? { ...pendingPayload, allowDuplicate }
      : payload(allowDuplicate);
    if (!validate(input)) {
      showToast({
        message: 'Please check the highlighted fields.',
        tone: 'error',
      });
      return;
    }

    setIsSaving(true);
    try {
      const response = customerId
        ? await updateCustomerRequest(token, customerId, input)
        : await createCustomerRequest(token, input);
      setDuplicateMatches(null);
      setPendingPayload(null);
      showToast({
        message: customerId
          ? `${response.customer.displayName}'s details were updated.`
          : `${response.customer.displayName} was added.`,
        tone: 'success',
      });
      navigation.replace('CustomerDetails', {
        customerId: response.customer.id,
      });
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.code === 'POSSIBLE_DUPLICATE_CUSTOMER'
      ) {
        const matches = Array.isArray(error.details.matches)
          ? (error.details.matches as CustomerDuplicateMatch[])
          : [];
        setDuplicateMatches(matches);
        setPendingPayload(input);
        showToast({ message: error.message, tone: 'warning' });
      } else {
        showToast({
          message:
            error instanceof Error
              ? error.message
              : "We couldn't save this customer.",
          tone: 'error',
        });
      }
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.loadingPage}>
        <ActivityIndicator color={colours.primary} />
        <Text style={styles.muted}>Loading customer...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={keyboardAvoidingBehavior}
      style={styles.flex}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingBottom: Math.max(insets.bottom + 96, 120) },
        ]}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>CUSTOMER DETAILS</Text>
        <Text style={styles.title}>
          {customerId ? 'Edit customer' : 'Add customer'}
        </Text>
        <Text style={styles.subtitle}>
          Store only real customer details. Jobs, quotes and invoices will link
          here later.
        </Text>

        <Section title="Identity">
          <Field
            error={errors.firstName}
            label="First name"
            onChangeText={(value) => update('firstName', value)}
            value={form.firstName ?? ''}
          />
          <Field
            label="Last name"
            onChangeText={(value) => update('lastName', value)}
            value={form.lastName ?? ''}
          />
          <Field
            label="Company name"
            onChangeText={(value) => update('companyName', value)}
            value={form.companyName ?? ''}
          />
        </Section>

        <Section title="Contact">
          <Field
            error={errors.email}
            keyboardType="email-address"
            label="Email"
            onChangeText={(value) => update('email', value)}
            value={form.email ?? ''}
          />
          <Field
            error={errors.phone}
            keyboardType="phone-pad"
            label="Phone"
            onChangeText={(value) => update('phone', value)}
            value={form.phone ?? ''}
          />
          <Field
            keyboardType="phone-pad"
            label="Alternate phone"
            onChangeText={(value) => update('alternatePhone', value)}
            value={form.alternatePhone ?? ''}
          />
          <PickerRow
            label="Preferred contact"
            options={contactPreferences}
            selected={form.contactPreference}
            onSelect={(value) =>
              setForm((current) => ({
                ...current,
                contactPreference: value as ContactPreference,
              }))
            }
          />
        </Section>

        <Section title="Address">
          <Field
            label="Address line 1"
            onChangeText={(value) => update('addressLine1', value)}
            value={form.addressLine1 ?? ''}
          />
          <Field
            label="Address line 2"
            onChangeText={(value) => update('addressLine2', value)}
            value={form.addressLine2 ?? ''}
          />
          <Field
            label="Suburb"
            onChangeText={(value) => update('suburb', value)}
            value={form.suburb ?? ''}
          />
          <PickerRow
            label="State"
            options={states}
            selected={form.state || 'NSW'}
            onSelect={(value) =>
              setForm((current) => ({
                ...current,
                state: value as AustralianState,
              }))
            }
          />
          <Field
            error={errors.postcode}
            keyboardType="number-pad"
            label="Postcode"
            onChangeText={(value) => update('postcode', value)}
            value={form.postcode ?? ''}
          />
        </Section>

        <Section title="Profile">
          <PickerRow
            label="Customer type"
            options={customerTypes}
            selected={form.customerType}
            onSelect={(value) =>
              setForm((current) => ({
                ...current,
                customerType: value as CustomerType,
              }))
            }
          />
          <Field
            label="Tags, comma separated"
            onChangeText={setTagText}
            value={tagText}
          />
          <Field
            label="Notes"
            multiline
            onChangeText={(value) => update('notes', value)}
            value={form.notes ?? ''}
          />
        </Section>

        <Pressable
          accessibilityLabel="Save customer"
          accessibilityRole="button"
          disabled={isSaving}
          onPress={() => void save()}
          style={[styles.saveButton, isSaving && styles.disabled]}
        >
          {isSaving ? <ActivityIndicator color="#FFFFFF" /> : null}
          <Text style={styles.saveText}>
            {isSaving ? 'Saving customer...' : 'Save customer'}
          </Text>
        </Pressable>
      </ScrollView>

      <DuplicateModal
        matches={duplicateMatches}
        onCancel={() => {
          setDuplicateMatches(null);
          setPendingPayload(null);
        }}
        onContinue={() => void save(true)}
        onView={(id) => {
          setDuplicateMatches(null);
          navigation.navigate('CustomerDetails', { customerId: id });
        }}
      />

      <SavingOverlay visible={isSaving} />
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
  error,
  label,
  multiline,
  onChangeText,
  value,
  keyboardType,
}: {
  error?: string;
  label: string;
  multiline?: boolean;
  onChangeText(value: string): void;
  value: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'number-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
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

function PickerRow({
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
            <Pressable
              accessibilityRole="button"
              key={option}
              onPress={() => onSelect(option)}
              style={[styles.chip, selected === option && styles.chipActive]}
            >
              <Text
                style={[
                  styles.chipText,
                  selected === option && styles.chipTextActive,
                ]}
              >
                {label(option)}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function DuplicateModal({
  matches,
  onCancel,
  onContinue,
  onView,
}: {
  matches: CustomerDuplicateMatch[] | null;
  onCancel(): void;
  onContinue(): void;
  onView(id: string): void;
}) {
  return (
    <Modal transparent visible={Boolean(matches)} animationType="fade">
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Possible duplicate customer</Text>
          <Text style={styles.modalBody}>
            A customer with this phone number or email may already exist.
          </Text>
          {matches?.map((match) => (
            <Pressable
              accessibilityRole="button"
              key={match.id}
              onPress={() => onView(match.id)}
              style={styles.matchCard}
            >
              <Text style={styles.matchTitle}>{match.displayName}</Text>
              <Text style={styles.muted}>{match.phone ?? match.email}</Text>
            </Pressable>
          ))}
          <View style={styles.modalActions}>
            <Pressable onPress={onCancel} style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={onContinue} style={styles.saveButton}>
              <Text style={styles.saveText}>Continue anyway</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SavingOverlay({ visible }: { visible: boolean }) {
  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={styles.loadingOverlay}>
        <View style={styles.loadingCard}>
          <ActivityIndicator color={colours.primary} size="large" />
          <Text style={styles.loadingText}>Saving customer...</Text>
        </View>
      </View>
    </Modal>
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
  container: { padding: 24, paddingBottom: 44 },
  disabled: { opacity: 0.65 },
  error: { color: '#BE123C', fontWeight: '700', marginTop: 4 },
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
  inputError: { borderColor: '#E11D48', borderWidth: 2 },
  label: { color: colours.ink, fontWeight: '800' },
  loadingCard: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderRadius: 24,
    gap: 14,
    maxWidth: 360,
    padding: 24,
    width: '100%',
  },
  loadingOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.32)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  loadingPage: {
    alignItems: 'center',
    backgroundColor: colours.background,
    flex: 1,
    gap: 12,
    justifyContent: 'center',
  },
  loadingText: { color: colours.ink, fontWeight: '900' },
  matchCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    marginTop: 10,
    padding: 12,
  },
  matchTitle: { color: colours.ink, fontWeight: '900' },
  modalActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 18,
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  modalBody: { color: colours.muted, lineHeight: 21, marginTop: 8 },
  modalCard: {
    backgroundColor: colours.card,
    borderRadius: 22,
    maxWidth: 520,
    padding: 20,
    width: '100%',
  },
  modalTitle: { color: colours.ink, fontSize: 22, fontWeight: '900' },
  muted: { color: colours.muted, marginTop: 8 },
  pickerRow: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colours.primary,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 20,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  saveText: { color: '#FFFFFF', fontWeight: '900' },
  secondaryButton: {
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryText: { color: colours.muted, fontWeight: '900' },
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
  textarea: { minHeight: 110, textAlignVertical: 'top' },
  title: { color: colours.ink, fontSize: 32, fontWeight: '900', marginTop: 4 },
});
