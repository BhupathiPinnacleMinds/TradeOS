import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type {
  Customer,
  InvoiceDiscountType,
  InvoiceDraftSourceQuote,
  InvoiceLineItemPayload,
  InvoicePayload,
  Job,
} from '@tradieos/shared';
import {
  calculateInvoiceTotals,
  formatAudCents,
  parseInvoiceMoneyInput,
  parseInvoiceQuantityInput,
  roleCanCreateInvoices,
} from '@tradieos/shared';
import type { ReactNode } from 'react';
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
  createInvoiceRequest,
  customersRequest,
  invoiceDraftRequest,
  invoiceDetailRequest,
  jobsRequest,
  updateInvoiceRequest,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'InvoiceForm'>;
type FormLineItem = Omit<
  InvoiceLineItemPayload,
  'quantity' | 'unitPriceCents'
> & {
  quantityInput: string;
  unitPriceInput: string;
};

const units = ['hour', 'item', 'metre', 'square metre', 'fixed'];

export function InvoiceFormScreen({ navigation, route }: Props) {
  const { customerId, customerSiteId, invoiceId, jobId, sourceQuoteId } =
    route.params ?? {};
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const canCreateInvoice = roleCanCreateInvoices(user?.role ?? 'READ_ONLY');
  const [step, setStep] = useState(0);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(
    customerId ?? '',
  );
  const [selectedJobId, setSelectedJobId] = useState(jobId ?? '');
  const [selectedSiteId, setSelectedSiteId] = useState(customerSiteId ?? '');
  const [selectedSourceQuoteId, setSelectedSourceQuoteId] = useState(
    sourceQuoteId ?? '',
  );
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString());
  const [dueDate, setDueDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return date.toISOString();
  });
  const [pricingMode, setPricingMode] =
    useState<InvoicePayload['pricingMode']>('GST_EXCLUSIVE');
  const [discountType, setDiscountType] = useState<InvoiceDiscountType>('NONE');
  const [discountValue, setDiscountValue] = useState('0');
  const [creditApplied, setCreditApplied] = useState('0');
  const [paymentTerms, setPaymentTerms] = useState(
    'Payment due within 7 days. Bank transfer details to be confirmed.',
  );
  const [customerNotes, setCustomerNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [sourceQuoteSummary, setSourceQuoteSummary] =
    useState<InvoiceDraftSourceQuote | null>(null);
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
  const [isLoading, setIsLoading] = useState(Boolean(invoiceId));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    let mounted = true;
    async function load() {
      setIsLoading(Boolean(invoiceId));
      const shouldLoadDraft =
        !invoiceId &&
        Boolean(customerId || customerSiteId || jobId || sourceQuoteId);
      const [customerResponse, jobResponse] = await Promise.all([
        customersRequest(token!, { page: 1, pageSize: 100 }),
        jobsRequest(token!, { page: 1, pageSize: 100 }),
      ]);
      if (!mounted) return;
      setCustomers(customerResponse.records);
      setJobs(jobResponse.records);
      if (invoiceId) {
        const response = await invoiceDetailRequest(token!, invoiceId);
        if (!mounted) return;
        const invoice = response.invoice;
        setSelectedCustomerId(invoice.customerId);
        setSelectedJobId(invoice.jobId ?? '');
        setSelectedSiteId(invoice.customerSiteId ?? '');
        setSelectedSourceQuoteId(invoice.sourceQuoteId ?? '');
        setTitle(invoice.title);
        setDescription(invoice.description ?? '');
        setIssueDate(invoice.issueDate);
        setDueDate(invoice.dueDate);
        setPricingMode(invoice.pricingMode);
        setDiscountType(invoice.discountType);
        setDiscountValue(
          adjustmentValueToInput(invoice.discountType, invoice.discountValue),
        );
        setCreditApplied(centsToInput(invoice.creditAppliedCents));
        setPaymentTerms(invoice.paymentTerms ?? '');
        setCustomerNotes(invoice.customerNotes ?? '');
        setInternalNotes(invoice.internalNotes ?? '');
        setLineItems(
          invoice.lineItems.map((item) => ({
            description: item.description ?? undefined,
            name: item.name,
            quantityInput: item.quantity,
            taxable: item.taxable,
            type: item.type,
            unit: item.unit,
            unitPriceInput: centsToInput(item.unitPriceCents),
          })),
        );
        navigation.setOptions({ title: `Edit ${invoice.invoiceNumber}` });
      } else if (shouldLoadDraft) {
        const response = await invoiceDraftRequest(token!, {
          customerId,
          customerSiteId,
          jobId,
          sourceQuoteId,
        });
        if (!mounted) return;
        const draft = response.draft;
        setSelectedCustomerId(draft.customerId);
        setSelectedJobId(draft.jobId ?? '');
        setSelectedSiteId(draft.customerSiteId ?? '');
        setSelectedSourceQuoteId(draft.sourceQuoteId ?? '');
        setSourceQuoteSummary(response.sourceQuote);
        setTitle(draft.title);
        setDescription(draft.description ?? '');
        setIssueDate(draft.issueDate);
        setDueDate(draft.dueDate);
        setPricingMode(draft.pricingMode);
        setDiscountType(draft.discountType ?? 'NONE');
        setDiscountValue(
          adjustmentValueToInput(
            draft.discountType ?? 'NONE',
            draft.discountValue ?? 0,
          ),
        );
        setCreditApplied(centsToInput(draft.creditAppliedCents ?? 0));
        setPaymentTerms(draft.paymentTerms ?? '');
        setCustomerNotes(draft.customerNotes ?? '');
        setInternalNotes(draft.internalNotes ?? '');
        setLineItems(draft.lineItems.map(invoicePayloadLineToFormLine));
      }
      setIsLoading(false);
    }
    void load().catch((error) => {
      if (!mounted) return;
      setIsLoading(false);
      showToast({
        message:
          error instanceof Error
            ? error.message
            : "We couldn't load invoice data.",
        tone: 'error',
      });
    });
    return () => {
      mounted = false;
    };
  }, [
    customerId,
    customerSiteId,
    invoiceId,
    jobId,
    navigation,
    showToast,
    sourceQuoteId,
    token,
  ]);

  const selectedCustomer = customers.find(
    (customer) => customer.id === selectedCustomerId,
  );
  const selectedJob = jobs.find((job) => job.id === selectedJobId);
  const isScopedFromJob = !invoiceId && Boolean(jobId);
  const parsedLineItems = useMemo(() => parseLineItems(lineItems), [lineItems]);
  const discountInput = useMemo(
    () => parseAdjustmentInput(discountType, discountValue),
    [discountType, discountValue],
  );
  const creditInput = useMemo(
    () => parseInvoiceMoneyInput(creditApplied),
    [creditApplied],
  );
  const calculations = useMemo(
    () =>
      calculateInvoiceTotals({
        creditAppliedCents: creditInput.value ?? 0,
        discountType,
        discountValue: discountInput.value ?? 0,
        lineItems: parsedLineItems.validItems,
        pricingMode,
      }),
    [
      creditInput.value,
      discountInput.value,
      discountType,
      parsedLineItems.validItems,
      pricingMode,
    ],
  );

  useEffect(() => {
    if (!selectedJobId) return;
    const job = jobs.find((candidate) => candidate.id === selectedJobId);
    if (!job) return;
    setSelectedCustomerId(job.customerId);
    if (!title) setTitle(job.title);
  }, [jobs, selectedJobId, title]);

  function updateLine(index: number, patch: Partial<FormLineItem>) {
    setLineItems((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  }

  function addLine() {
    setLineItems((items) => [
      ...items,
      {
        name: 'Service',
        quantityInput: '1',
        taxable: true,
        type: 'SERVICE',
        unit: 'item',
        unitPriceInput: '0',
      },
    ]);
  }

  async function saveDraft() {
    if (!token || isSaving) return;
    if (!canCreateInvoice) {
      showToast({ message: 'You cannot create invoices.', tone: 'error' });
      return;
    }
    if (!selectedCustomerId || !title.trim()) {
      showToast({
        message: 'Choose a customer and enter an invoice title.',
        tone: 'error',
      });
      return;
    }
    if (parsedLineItems.errors.length) {
      showToast({
        message: parsedLineItems.errors[0] ?? 'Check invoice line items.',
        tone: 'error',
      });
      return;
    }
    if (discountInput.error || creditInput.error) {
      showToast({
        message: discountInput.error ?? creditInput.error ?? 'Check totals.',
        tone: 'error',
      });
      return;
    }
    setIsSaving(true);
    try {
      const payload: InvoicePayload = {
        creditAppliedCents: creditInput.value ?? 0,
        customerId: selectedCustomerId,
        customerNotes,
        customerSiteId: selectedSiteId || null,
        description,
        discountType,
        discountValue: discountInput.value ?? 0,
        dueDate,
        internalNotes,
        issueDate,
        jobId: selectedJobId || null,
        lineItems: parsedLineItems.validItems,
        paymentTerms,
        pricingMode,
        sourceQuoteId: selectedSourceQuoteId || null,
        title,
      };
      const response = invoiceId
        ? await updateInvoiceRequest(token, invoiceId, payload)
        : await createInvoiceRequest(token, payload);
      showToast({ message: 'Invoice draft saved.', tone: 'success' });
      navigation.replace('InvoiceDetails', {
        invoiceId: response.invoice.id,
      });
    } catch (saveError) {
      showToast({
        message:
          saveError instanceof Error
            ? saveError.message
            : "We couldn't save this invoice.",
        tone: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colours.primary} />
        <Text style={styles.muted}>Loading invoice form...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.page}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>INVOICE DRAFT</Text>
          <Text style={styles.title}>
            {invoiceId ? 'Edit invoice' : 'New invoice'}
          </Text>
          <Text style={styles.subtitle}>
            Confirm the job, billable items, GST and payment terms before
            sending.
          </Text>
        </View>

        <View style={styles.steps}>
          {['Scope', 'Items', 'Terms', 'Review'].map((label, index) => (
            <Pressable
              accessibilityRole="button"
              key={label}
              onPress={() => setStep(index)}
              style={[styles.step, step === index && styles.stepActive]}
            >
              <Text
                style={[
                  styles.stepText,
                  step === index && styles.stepTextActive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {step === 0 ? (
          <Card title="Scope">
            {isScopedFromJob ? (
              <View style={styles.scopeSummary}>
                <SummaryText
                  label="Customer"
                  value={selectedCustomer?.displayName ?? 'Loading customer...'}
                />
                <SummaryText
                  label="Job"
                  value={
                    selectedJob
                      ? `${selectedJob.jobNumber} · ${selectedJob.title}`
                      : 'Loading job...'
                  }
                />
                <SummaryText
                  label="Source quote"
                  value={
                    sourceQuoteSummary
                      ? `${sourceQuoteSummary.quoteNumber} · ${sourceQuoteSummary.title}`
                      : selectedSourceQuoteId
                        ? 'Loading source quote...'
                        : 'No source quote'
                  }
                />
                <Text style={styles.muted}>
                  This invoice is scoped from the selected job. Source quote
                  pricing is loaded as the starting draft where available.
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.label}>Customer</Text>
                <View style={styles.chips}>
                  {customers.map((customer) => (
                    <Chip
                      active={selectedCustomerId === customer.id}
                      key={customer.id}
                      label={customer.displayName}
                      onPress={() => {
                        setSelectedCustomerId(customer.id);
                        setSelectedSiteId(customer.sites[0]?.id ?? '');
                      }}
                    />
                  ))}
                </View>
                <Text style={styles.label}>Service site</Text>
                <View style={styles.chips}>
                  {(selectedCustomer?.sites ?? []).map((site) => (
                    <Chip
                      active={selectedSiteId === site.id}
                      key={site.id}
                      label={site.label}
                      onPress={() => setSelectedSiteId(site.id)}
                    />
                  ))}
                </View>
                <Text style={styles.label}>Related job</Text>
                <View style={styles.chips}>
                  <Chip
                    active={!selectedJobId}
                    label="No job"
                    onPress={() => setSelectedJobId('')}
                  />
                  {jobs
                    .filter(
                      (job) =>
                        !selectedCustomerId ||
                        job.customerId === selectedCustomerId,
                    )
                    .map((job) => (
                      <Chip
                        active={selectedJobId === job.id}
                        key={job.id}
                        label={`${job.jobNumber} · ${job.title}`}
                        onPress={() => {
                          setSelectedJobId(job.id);
                          setSelectedSourceQuoteId(job.sourceQuoteId ?? '');
                        }}
                      />
                    ))}
                </View>
              </>
            )}
            {selectedJob?.sourceQuoteId && !sourceQuoteSummary ? (
              <Text style={styles.muted}>
                Source quote will be preserved from this job.
              </Text>
            ) : null}
            <Field label="Title" onChangeText={setTitle} value={title} />
            <Field
              label="Description"
              multiline
              onChangeText={setDescription}
              value={description}
            />
            <Field
              label="Issue date (ISO)"
              onChangeText={setIssueDate}
              value={issueDate}
            />
            <Field
              label="Due date (ISO)"
              onChangeText={setDueDate}
              value={dueDate}
            />
          </Card>
        ) : null}

        {step === 1 ? (
          <Card title="Billable items">
            {lineItems.map((item, index) => (
              <View key={index} style={styles.lineEditor}>
                <Field
                  label="Item"
                  onChangeText={(value) => updateLine(index, { name: value })}
                  value={item.name}
                />
                <View style={styles.row}>
                  <Field
                    keyboardType="decimal-pad"
                    label="Qty"
                    onChangeText={(value) =>
                      updateLine(index, { quantityInput: value })
                    }
                    value={item.quantityInput}
                  />
                  <Field
                    keyboardType="decimal-pad"
                    label="Unit price"
                    onChangeText={(value) =>
                      updateLine(index, { unitPriceInput: value })
                    }
                    value={item.unitPriceInput}
                  />
                </View>
                <Text style={styles.label}>Unit</Text>
                <View style={styles.chips}>
                  {units.map((unit) => (
                    <Chip
                      active={item.unit === unit}
                      key={unit}
                      label={unit}
                      onPress={() => updateLine(index, { unit })}
                    />
                  ))}
                </View>
                <View style={styles.chips}>
                  {(
                    ['LABOUR', 'MATERIAL', 'SERVICE', 'FEE', 'OTHER'] as const
                  ).map((type) => (
                    <Chip
                      active={item.type === type}
                      key={type}
                      label={type}
                      onPress={() => updateLine(index, { type })}
                    />
                  ))}
                </View>
                <Chip
                  active={item.taxable}
                  label={item.taxable ? 'Taxable' : 'Non-taxable'}
                  onPress={() => updateLine(index, { taxable: !item.taxable })}
                />
              </View>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={addLine}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryText}>+ Add item</Text>
            </Pressable>
          </Card>
        ) : null}

        {step === 2 ? (
          <Card title="Terms">
            <Text style={styles.label}>Pricing mode</Text>
            <View style={styles.chips}>
              <Chip
                active={pricingMode === 'GST_EXCLUSIVE'}
                label="GST exclusive"
                onPress={() => setPricingMode('GST_EXCLUSIVE')}
              />
              <Chip
                active={pricingMode === 'GST_INCLUSIVE'}
                label="GST inclusive"
                onPress={() => setPricingMode('GST_INCLUSIVE')}
              />
            </View>
            <Text style={styles.label}>Discount</Text>
            <View style={styles.chips}>
              {(['NONE', 'FIXED', 'PERCENTAGE'] as const).map((type) => (
                <Chip
                  active={discountType === type}
                  key={type}
                  label={type}
                  onPress={() => {
                    setDiscountType(type);
                    setDiscountValue(type === 'NONE' ? '0' : '');
                  }}
                />
              ))}
            </View>
            {discountType !== 'NONE' ? (
              <Field
                keyboardType="decimal-pad"
                label={discountType === 'FIXED' ? 'Discount $' : 'Discount %'}
                onChangeText={setDiscountValue}
                value={discountValue}
              />
            ) : null}
            <Field
              keyboardType="decimal-pad"
              label="Credit applied $"
              onChangeText={setCreditApplied}
              value={creditApplied}
            />
            <Field
              label="Payment terms"
              multiline
              onChangeText={setPaymentTerms}
              value={paymentTerms}
            />
            <Field
              label="Customer notes"
              multiline
              onChangeText={setCustomerNotes}
              value={customerNotes}
            />
            <Field
              label="Internal notes"
              multiline
              onChangeText={setInternalNotes}
              value={internalNotes}
            />
          </Card>
        ) : null}

        {step === 3 ? (
          <Card title="Review">
            <Summary label="Subtotal" value={calculations.subtotalCents} />
            <Summary label="Discount" value={calculations.discountCents} />
            <Summary label="GST" value={calculations.gstCents} />
            <Summary label="Total" value={calculations.totalCents} strong />
            <Summary label="Credit" value={calculations.creditAppliedCents} />
            <Summary
              label="Balance due"
              value={calculations.balanceDueCents}
              strong
            />
            <Text style={styles.muted}>
              New invoices save as draft. Sending requires a separate
              confirmation from Invoice Details.
            </Text>
          </Card>
        ) : null}

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              step === 0 ? navigation.goBack() : setStep(step - 1)
            }
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryText}>Back</Text>
          </Pressable>
          {step < 3 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setStep(step + 1)}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryText}>Next</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={() => void saveDraft()}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryText}>
                {isSaving ? 'Saving...' : 'Save Draft'}
              </Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function parseLineItems(items: FormLineItem[]) {
  const errors: string[] = [];
  const validItems: InvoiceLineItemPayload[] = [];
  items.forEach((item, index) => {
    const quantity = parseInvoiceQuantityInput(item.quantityInput);
    const money = parseInvoiceMoneyInput(item.unitPriceInput);
    if (quantity.error || !quantity.isComplete) {
      errors.push(
        `Line ${index + 1}: ${quantity.error ?? 'Complete quantity.'}`,
      );
      return;
    }
    if (money.error || !money.isComplete) {
      errors.push(
        `Line ${index + 1}: ${money.error ?? 'Complete unit price.'}`,
      );
      return;
    }
    validItems.push({
      description: item.description,
      name: item.name,
      quantity: quantity.value ?? '1',
      taxable: item.taxable,
      type: item.type,
      unit: item.unit,
      unitPriceCents: money.value ?? 0,
    });
  });
  return { errors, validItems };
}

function invoicePayloadLineToFormLine(
  item: InvoiceLineItemPayload,
): FormLineItem {
  return {
    description: item.description,
    name: item.name,
    quantityInput: String(item.quantity),
    taxable: item.taxable,
    type: item.type,
    unit: item.unit,
    unitPriceInput: centsToInput(item.unitPriceCents),
  };
}

function parseAdjustmentInput(type: InvoiceDiscountType, value: string) {
  if (type === 'NONE') return { error: null, value: 0 };
  const parsed = parseInvoiceMoneyInput(value);
  if (type === 'FIXED') return parsed;
  if (parsed.error || parsed.value === null) return parsed;
  return {
    error: null,
    errorCode: null,
    isComplete: parsed.isComplete,
    value: Math.round(parsed.value),
  };
}

function adjustmentValueToInput(type: InvoiceDiscountType, value: number) {
  if (type === 'NONE') return '0';
  return type === 'FIXED' ? centsToInput(value) : String(value / 100);
}

function centsToInput(cents: number) {
  return (cents / 100).toFixed(2).replace(/\.00$/, '');
}

function Card({ children, title }: { children: ReactNode; title: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Chip({
  active,
  label,
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
        {label}
      </Text>
    </Pressable>
  );
}

function Field({
  keyboardType,
  label,
  multiline,
  onChangeText,
  value,
}: {
  keyboardType?: 'default' | 'decimal-pad';
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
        style={[styles.input, multiline && styles.textArea]}
        value={value}
      />
    </View>
  );
}

function Summary({
  label,
  strong,
  value,
}: {
  label: string;
  strong?: boolean;
  value: number;
}) {
  return (
    <View style={styles.summary}>
      <Text style={[styles.muted, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.muted, strong && styles.strong]}>
        {formatAudCents(value)}
      </Text>
    </View>
  );
}

function SummaryText({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summary}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={[styles.muted, styles.strong, styles.summaryValue]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  cardTitle: {
    color: colours.ink,
    fontSize: 20,
    fontWeight: '900',
  },
  centered: {
    alignItems: 'center',
    backgroundColor: colours.background,
    flex: 1,
    gap: 12,
    justifyContent: 'center',
  },
  chip: {
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  chipActive: {
    backgroundColor: colours.primary,
    borderColor: colours.primary,
  },
  chipText: {
    color: colours.ink,
    fontSize: 12,
    fontWeight: '800',
  },
  chipTextActive: {
    color: '#fff',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  container: {
    gap: 16,
    padding: 20,
    paddingBottom: 44,
  },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  field: {
    flex: 1,
    gap: 6,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  header: {
    gap: 4,
  },
  input: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    color: colours.ink,
    padding: 13,
  },
  label: {
    color: colours.ink,
    fontWeight: '800',
  },
  lineEditor: {
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  muted: {
    color: colours.muted,
    fontSize: 14,
  },
  page: {
    backgroundColor: colours.background,
    flex: 1,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colours.primary,
    borderRadius: 999,
    flex: 1,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  primaryText: {
    color: '#fff',
    fontWeight: '900',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  secondaryText: {
    color: colours.primary,
    fontWeight: '900',
  },
  scopeSummary: {
    backgroundColor: colours.background,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  step: {
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  stepActive: {
    backgroundColor: colours.primary,
    borderColor: colours.primary,
  },
  stepText: {
    color: colours.ink,
    fontSize: 12,
    fontWeight: '800',
  },
  stepTextActive: {
    color: '#fff',
  },
  steps: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  strong: {
    color: colours.ink,
    fontWeight: '900',
  },
  subtitle: {
    color: colours.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  summary: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  summaryValue: {
    flex: 1,
    textAlign: 'right',
  },
  textArea: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  title: {
    color: colours.ink,
    fontSize: 28,
    fontWeight: '900',
  },
});
