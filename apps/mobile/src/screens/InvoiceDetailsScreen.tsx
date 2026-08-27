import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ReactNode, RefObject } from 'react';
import type { Invoice, InvoicePaymentMethod } from '@tradieos/shared';
import {
  INVOICE_PAYMENT_METHODS,
  formatAudCents,
  formatBusinessDate,
  formatBusinessDateTime,
  getInvoiceAvailableActions,
  validateInvoicePaymentAmount,
} from '@tradieos/shared';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ApiRequestError,
  friendlyInvoiceMutationError,
  invoiceDetailRequest,
  recordInvoicePaymentRequest,
  sendInvoiceRequest,
  voidInvoiceRequest,
} from '../api/client';
import {
  downloadAuthenticatedInvoicePaymentReceipt,
  downloadAuthenticatedInvoicePdf,
} from '../api/invoiceDocuments';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import { keyboardAvoidingBehavior } from '../components/keyboardAvoidance';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'InvoiceDetails'>;

export function InvoiceDetailsScreen({ navigation, route }: Props) {
  const { invoiceId } = route.params;
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [documents, setDocuments] = useState<
    NonNullable<Awaited<ReturnType<typeof invoiceDetailRequest>>['documents']>
  >([]);
  const [payments, setPayments] = useState<
    NonNullable<Awaited<ReturnType<typeof invoiceDetailRequest>>['payments']>
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendSubject, setSendSubject] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] =
    useState<InvoicePaymentMethod>('BANK_TRANSFER');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentAmountError, setPaymentAmountError] = useState<string | null>(
    null,
  );
  const paymentAmountInputRef = useRef<TextInput>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await invoiceDetailRequest(token, invoiceId);
      setInvoice(response.invoice);
      setDocuments(response.documents ?? []);
      setPayments(response.payments ?? []);
      navigation.setOptions({ title: response.invoice.invoiceNumber });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "We couldn't load this invoice.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [invoiceId, navigation, token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function mutate(action: string, run: () => Promise<void>) {
    if (busyAction) return;
    setBusyAction(action);
    try {
      await run();
      await load();
    } catch (mutationError) {
      showToast({
        message: friendlyInvoiceMutationError(mutationError),
        tone: 'error',
      });
    } finally {
      setBusyAction(null);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colours.primary} />
        <Text style={styles.muted}>Loading invoice...</Text>
      </View>
    );
  }

  if (error || !invoice) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Invoice unavailable</Text>
        <Text style={styles.muted}>
          {error ?? 'Invoice could not be found.'}
        </Text>
        <Pressable onPress={() => void load()} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const role = user?.role ?? 'READ_ONLY';
  const activeDocument =
    documents.find((document) => document.version === invoice.version) ??
    documents[0] ??
    null;
  const availableActions = new Set(
    getInvoiceAvailableActions({
      balanceDueCents: invoice.balanceDueCents,
      role,
      status: invoice.status,
    }),
  );

  function openSendModal() {
    if (!invoice) return;
    setSendTo(invoice.customer.email ?? '');
    setSendSubject(
      `Invoice ${invoice.invoiceNumber} from ${
        user?.business.name ?? 'TradieOS'
      }`,
    );
    setSendMessage(
      `Hi ${invoice.customer.displayName}, please review invoice ${invoice.invoiceNumber}.`,
    );
    setSendOpen(true);
  }

  async function openPdf(fileName?: string) {
    if (!token || !invoice) return;
    const localUri = await downloadAuthenticatedInvoicePdf(
      token,
      invoice.id,
      fileName ?? `Invoice-${invoice.invoiceNumber}.pdf`,
    );
    await Linking.openURL(localUri);
  }

  async function openReceipt(paymentId: string, fileName?: string) {
    if (!token || !invoice) return;
    const localUri = await downloadAuthenticatedInvoicePaymentReceipt(
      token,
      invoice.id,
      paymentId,
      fileName ?? `Receipt-${invoice.invoiceNumber}-${paymentId}.pdf`,
    );
    await Linking.openURL(localUri);
  }

  async function savePayment() {
    if (!token || !invoice) return;
    if (busyAction) return;
    const validation = validateInvoicePaymentAmount({
      amount: paymentAmount,
      balanceDueCents: invoice.balanceDueCents,
      invoiceStatus: invoice.status,
    });
    if (validation.error || validation.amountCents === null) {
      setPaymentAmountError(
        validation.error ?? 'Enter a valid payment amount.',
      );
      paymentAmountInputRef.current?.focus();
      return;
    }
    setPaymentAmountError(null);
    setBusyAction('payment');
    try {
      await recordInvoicePaymentRequest(token, invoice.id, {
        amountCents: validation.amountCents,
        method: paymentMethod,
        notes: paymentNotes,
        receivedAt: new Date().toISOString(),
        reference: paymentReference,
      });
      setPaymentOpen(false);
      setPaymentAmount('');
      setPaymentReference('');
      setPaymentNotes('');
      setPaymentAmountError(null);
      await load();
    } catch (paymentError) {
      const message = friendlyPaymentError(paymentError, invoice);
      setPaymentAmountError(message);
      showToast({
        message,
        tone: 'error',
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} style={styles.page}>
      <View style={styles.hero}>
        <View style={styles.heroHeader}>
          <Text style={styles.eyebrow}>{invoice.invoiceNumber}</Text>
          <Text style={[styles.badge, statusStyle(invoice.displayStatus)]}>
            {invoice.displayStatus.replaceAll('_', ' ')}
          </Text>
        </View>
        <Text style={styles.title}>{invoice.title}</Text>
        <Text style={styles.muted}>{invoice.customer.displayName}</Text>
        <Text style={styles.total}>{formatAudCents(invoice.totalCents)}</Text>
        {invoice.status === 'PAID' ? (
          <Text style={styles.paidState}>
            Paid {formatAudCents(invoice.amountPaidCents)}
            {invoice.paidAt
              ? ` on ${formatBusinessDate(
                  invoice.paidAt,
                  user?.business.timezone,
                )}`
              : ''}
          </Text>
        ) : null}
        <Text style={styles.balance}>
          Balance due {formatAudCents(invoice.balanceDueCents)}
        </Text>
      </View>

      <View style={styles.actions}>
        {availableActions.has('EDIT') ? (
          <Action
            label="Edit draft"
            onPress={() =>
              navigation.navigate('InvoiceForm', { invoiceId: invoice.id })
            }
          />
        ) : null}
        {availableActions.has('SEND') ? (
          <Action label="Send" onPress={openSendModal} />
        ) : null}
        {availableActions.has('VIEW_PDF') ? (
          <Action
            busy={busyAction === 'pdf'}
            label={activeDocument ? 'View PDF' : 'Generate PDF'}
            onPress={() =>
              void mutate('pdf', () => openPdf(activeDocument?.fileName))
            }
          />
        ) : null}
        {availableActions.has('RECORD_PAYMENT') ? (
          <Action
            label="Record payment"
            onPress={() => {
              setPaymentAmount(
                (invoice.balanceDueCents / 100).toFixed(2).replace(/\.00$/, ''),
              );
              setPaymentAmountError(null);
              setPaymentOpen(true);
            }}
          />
        ) : null}
        {availableActions.has('VOID') ? (
          <Action
            danger
            label="Void"
            onPress={() =>
              Alert.alert('Void invoice?', invoice.invoiceNumber, [
                { style: 'cancel', text: 'Cancel' },
                {
                  onPress: () =>
                    void mutate('void', async () => {
                      if (token) await voidInvoiceRequest(token, invoice.id);
                    }),
                  style: 'destructive',
                  text: 'Void invoice',
                },
              ])
            }
          />
        ) : null}
      </View>

      <Card title="Source">
        {invoice.job ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              invoice.job &&
              navigation.navigate('JobDetails', { jobId: invoice.job.id })
            }
          >
            <Text style={styles.link}>
              Job {invoice.job.jobNumber} · {invoice.job.title}
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.muted}>No source job linked.</Text>
        )}
        {invoice.sourceQuote ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              invoice.sourceQuote &&
              navigation.navigate('QuoteDetails', {
                quoteId: invoice.sourceQuote.id,
              })
            }
          >
            <Text style={styles.link}>
              Source Quote {invoice.sourceQuote.quoteNumber}
            </Text>
          </Pressable>
        ) : null}
      </Card>

      <Card title="Dates & terms">
        <Text style={styles.meta}>
          Issue:{' '}
          {formatBusinessDate(invoice.issueDate, user?.business.timezone)}
        </Text>
        <Text style={styles.meta}>
          Due: {formatBusinessDate(invoice.dueDate, user?.business.timezone)}
        </Text>
        <Text style={styles.meta}>
          Pricing: {invoice.pricingMode.replace('_', ' ')}
        </Text>
        <Text style={styles.meta}>
          Terms: {invoice.paymentTerms || 'No payment terms added.'}
        </Text>
      </Card>

      <Card title="Line items">
        {invoice.lineItems.map((item) => (
          <View key={item.id} style={styles.lineItem}>
            <View style={styles.lineCopy}>
              <Text style={styles.lineName}>{item.name}</Text>
              <Text style={styles.muted}>
                {item.quantity} {item.unit} ·{' '}
                {formatAudCents(item.unitPriceCents)}
              </Text>
            </View>
            <Text style={styles.lineTotal}>
              {formatAudCents(item.lineTotalCents)}
            </Text>
          </View>
        ))}
      </Card>

      <Card title="Totals">
        <Total label="Subtotal" value={invoice.subtotalCents} />
        <Total label="Discount" value={invoice.discountCents} />
        <Total label="GST" value={invoice.gstCents} />
        <Total label="Total" value={invoice.totalCents} strong />
        <Total label="Credit applied" value={invoice.creditAppliedCents} />
        <Total label="Paid" value={invoice.amountPaidCents} />
        <Total label="Balance due" value={invoice.balanceDueCents} strong />
      </Card>

      <Card title="Payment history">
        {payments.length === 0 ? (
          <Text style={styles.muted}>No payments recorded yet.</Text>
        ) : (
          payments.map((payment) => (
            <View key={payment.id} style={styles.paymentRow}>
              <View style={styles.paymentCopy}>
                <Text style={styles.lineName}>
                  {formatAudCents(payment.amountCents)}
                </Text>
                <Text style={styles.muted}>
                  {payment.method.replaceAll('_', ' ')} ·{' '}
                  {formatBusinessDateTime(
                    payment.receivedAt,
                    user?.business.timezone,
                  )}
                </Text>
                {payment.reference ? (
                  <Text style={styles.muted}>
                    Reference: {payment.reference}
                  </Text>
                ) : null}
                {payment.notes ? (
                  <Text style={styles.muted}>Note: {payment.notes}</Text>
                ) : null}
                <Text style={styles.muted}>
                  Recorded by {payment.createdByName ?? 'Unknown'} · Created{' '}
                  {formatBusinessDateTime(
                    payment.createdAt,
                    user?.business.timezone,
                  )}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={Boolean(busyAction)}
                onPress={() =>
                  void mutate('receipt', () =>
                    openReceipt(
                      payment.id,
                      payment.receiptDocument?.fileName ??
                        `Receipt-${invoice.invoiceNumber}.pdf`,
                    ),
                  )
                }
                style={[
                  styles.receiptButton,
                  Boolean(busyAction) && styles.disabledAction,
                ]}
              >
                <Text style={styles.receiptButtonText}>
                  {busyAction === 'receipt'
                    ? 'Working...'
                    : payment.receiptDocument
                      ? 'View receipt'
                      : 'Generate receipt'}
                </Text>
              </Pressable>
            </View>
          ))
        )}
      </Card>

      <Card title="Documents">
        {documents.length === 0 ? (
          <Text style={styles.muted}>No invoice PDF generated yet.</Text>
        ) : (
          documents.map((document) => (
            <Pressable
              accessibilityRole="button"
              key={document.id}
              onPress={() => void openPdf(document.fileName)}
              style={styles.documentRow}
            >
              <Text style={styles.link}>{document.fileName}</Text>
              <Text style={styles.muted}>Version {document.version}</Text>
            </Pressable>
          ))
        )}
      </Card>

      <SendModal
        busy={busyAction === 'send'}
        message={sendMessage}
        onCancel={() => setSendOpen(false)}
        onChangeMessage={setSendMessage}
        onChangeSubject={setSendSubject}
        onChangeTo={setSendTo}
        onSend={() =>
          void mutate('send', async () => {
            if (!token) return;
            await sendInvoiceRequest(token, invoice.id, {
              message: sendMessage,
              subject: sendSubject,
              to: sendTo,
            });
            setSendOpen(false);
          })
        }
        subject={sendSubject}
        to={sendTo}
        visible={sendOpen}
      />

      <PaymentModal
        amount={paymentAmount}
        busy={busyAction === 'payment'}
        error={paymentAmountError}
        invoice={invoice}
        inputRef={paymentAmountInputRef}
        method={paymentMethod}
        notes={paymentNotes}
        onCancel={() => {
          setPaymentOpen(false);
          setPaymentAmountError(null);
        }}
        onChangeAmount={(value) => {
          setPaymentAmount(value);
          if (paymentAmountError) setPaymentAmountError(null);
        }}
        onChangeMethod={setPaymentMethod}
        onChangeNotes={setPaymentNotes}
        onChangeReference={setPaymentReference}
        onSave={() => void savePayment()}
        reference={paymentReference}
        visible={paymentOpen}
      />
    </ScrollView>
  );
}

function Action({
  busy,
  busyLabel,
  danger,
  disabled,
  label,
  onPress,
}: {
  busy?: boolean;
  busyLabel?: string;
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy || disabled}
      onPress={onPress}
      style={[styles.actionButton, danger && styles.dangerButton]}
    >
      <Text style={[styles.actionText, danger && styles.dangerText]}>
        {busy ? (busyLabel ?? 'Working...') : label}
      </Text>
    </Pressable>
  );
}

function Card({ children, title }: { children: ReactNode; title: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Total({
  label,
  strong,
  value,
}: {
  label: string;
  strong?: boolean;
  value: number;
}) {
  return (
    <View style={styles.totalRow}>
      <Text style={[styles.meta, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.meta, strong && styles.strong]}>
        {formatAudCents(value)}
      </Text>
    </View>
  );
}

function SendModal({
  busy,
  message,
  onCancel,
  onChangeMessage,
  onChangeSubject,
  onChangeTo,
  onSend,
  subject,
  to,
  visible,
}: {
  busy: boolean;
  message: string;
  onCancel(): void;
  onChangeMessage(value: string): void;
  onChangeSubject(value: string): void;
  onChangeTo(value: string): void;
  onSend(): void;
  subject: string;
  to: string;
  visible: boolean;
}) {
  return (
    <Modal animationType="slide" onRequestClose={onCancel} visible={visible}>
      <ScrollView contentContainerStyle={styles.modal}>
        <Text style={styles.title}>Send invoice</Text>
        <Field label="To" onChangeText={onChangeTo} value={to} />
        <Field label="Subject" onChangeText={onChangeSubject} value={subject} />
        <Field
          label="Message"
          multiline
          onChangeText={onChangeMessage}
          value={message}
        />
        <Text style={styles.muted}>
          Local development uses the console email provider only. Tori will not
          send without your confirmation.
        </Text>
        <View style={styles.modalActions}>
          <Action label="Cancel" onPress={onCancel} />
          <Action busy={busy} label="Send invoice" onPress={onSend} />
        </View>
      </ScrollView>
    </Modal>
  );
}

function PaymentModal({
  amount,
  busy,
  error,
  inputRef,
  invoice,
  method,
  notes,
  onCancel,
  onChangeAmount,
  onChangeMethod,
  onChangeNotes,
  onChangeReference,
  onSave,
  reference,
  visible,
}: {
  amount: string;
  busy: boolean;
  error: string | null;
  inputRef: RefObject<TextInput | null>;
  invoice: Invoice;
  method: InvoicePaymentMethod;
  notes: string;
  onCancel(): void;
  onChangeAmount(value: string): void;
  onChangeMethod(value: InvoicePaymentMethod): void;
  onChangeNotes(value: string): void;
  onChangeReference(value: string): void;
  onSave(): void;
  reference: string;
  visible: boolean;
}) {
  return (
    <Modal animationType="slide" onRequestClose={onCancel} visible={visible}>
      <SafeAreaView style={styles.modalSafeArea}>
        <KeyboardAvoidingView
          behavior={keyboardAvoidingBehavior}
          style={styles.modalKeyboard}
        >
          <ScrollView
            contentContainerStyle={styles.modal}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.title}>Record payment</Text>
            <View style={styles.paymentSummary}>
              <Total label="Invoice total" value={invoice.totalCents} />
              <Total label="Already paid" value={invoice.amountPaidCents} />
              <Total
                label="Remaining balance"
                value={invoice.balanceDueCents}
                strong
              />
            </View>
            <Field
              error={error}
              inputRef={inputRef}
              keyboardType="decimal-pad"
              label="Amount"
              onChangeText={onChangeAmount}
              value={amount}
            />
            <Text style={styles.label}>Method</Text>
            <View style={styles.chips}>
              {INVOICE_PAYMENT_METHODS.map((option) => (
                <Pressable
                  accessibilityRole="button"
                  key={option}
                  onPress={() => onChangeMethod(option)}
                  style={[styles.chip, method === option && styles.chipActive]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      method === option && styles.chipTextActive,
                    ]}
                  >
                    {option.replaceAll('_', ' ')}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Field
              label="Reference"
              onChangeText={onChangeReference}
              value={reference}
            />
            <Field
              label="Notes"
              multiline
              onChangeText={onChangeNotes}
              value={notes}
            />
            <View style={styles.modalActions}>
              <Action disabled={busy} label="Cancel" onPress={onCancel} />
              <Action
                busy={busy}
                busyLabel="Saving..."
                label="Save payment"
                onPress={onSave}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function friendlyPaymentError(error: unknown, invoice: Invoice) {
  if (error instanceof ApiRequestError) {
    if (error.code === 'INVOICE_PAYMENT_EXCEEDS_BALANCE') {
      return 'Payment cannot exceed the remaining balance.';
    }
    if (error.code === 'INVOICE_ALREADY_PAID') {
      return 'This invoice has already been paid.';
    }
    if (error.code === 'INVOICE_VOID') {
      return 'Payments cannot be recorded against a void invoice.';
    }
    if (error.code === 'INVOICE_PAYMENT_INVALID') {
      return 'Enter a valid payment amount.';
    }
    if (error.code === 'INVOICE_INVALID_STATUS') {
      return invoice.status === 'DRAFT'
        ? 'Send the invoice before recording payment.'
        : 'Payments cannot be recorded for this invoice status.';
    }
    if (error.code === 'INVOICE_ACCESS_DENIED') {
      return 'You do not have permission to record payments.';
    }
  }
  return error instanceof Error
    ? error.message
    : "We couldn't record this payment.";
}

function Field({
  error,
  inputRef,
  keyboardType,
  label,
  multiline,
  onChangeText,
  value,
}: {
  error?: string | null;
  inputRef?: RefObject<TextInput | null>;
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
        accessibilityHint={error ? error : undefined}
        accessibilityLabel={label}
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        ref={inputRef}
        style={[
          styles.input,
          multiline && styles.textArea,
          error && styles.inputError,
        ]}
        value={value}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

function statusStyle(status: Invoice['displayStatus']) {
  if (status === 'PAID') return styles.statusPaid;
  if (status === 'OVERDUE') return styles.statusOverdue;
  if (status === 'PARTIALLY_PAID') return styles.statusPartial;
  if (status === 'VOID') return styles.statusVoid;
  return styles.statusSent;
}

const styles = StyleSheet.create({
  actionButton: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  actionText: {
    color: colours.primary,
    fontWeight: '800',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  badge: {
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  balance: {
    color: colours.ink,
    fontSize: 17,
    fontWeight: '800',
    marginTop: 8,
  },
  card: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 10,
    padding: 18,
  },
  cardTitle: {
    color: colours.ink,
    fontSize: 18,
    fontWeight: '900',
  },
  centered: {
    alignItems: 'center',
    backgroundColor: colours.background,
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 24,
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
    paddingBottom: 36,
  },
  dangerButton: {
    borderColor: '#fecdd3',
  },
  dangerText: {
    color: '#be123c',
  },
  disabledAction: {
    opacity: 0.6,
  },
  documentRow: {
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
  },
  errorTitle: {
    color: '#be123c',
    fontSize: 18,
    fontWeight: '800',
  },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  field: {
    gap: 6,
  },
  fieldError: {
    color: '#BE123C',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  hero: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 28,
    borderWidth: 1,
    padding: 22,
  },
  heroHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  input: {
    backgroundColor: colours.background,
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    color: colours.ink,
    padding: 13,
  },
  inputError: {
    borderColor: '#BE123C',
  },
  label: {
    color: colours.ink,
    fontWeight: '800',
  },
  lineCopy: {
    flex: 1,
  },
  lineItem: {
    alignItems: 'flex-start',
    borderBottomColor: colours.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  lineName: {
    color: colours.ink,
    fontWeight: '800',
  },
  lineTotal: {
    color: colours.ink,
    fontWeight: '900',
  },
  link: {
    color: colours.primary,
    fontWeight: '800',
  },
  meta: {
    color: colours.muted,
    fontSize: 14,
  },
  modal: {
    backgroundColor: colours.background,
    flexGrow: 1,
    gap: 16,
    padding: 20,
    paddingBottom: 40,
    paddingTop: 64,
  },
  modalActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  modalKeyboard: {
    flex: 1,
  },
  modalSafeArea: {
    backgroundColor: colours.background,
    flex: 1,
  },
  muted: {
    color: colours.muted,
    fontSize: 14,
  },
  page: {
    backgroundColor: colours.background,
    flex: 1,
  },
  paidState: {
    color: '#15803d',
    fontSize: 16,
    fontWeight: '900',
    marginTop: 8,
  },
  paymentCopy: {
    flex: 1,
    gap: 4,
  },
  paymentRow: {
    alignItems: 'flex-start',
    borderBottomColor: colours.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  paymentSummary: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  receiptButton: {
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  receiptButtonText: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colours.secondaryActionSurface,
    borderColor: colours.primary,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: colours.primary,
    fontWeight: '800',
  },
  statusOverdue: {
    backgroundColor: '#ffe4e6',
    color: '#be123c',
  },
  statusPaid: {
    backgroundColor: '#dcfce7',
    color: '#15803d',
  },
  statusPartial: {
    backgroundColor: '#fef3c7',
    color: '#92400e',
  },
  statusSent: {
    backgroundColor: '#dbeafe',
    color: '#1d4ed8',
  },
  statusVoid: {
    backgroundColor: '#e5e7eb',
    color: '#4b5563',
  },
  strong: {
    color: colours.ink,
    fontWeight: '900',
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
  total: {
    color: colours.ink,
    fontSize: 32,
    fontWeight: '900',
    marginTop: 12,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
