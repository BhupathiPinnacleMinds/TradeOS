import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Quote } from '@tradieos/shared';
import {
  formatAudCents,
  formatBusinessDate,
  roleCanAcceptOrDeclineQuote,
  roleCanCancelQuote,
  roleCanConvertQuote,
  roleCanEditQuote,
  roleCanReviseQuote,
  roleCanSendQuote,
} from '@tradieos/shared';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  acceptQuoteRequest,
  cancelQuoteRequest,
  convertQuoteToJobRequest,
  duplicateQuoteRequest,
  quotePdfUrl,
  quoteDetailRequest,
  sendQuoteRequest,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'QuoteDetails'>;

export function QuoteDetailsScreen({ navigation, route }: Props) {
  const { quoteId } = route.params;
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<
    NonNullable<Awaited<ReturnType<typeof quoteDetailRequest>>['documents']>
  >([]);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendSubject, setSendSubject] = useState('');
  const [sendMessage, setSendMessage] = useState('');
  const [publicQuoteUrl, setPublicQuoteUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await quoteDetailRequest(token, quoteId);
      setQuote(response.quote);
      setDocuments(response.documents ?? []);
      setPublicQuoteUrl(response.publicQuoteUrl ?? null);
      navigation.setOptions({ title: response.quote.quoteNumber });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "We couldn't load this quote.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [navigation, quoteId, token]);

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
        message:
          mutationError instanceof Error
            ? mutationError.message
            : "We couldn't update this quote.",
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
        <Text style={styles.muted}>Loading quote...</Text>
      </View>
    );
  }

  if (error || !quote) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Quote unavailable</Text>
        <Text style={styles.muted}>{error ?? 'Quote could not be found.'}</Text>
        <Pressable onPress={() => void load()} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const role = user?.role ?? 'READ_ONLY';
  const isConverted = quote.status === 'CONVERTED';

  function openSendModal() {
    if (!quote) return;
    setSendTo(quote.customer.email ?? '');
    setSendSubject(
      `Quote ${quote.quoteNumber} from ${user?.business.name ?? 'TradieOS'}`,
    );
    setSendMessage(
      `Hi ${quote.customer.displayName}, please review quote ${quote.quoteNumber}.`,
    );
    setSendModalOpen(true);
  }

  return (
    <ScrollView contentContainerStyle={styles.container} style={styles.page}>
      <View style={styles.hero}>
        <View style={styles.heroHeader}>
          <Text style={styles.eyebrow}>{quote.quoteNumber}</Text>
          <Text style={styles.badge}>{quote.status}</Text>
        </View>
        <Text style={styles.title}>{quote.title}</Text>
        <Text style={styles.muted}>{quote.customer.displayName}</Text>
        <Text style={styles.total}>{formatAudCents(quote.totalCents)}</Text>
        {quote.job ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              navigation.navigate('JobDetails', { jobId: quote.job!.id })
            }
            style={styles.linkedJobPill}
          >
            <Text style={styles.linkedJobText}>
              Linked job {quote.job.jobNumber}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.actions}>
        {roleCanEditQuote(role, quote.status) && !isConverted ? (
          <Action
            label="Edit draft"
            onPress={() =>
              navigation.navigate('QuoteForm', { quoteId: quote.id })
            }
          />
        ) : null}
        {roleCanSendQuote(role, quote.status) && !isConverted ? (
          <Action
            busy={busyAction === 'send'}
            label="Send"
            onPress={openSendModal}
          />
        ) : null}
        {roleCanReviseQuote(role, quote.status) && !isConverted ? (
          <Action
            label="Revise"
            onPress={() =>
              navigation.navigate('QuoteForm', { quoteId: quote.id })
            }
          />
        ) : null}
        {roleCanAcceptOrDeclineQuote(role, quote.status) && !isConverted ? (
          <Action
            busy={busyAction === 'accept'}
            label="Mark accepted"
            onPress={() =>
              Alert.alert('Mark quote accepted?', quote.quoteNumber, [
                { style: 'cancel', text: 'Cancel' },
                {
                  onPress: () =>
                    void mutate('accept', async () => {
                      if (!token) return;
                      await acceptQuoteRequest(
                        token,
                        quote.id,
                        quote.customer.displayName,
                        quote.customer.email ?? undefined,
                      );
                      showToast({
                        message: 'Quote accepted.',
                        tone: 'success',
                      });
                    }),
                  text: 'Accept',
                },
              ])
            }
          />
        ) : null}
        {roleCanConvertQuote(role, quote.status) && !isConverted ? (
          <Action
            busy={busyAction === 'convert'}
            label="Convert to Job"
            onPress={() =>
              void mutate('convert', async () => {
                if (!token) return;
                const response = await convertQuoteToJobRequest(
                  token,
                  quote.id,
                );
                showToast({
                  message: 'Quote converted to job.',
                  tone: 'success',
                });
                navigation.navigate('JobDetails', { jobId: response.jobId });
              })
            }
          />
        ) : null}
        <Action
          busy={busyAction === 'pdf'}
          label={isConverted ? 'Download PDF' : 'Generate PDF'}
          onPress={() =>
            void mutate('pdf', async () => {
              if (!token) return;
              const response = await fetch(quotePdfUrl(quote.id), {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!response.ok) {
                throw new Error('Quote PDF could not be generated.');
              }
              showToast({
                message: 'Quote PDF generated.',
                tone: 'success',
              });
            })
          }
        />
        <Action
          busy={busyAction === 'duplicate'}
          label="Duplicate Quote"
          onPress={() =>
            void mutate('duplicate', async () => {
              if (!token) return;
              const response = await duplicateQuoteRequest(token, quote.id);
              showToast({ message: 'Quote duplicated.', tone: 'success' });
              navigation.navigate('QuoteDetails', {
                quoteId: response.quote.id,
              });
            })
          }
        />
        {roleCanCancelQuote(role, quote.status) && !isConverted ? (
          <Action
            destructive
            label="Cancel"
            onPress={() =>
              Alert.alert('Cancel quote?', quote.quoteNumber, [
                { style: 'cancel', text: 'Keep' },
                {
                  onPress: () =>
                    void mutate('cancel', async () => {
                      if (!token) return;
                      await cancelQuoteRequest(
                        token,
                        quote.id,
                        'Cancelled in app',
                      );
                    }),
                  style: 'destructive',
                  text: 'Cancel quote',
                },
              ])
            }
          />
        ) : null}
      </View>

      {quote.job ? (
        <Section
          title={isConverted ? 'Converted to Job' : 'Source / Linked Job'}
        >
          <Text style={styles.lineTitle}>{quote.job.jobNumber}</Text>
          <Text style={styles.muted}>{quote.job.title}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              navigation.navigate('JobDetails', { jobId: quote.job!.id })
            }
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>View Job</Text>
          </Pressable>
        </Section>
      ) : null}

      <Section title="Details">
        <Detail
          label="Issue date"
          value={formatBusinessDate(quote.issueDate, user?.business.timezone)}
        />
        <Detail
          label="Expiry date"
          value={
            quote.expiryDate
              ? formatBusinessDate(quote.expiryDate, user?.business.timezone)
              : 'Not set'
          }
        />
        <Detail
          label="Pricing"
          value={quote.pricingMode.replaceAll('_', ' ')}
        />
        <Detail label="Linked job" value={quote.job?.jobNumber ?? 'None'} />
      </Section>

      <Section title="Line items">
        {quote.lineItems.map((item) => (
          <View key={item.id} style={styles.lineItem}>
            <View>
              <Text style={styles.lineTitle}>{item.name}</Text>
              <Text style={styles.muted}>
                {item.quantity} {item.unit} ×{' '}
                {formatAudCents(item.unitPriceCents)}
              </Text>
            </View>
            <Text style={styles.lineTotal}>
              {formatAudCents(item.lineTotalCents)}
            </Text>
          </View>
        ))}
      </Section>

      <Section title="Totals">
        <Detail label="Subtotal" value={formatAudCents(quote.subtotalCents)} />
        <Detail label="Discount" value={formatAudCents(quote.discountCents)} />
        <Detail label="GST" value={formatAudCents(quote.gstCents)} />
        <Detail label="Total" value={formatAudCents(quote.totalCents)} strong />
        <Detail
          label="Deposit requested"
          value={formatAudCents(quote.depositCents)}
        />
      </Section>

      <Section title="Notes and terms">
        <Text style={styles.bodyText}>
          {quote.customerNotes || 'No customer notes.'}
        </Text>
        <Text style={styles.bodyText}>
          {quote.termsAndConditions || 'No terms added yet.'}
        </Text>
      </Section>

      <Section title="Documents">
        {documents.length ? (
          documents.map((document) => (
            <View key={document.id} style={styles.documentRow}>
              <View>
                <Text style={styles.lineTitle}>Quote PDF</Text>
                <Text style={styles.muted}>
                  {document.fileName} · Revision {document.version}
                </Text>
                <Text style={styles.muted}>
                  Generated{' '}
                  {formatBusinessDate(
                    document.generatedAt,
                    user?.business.timezone,
                  )}
                </Text>
              </View>
            </View>
          ))
        ) : (
          <Text style={styles.muted}>
            Generate or send the quote to create a customer PDF.
          </Text>
        )}
      </Section>

      <SendQuoteModal
        busy={busyAction === 'send'}
        message={sendMessage}
        onCancel={() => setSendModalOpen(false)}
        onChangeMessage={setSendMessage}
        onChangeSubject={setSendSubject}
        onChangeTo={setSendTo}
        onSend={() =>
          void mutate('send', async () => {
            if (!token) return;
            const response = await sendQuoteRequest(token, quote.id, {
              message: sendMessage,
              subject: sendSubject,
              to: sendTo,
            });
            setDocuments(response.documents ?? []);
            setPublicQuoteUrl(response.publicQuoteUrl ?? null);
            setSendModalOpen(false);
            showToast({
              message: 'Quote sent using local email provider.',
              tone: 'success',
            });
          })
        }
        publicQuoteUrl={publicQuoteUrl}
        subject={sendSubject}
        to={sendTo}
        visible={sendModalOpen}
      />
    </ScrollView>
  );
}

function SendQuoteModal({
  busy,
  message,
  onCancel,
  onChangeMessage,
  onChangeSubject,
  onChangeTo,
  onSend,
  publicQuoteUrl,
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
  publicQuoteUrl: string | null;
  subject: string;
  to: string;
  visible: boolean;
}) {
  return (
    <Modal animationType="slide" transparent visible={visible}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.sectionTitle}>Send Quote</Text>
          <Text style={styles.inputLabel}>To</Text>
          <TextInput
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={onChangeTo}
            placeholder="customer@example.com"
            style={styles.input}
            value={to}
          />
          <Text style={styles.inputLabel}>Subject</Text>
          <TextInput
            onChangeText={onChangeSubject}
            style={styles.input}
            value={subject}
          />
          <Text style={styles.inputLabel}>Message</Text>
          <TextInput
            multiline
            onChangeText={onChangeMessage}
            style={[styles.input, styles.textArea]}
            value={message}
          />
          <Text style={styles.muted}>Attachment: Quote PDF</Text>
          <Text style={styles.muted}>
            Secure link:{' '}
            {publicQuoteUrl ? 'available after send' : 'created on send'}
          </Text>
          <View style={styles.modalActions}>
            <Action label="Cancel" onPress={onCancel} />
            <Action busy={busy} label="Send Quote" onPress={onSend} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Action({
  busy,
  destructive,
  label,
  onPress,
}: {
  busy?: boolean;
  destructive?: boolean;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={[styles.actionButton, destructive && styles.destructiveButton]}
    >
      <Text
        style={[
          styles.actionButtonText,
          destructive && styles.destructiveButtonText,
        ]}
      >
        {busy ? 'Working...' : label}
      </Text>
    </Pressable>
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

function Detail({
  label,
  strong,
  value,
}: {
  label: string;
  strong?: boolean;
  value: string;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={[styles.detailValue, strong && styles.detailStrong]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    backgroundColor: colours.primary,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  actionButtonText: { color: '#FFFFFF', fontWeight: '900' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  badge: {
    backgroundColor: '#E0E7FF',
    borderRadius: 999,
    color: '#3730A3',
    fontSize: 12,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  bodyText: { color: colours.ink, lineHeight: 22 },
  centered: {
    alignItems: 'center',
    backgroundColor: colours.background,
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 24,
  },
  container: { gap: 16, padding: 20, paddingBottom: 40 },
  destructiveButton: { backgroundColor: '#FEE2E2' },
  destructiveButtonText: { color: '#991B1B' },
  detailRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailStrong: { fontSize: 18 },
  detailValue: { color: colours.ink, fontWeight: '800', textAlign: 'right' },
  documentRow: {
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
  },
  errorTitle: { color: '#B91C1C', fontSize: 18, fontWeight: '900' },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  hero: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 8,
    padding: 20,
  },
  heroHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  lineItem: {
    alignItems: 'center',
    borderBottomColor: colours.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  lineTitle: { color: colours.ink, fontWeight: '900' },
  lineTotal: { color: colours.ink, fontWeight: '900' },
  linkedJobPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  linkedJobText: { color: '#047857', fontWeight: '900' },
  input: {
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colours.ink,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputLabel: { color: colours.ink, fontWeight: '900' },
  muted: { color: colours.muted, lineHeight: 20 },
  page: { backgroundColor: colours.background, flex: 1 },
  modalActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  modalBackdrop: {
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colours.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    gap: 12,
    padding: 20,
  },
  secondaryButton: {
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButtonText: { color: colours.ink, fontWeight: '800' },
  section: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 22,
    borderWidth: 1,
    gap: 12,
    padding: 18,
  },
  sectionTitle: { color: colours.ink, fontSize: 18, fontWeight: '900' },
  title: { color: colours.ink, fontSize: 26, fontWeight: '900' },
  total: { color: colours.ink, fontSize: 30, fontWeight: '900' },
  textArea: { minHeight: 110, textAlignVertical: 'top' },
});
