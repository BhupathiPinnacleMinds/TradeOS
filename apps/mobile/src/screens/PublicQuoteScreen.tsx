import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { formatAudCents } from '@tradieos/shared';
import { useEffect, useState } from 'react';
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
  publicQuoteAcceptRequest,
  publicQuoteDeclineRequest,
  publicQuoteRequest,
} from '../api/client';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';
import type { PublicQuoteResponse } from '@tradieos/shared';

type Props = NativeStackScreenProps<RootStackParamList, 'PublicQuote'>;

export function PublicQuoteScreen({ route }: Props) {
  const { token } = route.params;
  const [response, setResponse] = useState<PublicQuoteResponse | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [declineComment, setDeclineComment] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setResponse(await publicQuoteRequest(token));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'This quote link could not be opened.',
      );
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  async function mutate(action: 'accept' | 'decline') {
    if (busy) return;
    setBusy(action);
    setError(null);
    try {
      const next =
        action === 'accept'
          ? await publicQuoteAcceptRequest(token, {
              acceptedByName: name,
              acceptedTerms: true,
              note,
            })
          : await publicQuoteDeclineRequest(token, {
              comment: declineComment,
              reason: 'OTHER',
            });
      setResponse(next);
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : 'Quote could not be updated.',
      );
    } finally {
      setBusy(null);
    }
  }

  if (!response && !error) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colours.primary} />
        <Text style={styles.muted}>Opening quote...</Text>
      </View>
    );
  }

  if (error && !response) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Quote unavailable</Text>
        <Text style={styles.muted}>{error}</Text>
        <Pressable style={styles.secondaryButton} onPress={() => void load()}>
          <Text style={styles.secondaryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!response) return null;

  const { business, quote, state } = response;
  const canRespond = state === 'ACTIVE';

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.container}>
      <View style={styles.document}>
        <Text style={styles.business}>{business.name}</Text>
        <Text style={styles.muted}>
          {[
            business.abn ? `ABN ${business.abn}` : null,
            business.phone,
            business.email,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <View style={styles.divider} />
        <Text style={styles.eyebrow}>Quote {quote.quoteNumber}</Text>
        <Text style={styles.title}>{quote.title}</Text>
        <Text style={styles.badge}>{stateLabel(state)}</Text>
        <Text style={styles.total}>{formatAudCents(quote.totalCents)}</Text>
        <Text style={styles.muted}>Customer: {quote.customer.displayName}</Text>
        {quote.customerSite ? (
          <Text style={styles.muted}>
            Service address: {quote.customerSite.addressLine1},{' '}
            {quote.customerSite.suburb} {quote.customerSite.state}{' '}
            {quote.customerSite.postcode}
          </Text>
        ) : null}
      </View>

      <Section title="Line items">
        {quote.lineItems.map((item, index) => (
          <View key={`${item.name}-${index}`} style={styles.lineItem}>
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
        <Detail label="Deposit" value={formatAudCents(quote.depositCents)} />
      </Section>

      <Section title="Notes and terms">
        <Text style={styles.bodyText}>
          {quote.customerNotes || 'No notes.'}
        </Text>
        <Text style={styles.bodyText}>
          {quote.termsAndConditions || 'No terms supplied.'}
        </Text>
      </Section>

      {canRespond ? (
        <Section title="Accept or decline">
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text style={styles.inputLabel}>Your name</Text>
          <TextInput
            onChangeText={setName}
            placeholder="Full name"
            style={styles.input}
            value={name}
          />
          <Text style={styles.muted}>
            By accepting, you agree to the quote and terms shown above.
          </Text>
          <TextInput
            onChangeText={setNote}
            placeholder="Optional note"
            style={styles.input}
            value={note}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy === 'accept'}
            onPress={() => void mutate('accept')}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryText}>
              {busy === 'accept' ? 'Accepting...' : 'Accept Quote'}
            </Text>
          </Pressable>
          <TextInput
            onChangeText={setDeclineComment}
            placeholder="Optional decline comment"
            style={styles.input}
            value={declineComment}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy === 'decline'}
            onPress={() => void mutate('decline')}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryText}>
              {busy === 'decline' ? 'Declining...' : 'Decline Quote'}
            </Text>
          </Pressable>
        </Section>
      ) : (
        <Section title="Status">
          <Text style={styles.bodyText}>
            {stateMessage(state, business.name)}
          </Text>
        </Section>
      )}
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

function stateLabel(state: PublicQuoteResponse['state']) {
  if (state === 'ACTIVE') return 'Awaiting response';
  return state.replaceAll('_', ' ');
}

function stateMessage(
  state: PublicQuoteResponse['state'],
  businessName: string,
) {
  if (state === 'ACCEPTED') return 'Quote accepted. Thank you.';
  if (state === 'DECLINED') return 'Quote declined.';
  if (state === 'EXPIRED') {
    return `This quote has expired. Please contact ${businessName}.`;
  }
  if (state === 'CONVERTED') {
    return 'This quote has already been accepted and converted.';
  }
  return 'This quote is no longer open for customer response.';
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#E0E7FF',
    borderRadius: 999,
    color: '#3730A3',
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  bodyText: { color: colours.ink, lineHeight: 22 },
  business: { color: colours.ink, fontSize: 20, fontWeight: '900' },
  centered: {
    alignItems: 'center',
    backgroundColor: colours.background,
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 24,
  },
  container: { gap: 16, padding: 20, paddingBottom: 48 },
  detailRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailStrong: { fontSize: 18 },
  detailValue: { color: colours.ink, fontWeight: '900', textAlign: 'right' },
  divider: { backgroundColor: colours.border, height: 1 },
  document: {
    backgroundColor: '#FFFFFF',
    borderColor: colours.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 10,
    padding: 20,
  },
  error: { color: '#B91C1C', fontWeight: '800' },
  eyebrow: { color: colours.primary, fontWeight: '900', letterSpacing: 0.8 },
  input: {
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colours.ink,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputLabel: { color: colours.ink, fontWeight: '900' },
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
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colours.primary,
    borderRadius: 16,
    padding: 14,
  },
  primaryText: { color: '#FFFFFF', fontWeight: '900' },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  secondaryText: { color: colours.ink, fontWeight: '900' },
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
