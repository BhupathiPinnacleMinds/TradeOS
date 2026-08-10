import { usePreventRemove } from '@react-navigation/native';
import type { NavigationAction } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type {
  Customer,
  Job,
  QuoteLineItemType,
  QuoteLineItemPayload,
  QuotePayload,
} from '@tradieos/shared';
import {
  calculateQuoteTotals,
  createUnsavedChangesNavigationGuard,
  formatAudCents,
  parseQuoteMoneyInput,
  parseQuoteQuantityInput,
  roleCanCreateQuotes,
} from '@tradieos/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
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
  createQuoteRequest,
  customerDetailRequest,
  customersRequest,
  jobsRequest,
  quoteDetailRequest,
  updateQuoteRequest,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'QuoteForm'>;
type FormLineItem = Omit<
  QuoteLineItemPayload,
  'quantity' | 'unitPriceCents'
> & {
  quantityInput: string;
  unitPriceInput: string;
};

const units = ['hour', 'item', 'metre', 'square metre', 'litre', 'fixed'];

export function QuoteFormScreen({ navigation, route }: Props) {
  const { appointmentId, customerId, customerSiteId, jobId, quoteId } =
    route.params ?? {};
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const canCreateQuote = roleCanCreateQuotes(user?.role ?? 'READ_ONLY');
  const [step, setStep] = useState(0);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(
    customerId ?? '',
  );
  const [selectedJobId, setSelectedJobId] = useState(jobId ?? '');
  const [selectedSiteId, setSelectedSiteId] = useState(customerSiteId ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString());
  const [expiryDate, setExpiryDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 14);
    return date.toISOString();
  });
  const [pricingMode, setPricingMode] =
    useState<QuotePayload['pricingMode']>('GST_EXCLUSIVE');
  const [discountType, setDiscountType] =
    useState<QuotePayload['discountType']>('NONE');
  const [discountValue, setDiscountValue] = useState('0');
  const [depositType, setDepositType] =
    useState<QuotePayload['depositType']>('NONE');
  const [depositValue, setDepositValue] = useState('0');
  const [customerNotes, setCustomerNotes] = useState('');
  const [termsAndConditions, setTermsAndConditions] = useState(
    'Quote valid until the expiry date. Work will be scheduled after acceptance.',
  );
  const [lineItems, setLineItems] = useState<FormLineItem[]>([
    {
      name: 'Labour',
      quantityInput: '1',
      taxable: true,
      type: 'LABOUR',
      unit: 'hour',
      unitPriceInput: '120.00',
    },
  ]);
  const [isLoading, setIsLoading] = useState(Boolean(quoteId));
  const [isSaving, setIsSaving] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const cleanSnapshotRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const savedRef = useRef(false);
  const mountedRef = useRef(true);
  const navigationRef = useRef(navigation);
  const guardRef = useRef(
    createUnsavedChangesNavigationGuard<NavigationAction>({
      dispatch(action) {
        navigationRef.current.dispatch(action);
      },
      getHasSaved() {
        return savedRef.current;
      },
      getIsDirty() {
        return dirtyRef.current;
      },
      getIsMounted() {
        return mountedRef.current;
      },
      getIsSaving() {
        return savingRef.current;
      },
      onBeforeConfirmation() {
        Keyboard.dismiss();
      },
      requestConfirmation({ leave, stay }) {
        Alert.alert(
          'Leave quote?',
          'You have unsaved quote details. Leave without saving?',
          [
            { onPress: stay, style: 'cancel', text: 'Stay' },
            { onPress: leave, style: 'destructive', text: 'Leave' },
          ],
          { onDismiss: stay },
        );
      },
    }),
  );

  const selectedCustomer = customers.find(
    (customer) => customer.id === selectedCustomerId,
  );
  const selectedJob = jobs.find((job) => job.id === selectedJobId);
  const selectedSite = selectedCustomer?.sites.find(
    (site) => site.id === selectedSiteId,
  );
  const parsedLineItems = useMemo(() => parseLineItems(lineItems), [lineItems]);
  const calculations = useMemo(
    () =>
      calculateQuoteTotals({
        depositType,
        depositValue: safeIntegerInput(depositValue),
        discountType,
        discountValue: safeIntegerInput(discountValue),
        lineItems: parsedLineItems.validItems,
        pricingMode,
      }),
    [
      depositType,
      depositValue,
      discountType,
      discountValue,
      parsedLineItems.validItems,
      pricingMode,
    ],
  );
  const snapshot = useMemo(
    () =>
      JSON.stringify({
        customerNotes,
        depositType,
        depositValue,
        description,
        discountType,
        discountValue,
        expiryDate,
        issueDate,
        lineItems,
        pricingMode,
        selectedCustomerId,
        selectedJobId,
        selectedSiteId,
        termsAndConditions,
        title,
      }),
    [
      customerNotes,
      depositType,
      depositValue,
      description,
      discountType,
      discountValue,
      expiryDate,
      issueDate,
      lineItems,
      pricingMode,
      selectedCustomerId,
      selectedJobId,
      selectedSiteId,
      termsAndConditions,
      title,
    ],
  );

  useEffect(() => {
    navigationRef.current = navigation;
  }, [navigation]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      guardRef.current.cleanup();
    };
  }, []);

  useEffect(() => {
    savingRef.current = isSaving;
  }, [isSaving]);

  useEffect(() => {
    savedRef.current = hasSaved;
  }, [hasSaved]);

  useEffect(() => {
    dirtyRef.current =
      !isLoading && !hasSaved && cleanSnapshotRef.current !== snapshot;
  }, [hasSaved, isLoading, snapshot]);

  usePreventRemove(dirtyRef.current && !hasSaved && !isSaving, ({ data }) => {
    guardRef.current.handlePreventedAction(data.action as NavigationAction);
  });

  useEffect(() => {
    if (!token || !canCreateQuote) return;
    const authToken = token;
    let mounted = true;
    async function load() {
      setIsLoading(true);
      try {
        const [customerResponse, jobResponse] = await Promise.all([
          customersRequest(authToken, {
            page: 1,
            pageSize: 100,
            sortBy: 'displayName',
          }),
          jobsRequest(authToken, { page: 1, pageSize: 100 }),
        ]);
        if (!mounted) return;
        setCustomers(customerResponse.records);
        setJobs(jobResponse.records);
        if (customerId) {
          const detail = await customerDetailRequest(authToken, customerId);
          if (!mounted) return;
          setCustomers((current) => [
            detail.customer,
            ...current.filter((customer) => customer.id !== detail.customer.id),
          ]);
        }
        if (quoteId) {
          const response = await quoteDetailRequest(authToken, quoteId);
          if (!mounted) return;
          const quote = response.quote;
          setSelectedCustomerId(quote.customerId);
          setSelectedJobId(quote.jobId ?? '');
          setSelectedSiteId(quote.customerSiteId ?? '');
          setTitle(quote.title);
          setDescription(quote.description ?? '');
          setIssueDate(quote.issueDate);
          setExpiryDate(quote.expiryDate ?? '');
          setPricingMode(quote.pricingMode);
          setDiscountType(quote.discountType ?? 'NONE');
          setDiscountValue(String(quote.discountValue ?? 0));
          setDepositType(quote.depositType ?? 'NONE');
          setDepositValue(String(quote.depositValue));
          setCustomerNotes(quote.customerNotes ?? '');
          setTermsAndConditions(quote.termsAndConditions ?? '');
          setLineItems(
            quote.lineItems.map((item) => ({
              description: item.description ?? undefined,
              name: item.name,
              quantityInput: item.quantity,
              taxable: item.taxable,
              type: item.type,
              unit: item.unit,
              unitPriceInput: centsToMoneyInput(item.unitPriceCents),
            })),
          );
          navigation.setOptions({ title: `Edit ${quote.quoteNumber}` });
        } else {
          navigation.setOptions({ title: 'New quote' });
        }
      } catch (error) {
        showToast({
          message:
            error instanceof Error
              ? error.message
              : "We couldn't prepare the quote form.",
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
  }, [canCreateQuote, customerId, navigation, quoteId, showToast, token]);

  useEffect(() => {
    if (!isLoading && cleanSnapshotRef.current === null) {
      cleanSnapshotRef.current = snapshot;
    }
  }, [isLoading, snapshot]);

  function updateLine(index: number, patch: Partial<FormLineItem>) {
    setLineItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  }

  function addLine() {
    setLineItems((current) => [
      ...current,
      {
        name: 'New item',
        quantityInput: '1',
        taxable: true,
        type: 'SERVICE',
        unit: 'item',
        unitPriceInput: '0.00',
      },
    ]);
  }

  async function save(sendAfterSave = false) {
    if (!token || isSaving || savingRef.current) return;
    const validationError = validateBeforeSave({
      hasLineItems: lineItems.length > 0,
      lineItems: parsedLineItems,
      selectedCustomerId,
      title,
    });
    if (validationError) {
      setStep(validationError.step);
      showToast({
        message: validationError.message,
        tone: 'error',
      });
      return;
    }
    setIsSaving(true);
    try {
      const payload: QuotePayload = {
        customerId: selectedCustomerId,
        customerNotes,
        customerSiteId: selectedSiteId || undefined,
        depositType,
        depositValue: safeIntegerInput(depositValue),
        description,
        discountType,
        discountValue: safeIntegerInput(discountValue),
        expiryDate: expiryDate || undefined,
        issueDate,
        jobId: selectedJobId || undefined,
        lineItems: parsedLineItems.validItems,
        pricingMode,
        sourceAppointmentId: appointmentId || undefined,
        termsAndConditions,
        title,
      };
      const response = quoteId
        ? await updateQuoteRequest(token, quoteId, payload)
        : await createQuoteRequest(token, payload);
      savedRef.current = true;
      setHasSaved(true);
      showToast({
        message: sendAfterSave
          ? 'Draft saved. Open the quote to send.'
          : `${response.quote.quoteNumber} saved as draft.`,
        tone: 'success',
      });
      navigation.replace('QuoteDetails', { quoteId: response.quote.id });
    } catch (error) {
      showToast({
        message:
          error instanceof Error
            ? error.message
            : "We couldn't save this quote.",
        tone: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  }

  function goNext() {
    const validationError = validateStep({
      lineItems: parsedLineItems,
      selectedCustomerId,
      step,
      title,
    });
    if (validationError) {
      setStep(validationError.step);
      showToast({ message: validationError.message, tone: 'error' });
      return;
    }
    setStep((current) => Math.min(3, current + 1));
  }

  if (!canCreateQuote) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Quote creation unavailable</Text>
        <Text style={styles.muted}>
          You don&apos;t have permission to create quotes.
        </Text>
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colours.primary} />
        <Text style={styles.muted}>Preparing quote form...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.page}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>STEP {step + 1} OF 4</Text>
        <Text style={styles.title}>{quoteId ? 'Edit quote' : 'New quote'}</Text>
        <StepTabs step={step} setStep={setStep} />

        {step === 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Customer and scope</Text>
            <Picker
              label="Customer"
              options={customers.map((customer) => ({
                label: customer.displayName,
                value: customer.id,
              }))}
              value={selectedCustomerId}
              onChange={setSelectedCustomerId}
            />
            {selectedCustomer?.sites.length ? (
              <Picker
                label="Service site"
                options={[
                  { label: 'No site selected', value: '' },
                  ...selectedCustomer.sites.map((site) => ({
                    label: `${site.label} · ${site.suburb}`,
                    value: site.id,
                  })),
                ]}
                value={selectedSiteId}
                onChange={setSelectedSiteId}
              />
            ) : null}
            <Picker
              label="Linked job"
              options={[
                { label: 'No linked job', value: '' },
                ...jobs
                  .filter(
                    (job) =>
                      !selectedCustomerId ||
                      job.customerId === selectedCustomerId,
                  )
                  .map((job) => ({
                    label: `${job.jobNumber} · ${job.title}`,
                    value: job.id,
                  })),
              ]}
              value={selectedJobId}
              onChange={setSelectedJobId}
            />
            <Field label="Title" value={title} onChangeText={setTitle} />
            <Field
              label="Description"
              multiline
              value={description}
              onChangeText={setDescription}
            />
          </View>
        ) : null}

        {step === 1 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Line items</Text>
            {lineItems.map((item, index) => (
              <View key={index} style={styles.lineEditor}>
                <Field
                  label="Name"
                  value={item.name}
                  onChangeText={(value) => updateLine(index, { name: value })}
                />
                <Field
                  label="Quantity"
                  keyboardType="decimal-pad"
                  error={parsedLineItems.errors[index]?.quantity ?? null}
                  value={item.quantityInput}
                  onChangeText={(value) =>
                    updateLine(index, { quantityInput: value })
                  }
                />
                <Picker
                  label="Unit"
                  options={units.map((unit) => ({ label: unit, value: unit }))}
                  value={item.unit}
                  onChange={(unit) => updateLine(index, { unit })}
                />
                <Field
                  label="Unit price"
                  keyboardType="decimal-pad"
                  error={parsedLineItems.errors[index]?.unitPrice ?? null}
                  value={item.unitPriceInput}
                  onChangeText={(value) =>
                    updateLine(index, { unitPriceInput: value })
                  }
                />
                <Pressable
                  onPress={() => updateLine(index, { taxable: !item.taxable })}
                  style={styles.toggle}
                >
                  <Text style={styles.toggleText}>
                    {item.taxable ? 'Taxable' : 'Non-taxable'}
                  </Text>
                </Pressable>
              </View>
            ))}
            <Pressable onPress={addLine} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Add line item</Text>
            </Pressable>
          </View>
        ) : null}

        {step === 2 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>GST, discount and deposit</Text>
            <Picker
              label="Pricing mode"
              options={[
                { label: 'GST exclusive', value: 'GST_EXCLUSIVE' },
                { label: 'GST inclusive', value: 'GST_INCLUSIVE' },
              ]}
              value={pricingMode}
              onChange={(value) =>
                setPricingMode(value as QuotePayload['pricingMode'])
              }
            />
            <Picker
              label="Discount"
              options={[
                { label: 'No discount', value: 'NONE' },
                { label: 'Fixed cents', value: 'FIXED' },
                { label: 'Percentage basis points', value: 'PERCENTAGE' },
              ]}
              value={discountType ?? 'NONE'}
              onChange={(value) =>
                setDiscountType(value as QuotePayload['discountType'])
              }
            />
            <Field
              label="Discount value"
              keyboardType="number-pad"
              value={discountValue}
              onChangeText={setDiscountValue}
            />
            <Picker
              label="Deposit"
              options={[
                { label: 'No deposit', value: 'NONE' },
                { label: 'Fixed cents', value: 'FIXED' },
                { label: 'Percentage basis points', value: 'PERCENTAGE' },
              ]}
              value={depositType ?? 'NONE'}
              onChange={(value) =>
                setDepositType(value as QuotePayload['depositType'])
              }
            />
            <Field
              label="Deposit value"
              keyboardType="number-pad"
              value={depositValue}
              onChangeText={setDepositValue}
            />
            <Field
              label="Customer notes"
              multiline
              value={customerNotes}
              onChangeText={setCustomerNotes}
            />
            <Field
              label="Terms"
              multiline
              value={termsAndConditions}
              onChangeText={setTermsAndConditions}
            />
          </View>
        ) : null}

        {step === 3 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Review totals</Text>
            <Review
              label="Customer"
              value={selectedCustomer?.displayName ?? 'Not selected'}
            />
            <Review
              label="Site"
              value={selectedSite?.label ?? 'No site selected'}
            />
            <Review
              label="Job"
              value={selectedJob?.jobNumber ?? 'No job linked'}
            />
            <Review
              label="Subtotal"
              value={formatAudCents(calculations.subtotalCents)}
            />
            <Review
              label="Discount"
              value={formatAudCents(calculations.discountCents)}
            />
            <Review label="GST" value={formatAudCents(calculations.gstCents)} />
            <Review
              label="Total"
              value={formatAudCents(calculations.totalCents)}
              strong
            />
            <Review
              label="Deposit"
              value={formatAudCents(calculations.depositCents)}
            />
          </View>
        ) : null}

        <View style={styles.footer}>
          <Pressable
            disabled={step === 0}
            onPress={() => setStep((current) => Math.max(0, current - 1))}
            style={[styles.secondaryButton, step === 0 && styles.disabled]}
          >
            <Text style={styles.secondaryButtonText}>Back</Text>
          </Pressable>
          {step < 3 ? (
            <Pressable onPress={goNext} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Next</Text>
            </Pressable>
          ) : (
            <Pressable
              disabled={isSaving}
              onPress={() => void save()}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>
                {isSaving ? 'Saving...' : 'Save draft'}
              </Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function parseLineItems(lineItems: FormLineItem[]) {
  const errors: Array<{ quantity: string | null; unitPrice: string | null }> =
    [];
  const validItems: QuoteLineItemPayload[] = [];

  lineItems.forEach((item) => {
    const quantity = parseQuoteQuantityInput(item.quantityInput);
    const unitPrice = parseQuoteMoneyInput(item.unitPriceInput);
    errors.push({
      quantity: quantity.error,
      unitPrice: unitPrice.error,
    });
    if (quantity.value && unitPrice.value !== null) {
      validItems.push({
        description: item.description,
        id: item.id,
        name: item.name,
        quantity: quantity.value,
        taxable: item.taxable,
        type: item.type as QuoteLineItemType,
        unit: item.unit,
        unitPriceCents: unitPrice.value,
      });
    }
  });

  return { errors, validItems };
}

function validateBeforeSave({
  hasLineItems,
  lineItems,
  selectedCustomerId,
  title,
}: {
  hasLineItems: boolean;
  lineItems: ReturnType<typeof parseLineItems>;
  selectedCustomerId: string;
  title: string;
}) {
  if (!selectedCustomerId) {
    return { message: 'Select a customer.', step: 0 };
  }
  if (!title.trim()) {
    return { message: 'Enter a quote title.', step: 0 };
  }
  if (!hasLineItems) {
    return { message: 'Add at least one line item.', step: 1 };
  }
  const firstInvalidLineIndex = lineItems.errors.findIndex(
    (error) => error.quantity || error.unitPrice,
  );
  if (firstInvalidLineIndex >= 0) {
    const error = lineItems.errors[firstInvalidLineIndex]!;
    return {
      message:
        error.quantity ??
        error.unitPrice ??
        'Check the first invalid line item.',
      step: 1,
    };
  }
  if (lineItems.validItems.length < lineItems.errors.length) {
    return { message: 'Complete each line item before saving.', step: 1 };
  }
  return null;
}

function validateStep({
  lineItems,
  selectedCustomerId,
  step,
  title,
}: {
  lineItems: ReturnType<typeof parseLineItems>;
  selectedCustomerId: string;
  step: number;
  title: string;
}) {
  if (step === 0) {
    if (!selectedCustomerId) return { message: 'Select a customer.', step: 0 };
    if (!title.trim()) return { message: 'Enter a quote title.', step: 0 };
  }
  if (step === 1) {
    const firstInvalidLineIndex = lineItems.errors.findIndex(
      (error) => error.quantity || error.unitPrice,
    );
    if (firstInvalidLineIndex >= 0) {
      const error = lineItems.errors[firstInvalidLineIndex]!;
      return {
        message:
          error.quantity ??
          error.unitPrice ??
          'Check the first invalid line item.',
        step: 1,
      };
    }
    if (lineItems.validItems.length < lineItems.errors.length) {
      return { message: 'Complete each line item before continuing.', step: 1 };
    }
  }
  return null;
}

function centsToMoneyInput(cents: number) {
  return `${Math.floor(cents / 100)}.${String(Math.abs(cents % 100)).padStart(
    2,
    '0',
  )}`;
}

function safeIntegerInput(value: string) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function StepTabs({
  setStep,
  step,
}: {
  setStep(step: number): void;
  step: number;
}) {
  return (
    <View style={styles.steps}>
      {['Scope', 'Items', 'Terms', 'Review'].map((label, index) => (
        <Pressable
          key={label}
          onPress={() => setStep(index)}
          style={[styles.stepPill, step === index && styles.stepPillActive]}
        >
          <Text
            style={[
              styles.stepPillText,
              step === index && styles.stepPillTextActive,
            ]}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Field({
  error,
  label,
  ...props
}: {
  error?: string | null;
  keyboardType?: 'decimal-pad' | 'number-pad';
  label: string;
  multiline?: boolean;
  onChangeText(value: string): void;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={colours.muted}
        style={[
          styles.input,
          props.multiline && styles.textArea,
          error && styles.inputError,
        ]}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

function Picker({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange(value: string): void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.options}>
          {options.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              style={[
                styles.option,
                value === option.value && styles.optionActive,
              ]}
            >
              <Text
                style={[
                  styles.optionText,
                  value === option.value && styles.optionTextActive,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function Review({
  label,
  strong,
  value,
}: {
  label: string;
  strong?: boolean;
  value: string;
}) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={[styles.reviewValue, strong && styles.reviewStrong]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    backgroundColor: colours.background,
    flex: 1,
    gap: 12,
    justifyContent: 'center',
  },
  container: { gap: 16, padding: 20, paddingBottom: 40 },
  disabled: { opacity: 0.4 },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  field: { gap: 8 },
  fieldError: { color: '#DC2626', fontSize: 12, fontWeight: '700' },
  footer: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    color: colours.ink,
    padding: 13,
  },
  inputError: { borderColor: '#DC2626' },
  label: { color: colours.ink, fontWeight: '800' },
  lineEditor: {
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  muted: { color: colours.muted, lineHeight: 20 },
  option: {
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  optionActive: {
    backgroundColor: colours.primary,
    borderColor: colours.primary,
  },
  optionText: { color: colours.muted, fontWeight: '800' },
  optionTextActive: { color: '#FFFFFF' },
  options: { flexDirection: 'row', gap: 8, paddingRight: 20 },
  page: { backgroundColor: colours.background, flex: 1 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colours.primary,
    borderRadius: 18,
    flex: 1,
    padding: 14,
  },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '900' },
  reviewRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  reviewStrong: { fontSize: 20 },
  reviewValue: { color: colours.ink, fontWeight: '900', textAlign: 'right' },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    padding: 14,
  },
  secondaryButtonText: { color: colours.ink, fontWeight: '900' },
  section: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  sectionTitle: { color: colours.ink, fontSize: 18, fontWeight: '900' },
  stepPill: {
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  stepPillActive: { backgroundColor: colours.ink, borderColor: colours.ink },
  stepPillText: { color: colours.muted, fontWeight: '900' },
  stepPillTextActive: { color: '#FFFFFF' },
  steps: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  textArea: { minHeight: 92, textAlignVertical: 'top' },
  title: { color: colours.ink, fontSize: 28, fontWeight: '900' },
  errorTitle: { color: colours.ink, fontSize: 22, fontWeight: '900' },
  toggle: {
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: 14,
    padding: 12,
  },
  toggleText: { color: colours.ink, fontWeight: '900' },
});
