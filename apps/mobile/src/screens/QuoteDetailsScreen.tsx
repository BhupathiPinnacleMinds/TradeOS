import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Quote } from '@tradieos/shared';
import {
  formatAudCents,
  formatBusinessDate,
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
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  acceptQuoteRequest,
  cancelQuoteRequest,
  convertQuoteToJobRequest,
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

  const load = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await quoteDetailRequest(token, quoteId);
      setQuote(response.quote);
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
      </View>

      <View style={styles.actions}>
        {roleCanEditQuote(role, quote.status) ? (
          <Action
            label="Edit draft"
            onPress={() =>
              navigation.navigate('QuoteForm', { quoteId: quote.id })
            }
          />
        ) : null}
        {roleCanSendQuote(role, quote.status) ? (
          <Action
            busy={busyAction === 'send'}
            label="Send"
            onPress={() =>
              void mutate('send', async () => {
                if (!token) return;
                await sendQuoteRequest(token, quote.id);
                showToast({
                  message: 'Quote sent using local email provider.',
                  tone: 'success',
                });
              })
            }
          />
        ) : null}
        {roleCanReviseQuote(role, quote.status) ? (
          <Action
            label="Revise"
            onPress={() =>
              navigation.navigate('QuoteForm', { quoteId: quote.id })
            }
          />
        ) : null}
        {['SENT', 'VIEWED'].includes(quote.status) ? (
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
        {roleCanConvertQuote(role, quote.status) ? (
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
        {roleCanCancelQuote(role, quote.status) ? (
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
    </ScrollView>
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
  muted: { color: colours.muted, lineHeight: 20 },
  page: { backgroundColor: colours.background, flex: 1 },
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
});
