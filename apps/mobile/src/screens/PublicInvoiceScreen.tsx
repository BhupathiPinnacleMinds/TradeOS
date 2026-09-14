import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type {
  InvoicePaymentMethod,
  PublicInvoiceResponse,
} from '@tradieos/shared';
import {
  INVOICE_PAYMENT_METHODS,
  formatAudCents,
  formatBusinessDate,
  validateInvoicePaymentAmount,
} from '@tradieos/shared';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  publicInvoicePaymentDeclarationRequest,
  publicInvoicePdfUrl,
  publicInvoiceRequest,
  publicInvoiceViewRequest,
} from '../api/client';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'PublicInvoice'>;

export function PublicInvoiceScreen({ route }: Props) {
  const { token } = route.params;
  const [data, setData] = useState<PublicInvoiceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] =
    useState<InvoicePaymentMethod>('BANK_TRANSFER');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState<string | null>(null);

  async function load(markViewed = false) {
    setIsLoading(true);
    setError(null);
    try {
      const response = markViewed
        ? await publicInvoiceViewRequest(token)
        : await publicInvoiceRequest(token);
      setData(response);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "We couldn't open this invoice link.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load(true);
  }, [token]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colours.primary} />
        <Text style={styles.muted}>Opening invoice...</Text>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Invoice unavailable</Text>
        <Text style={styles.muted}>
          {error ?? 'This link is not available.'}
        </Text>
        <Pressable onPress={() => void load()} style={styles.button}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const { business, invoice } = data;
  const isTaxInvoice = invoice.gstCents > 0 && Boolean(business.abn);
  const isVoid = invoice.status === 'VOID';
  const pdfDocument = data.documents?.[0] ?? null;
  const instructions = data.paymentInstructions;
  const pendingDeclarations =
    data.paymentDeclarations?.filter(
      (declaration) => declaration.status === 'PENDING',
    ) ?? [];
  const canDeclarePayment =
    invoice.balanceDueCents > 0 && invoice.status !== 'PAID' && !isVoid;

  async function submitPaymentDeclaration() {
    if (!data || isSubmittingPayment) return;
    const validation = validateInvoicePaymentAmount({
      amount: paymentAmount,
      balanceDueCents: invoice.balanceDueCents,
      invoiceStatus: invoice.status === 'OVERDUE' ? 'OVERDUE' : 'SENT',
    });
    if (validation.error || validation.amountCents === null) {
      setPaymentError(validation.error ?? 'Enter a valid payment amount.');
      return;
    }
    setIsSubmittingPayment(true);
    setPaymentError(null);
    setPaymentSuccess(null);
    try {
      const response = await publicInvoicePaymentDeclarationRequest(token, {
        amountCents: validation.amountCents,
        method: paymentMethod,
        note: paymentNote,
        reference: paymentReference,
      });
      setData(response);
      setPaymentAmount('');
      setPaymentReference('');
      setPaymentNote('');
      setPaymentSuccess('Thanks. Your payment has been sent for confirmation.');
    } catch (submitError) {
      setPaymentError(
        submitError instanceof Error
          ? submitError.message
          : "We couldn't submit this payment update.",
      );
    } finally {
      setIsSubmittingPayment(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} style={styles.page}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{business.name}</Text>
        <Text style={styles.title}>
          {isTaxInvoice ? 'Tax Invoice' : 'Invoice'}
        </Text>
        <Text style={styles.invoiceNumber}>{invoice.invoiceNumber}</Text>
        {isVoid ? <Text style={styles.voidBadge}>VOID</Text> : null}
        {business.abn ? (
          <Text style={styles.muted}>ABN {business.abn}</Text>
        ) : null}
        <Text style={styles.total}>
          {formatAudCents(invoice.balanceDueCents)}
        </Text>
        <Text style={styles.muted}>Balance due</Text>
      </View>

      <Card title={invoice.title}>
        <Text style={styles.meta}>
          Customer: {invoice.customer.displayName}
        </Text>
        <Text style={styles.meta}>
          Status: {invoice.status.replaceAll('_', ' ')}
        </Text>
        <Text style={styles.meta}>
          Issue: {formatBusinessDate(invoice.issueDate)}
        </Text>
        <Text style={styles.meta}>
          Due: {formatBusinessDate(invoice.dueDate)}
        </Text>
        {invoice.customerSite ? (
          <Text style={styles.meta}>
            Service address: {invoice.customerSite.addressLine1},{' '}
            {invoice.customerSite.suburb} {invoice.customerSite.state}
          </Text>
        ) : null}
        {pdfDocument ? (
          <>
            {isVoid ? (
              <Text style={styles.warningText}>
                This invoice has been voided. No payment is required.
              </Text>
            ) : null}
            <Pressable
              accessibilityLabel={`View PDF for invoice ${invoice.invoiceNumber}`}
              accessibilityRole="button"
              onPress={() => void Linking.openURL(publicInvoicePdfUrl(token))}
              style={styles.pdfButton}
            >
              <Text style={styles.pdfButtonText}>View PDF</Text>
            </Pressable>
          </>
        ) : null}
      </Card>

      <Card title="Items">
        {invoice.lineItems.map((item, index) => (
          <View key={`${item.name}-${index}`} style={styles.item}>
            <View style={styles.itemCopy}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.muted}>
                {item.quantity} {item.unit} ·{' '}
                {formatAudCents(item.unitPriceCents)}
              </Text>
            </View>
            <Text style={styles.itemTotal}>
              {formatAudCents(item.lineTotalCents)}
            </Text>
          </View>
        ))}
      </Card>

      <Card title="Totals">
        <Row label="Subtotal" value={invoice.subtotalCents} />
        <Row label="Discount" value={invoice.discountCents} />
        <Row label="GST" value={invoice.gstCents} />
        <Row label="Total" value={invoice.totalCents} strong />
        <Row label="Credit applied" value={invoice.creditAppliedCents} />
        <Row label="Paid" value={invoice.amountPaidCents} />
        <Row label="Balance due" value={invoice.balanceDueCents} strong />
      </Card>

      <Card title="Payment instructions">
        {instructions?.hasBankDetails ? (
          <View style={styles.paymentDetails}>
            <Text style={styles.meta}>
              Account name: {instructions.accountName}
            </Text>
            {instructions.bankName ? (
              <Text style={styles.meta}>Bank: {instructions.bankName}</Text>
            ) : null}
            <Text style={styles.meta}>BSB: {instructions.bsb}</Text>
            <Text style={styles.meta}>
              Account number: {instructions.accountNumber}
            </Text>
            <Text style={styles.meta}>Reference: {instructions.reference}</Text>
          </View>
        ) : (
          <Text style={styles.meta}>
            {invoice.paymentTerms ||
              'Please contact the business for payment details.'}
          </Text>
        )}
        {instructions?.customInstructions ? (
          <Text style={styles.meta}>{instructions.customInstructions}</Text>
        ) : null}
      </Card>

      {invoice.customerNotes ? (
        <Card title="Customer notes">
          <Text style={styles.meta}>{invoice.customerNotes}</Text>
        </Card>
      ) : null}

      {isVoid ? (
        <Card title="VOID">
          <Text style={styles.warningText}>
            This invoice has been voided by {business.name}.
          </Text>
          <Text style={styles.meta}>
            No payment is required. This page remains available as a read-only
            record of the original invoice.
          </Text>
          <Row label="Original invoice total" value={invoice.totalCents} />
          <Row label="Balance due" value={invoice.balanceDueCents} strong />
        </Card>
      ) : (
        <Card title="I've paid">
          {pendingDeclarations.length > 0 ? (
            <Text style={styles.successText}>
              Your payment update is awaiting confirmation.
            </Text>
          ) : null}
          {canDeclarePayment ? (
            <View style={styles.form}>
              <TextInput
                accessibilityLabel="Payment amount"
                keyboardType="decimal-pad"
                onChangeText={(value) => {
                  setPaymentAmount(value);
                  if (paymentError) setPaymentError(null);
                }}
                placeholder="Amount paid"
                style={styles.input}
                value={paymentAmount}
              />
              <View style={styles.methodRow}>
                {INVOICE_PAYMENT_METHODS.map((method) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: paymentMethod === method }}
                    key={method}
                    onPress={() => setPaymentMethod(method)}
                    style={[
                      styles.methodChip,
                      paymentMethod === method && styles.methodChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.methodChipText,
                        paymentMethod === method && styles.methodChipTextActive,
                      ]}
                    >
                      {method.replaceAll('_', ' ')}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                accessibilityLabel="Payment reference"
                onChangeText={setPaymentReference}
                placeholder="Reference (optional)"
                style={styles.input}
                value={paymentReference}
              />
              <TextInput
                accessibilityLabel="Payment note"
                multiline
                onChangeText={setPaymentNote}
                placeholder="Note (optional)"
                style={[styles.input, styles.textArea]}
                value={paymentNote}
              />
              {paymentError ? (
                <Text style={styles.errorText}>{paymentError}</Text>
              ) : null}
              {paymentSuccess ? (
                <Text style={styles.successText}>{paymentSuccess}</Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={isSubmittingPayment}
                onPress={() => void submitPaymentDeclaration()}
                style={[
                  styles.primaryButton,
                  isSubmittingPayment && styles.disabledButton,
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  {isSubmittingPayment ? 'Submitting...' : "I've paid"}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.meta}>
              This invoice is no longer accepting payment updates.
            </Text>
          )}
        </Card>
      )}
    </ScrollView>
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

function Row({
  label,
  strong,
  value,
}: {
  label: string;
  strong?: boolean;
  value: number;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.meta, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.meta, strong && styles.strong]}>
        {formatAudCents(value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buttonText: {
    color: colours.primary,
    fontWeight: '800',
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
  container: {
    gap: 16,
    padding: 20,
    paddingBottom: 36,
  },
  errorTitle: {
    color: '#be123c',
    fontSize: 18,
    fontWeight: '800',
  },
  errorText: {
    color: '#be123c',
    fontSize: 13,
    fontWeight: '700',
  },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  hero: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 28,
    borderWidth: 1,
    padding: 22,
  },
  disabledButton: {
    opacity: 0.6,
  },
  form: {
    gap: 10,
  },
  input: {
    backgroundColor: '#fff',
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colours.ink,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  invoiceNumber: {
    color: colours.primary,
    fontSize: 16,
    fontWeight: '900',
    marginTop: 6,
  },
  item: {
    borderBottomColor: colours.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  itemCopy: {
    flex: 1,
  },
  itemName: {
    color: colours.ink,
    fontWeight: '800',
  },
  itemTotal: {
    color: colours.ink,
    fontWeight: '900',
  },
  meta: {
    color: colours.muted,
    fontSize: 14,
  },
  methodChip: {
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  methodChipActive: {
    backgroundColor: colours.primary,
    borderColor: colours.primary,
  },
  methodChipText: {
    color: colours.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  methodChipTextActive: {
    color: '#fff',
  },
  methodRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  muted: {
    color: colours.muted,
    fontSize: 14,
  },
  page: {
    backgroundColor: colours.background,
    flex: 1,
  },
  paymentDetails: {
    gap: 6,
  },
  pdfButton: {
    alignSelf: 'flex-start',
    backgroundColor: colours.primary,
    borderRadius: 999,
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  pdfButtonText: {
    color: '#fff',
    fontWeight: '900',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colours.primary,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '900',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  strong: {
    color: colours.ink,
    fontWeight: '900',
  },
  successText: {
    color: '#15803d',
    fontSize: 13,
    fontWeight: '700',
  },
  textArea: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  title: {
    color: colours.ink,
    fontSize: 30,
    fontWeight: '900',
  },
  total: {
    color: colours.ink,
    fontSize: 34,
    fontWeight: '900',
    marginTop: 16,
  },
  voidBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#e5e7eb',
    borderRadius: 999,
    color: '#4b5563',
    fontWeight: '900',
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  warningText: {
    color: '#be123c',
    fontWeight: '900',
  },
});
