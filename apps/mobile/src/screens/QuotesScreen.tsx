import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Quote, QuoteStatus } from '@tradieos/shared';
import {
  QUOTE_STATUSES,
  formatAudCents,
  formatBusinessDate,
  roleCanCreateQuotes,
} from '@tradieos/shared';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { quotesRequest } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

export function QuotesScreen() {
  const navigation = useNavigation<Navigation>();
  const { token, user } = useAuth();
  const canCreateQuote = roleCanCreateQuotes(user?.role ?? 'READ_ONLY');
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [status, setStatus] = useState<QuoteStatus | ''>('');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      if (!token) return;
      if (refresh) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);
      try {
        const response = await quotesRequest(token, {
          page: 1,
          pageSize: 25,
          search,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          status,
        });
        setQuotes(response.records);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "We couldn't load quotes.",
        );
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [search, status, token],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={styles.page}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            onRefresh={() => void load(true)}
            refreshing={isRefreshing}
            tintColor={colours.primary}
          />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>QUOTES</Text>
            <Text style={styles.title}>Quote pipeline</Text>
            <Text style={styles.subtitle}>
              Draft, send and convert accepted quotes into jobs.
            </Text>
          </View>
          {canCreateQuote ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('QuoteForm')}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>+ New</Text>
            </Pressable>
          ) : null}
        </View>

        <TextInput
          onChangeText={setSearch}
          onSubmitEditing={() => void load()}
          placeholder="Search quote, customer or title"
          placeholderTextColor={colours.muted}
          style={styles.search}
          value={search}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.filters}>
            <FilterChip
              active={!status}
              label="All"
              onPress={() => setStatus('')}
            />
            {QUOTE_STATUSES.map((quoteStatus) => (
              <FilterChip
                active={status === quoteStatus}
                key={quoteStatus}
                label={quoteStatus.replaceAll('_', ' ')}
                onPress={() => setStatus(quoteStatus)}
              />
            ))}
          </View>
        </ScrollView>

        {isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colours.primary} />
            <Text style={styles.muted}>Loading quotes...</Text>
          </View>
        ) : error ? (
          <View style={styles.stateCard}>
            <Text style={styles.errorTitle}>Quotes unavailable</Text>
            <Text style={styles.muted}>{error}</Text>
            <Pressable
              onPress={() => void load()}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : quotes.length === 0 ? (
          <View style={styles.stateCard}>
            <Text style={styles.emptyTitle}>
              {status ? `No ${status.toLowerCase()} quotes` : 'No quotes yet'}
            </Text>
            <Text style={styles.muted}>
              {canCreateQuote
                ? 'Create a draft quote from here, a customer, a job or an appointment.'
                : 'Quotes connected to your work will appear here.'}
            </Text>
          </View>
        ) : (
          quotes.map((quote) => (
            <Pressable
              accessibilityRole="button"
              key={quote.id}
              onPress={() =>
                navigation.navigate('QuoteDetails', { quoteId: quote.id })
              }
              style={styles.card}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.quoteNumber}>{quote.quoteNumber}</Text>
                <Text style={[styles.status, statusStyle(quote.status)]}>
                  {quote.status}
                </Text>
              </View>
              <Text style={styles.cardTitle}>{quote.title}</Text>
              <Text style={styles.muted}>{quote.customer.displayName}</Text>
              {isExpiringSoon(quote) ? (
                <Text style={styles.warning}>Expiring soon</Text>
              ) : null}
              <View style={styles.cardFooter}>
                <Text style={styles.total}>
                  {formatAudCents(quote.totalCents)}
                </Text>
                <Text style={styles.muted}>
                  Expires{' '}
                  {quote.expiryDate
                    ? formatBusinessDate(
                        quote.expiryDate,
                        user?.business.timezone,
                      )
                    : 'not set'}
                </Text>
              </View>
              {quote.job ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    navigation.navigate('JobDetails', { jobId: quote.job!.id })
                  }
                  style={styles.linkedPill}
                >
                  <Text style={styles.linked}>
                    Linked job: {quote.job.jobNumber}
                  </Text>
                </Pressable>
              ) : null}
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function FilterChip({
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

function statusStyle(status: QuoteStatus) {
  if (status === 'ACCEPTED') return styles.statusAccepted;
  if (status === 'SENT' || status === 'VIEWED') return styles.statusSent;
  if (status === 'CONVERTED') return styles.statusConverted;
  if (['DECLINED', 'EXPIRED', 'CANCELLED'].includes(status)) {
    return styles.statusTerminal;
  }
  return styles.statusDraft;
}

function isExpiringSoon(quote: Quote) {
  if (!quote.expiryDate || !['SENT', 'VIEWED'].includes(quote.status)) {
    return false;
  }
  const remainingMs = new Date(quote.expiryDate).getTime() - Date.now();
  return remainingMs > 0 && remainingMs <= 3 * 24 * 60 * 60 * 1000;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 22,
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
  cardFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardTitle: { color: colours.ink, fontSize: 18, fontWeight: '800' },
  chip: {
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  chipActive: {
    backgroundColor: colours.primary,
    borderColor: colours.primary,
  },
  chipText: { color: colours.muted, fontWeight: '800' },
  chipTextActive: { color: '#FFFFFF' },
  container: { gap: 16, padding: 20, paddingBottom: 40 },
  emptyTitle: { color: colours.ink, fontSize: 18, fontWeight: '900' },
  errorTitle: { color: '#B91C1C', fontSize: 18, fontWeight: '900' },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  filters: { flexDirection: 'row', gap: 10, paddingRight: 20 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
  },
  linked: { color: '#047857', fontSize: 13, fontWeight: '900' },
  linkedPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  muted: { color: colours.muted, lineHeight: 20 },
  page: { backgroundColor: colours.background, flex: 1 },
  primaryButton: {
    backgroundColor: colours.primary,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '900' },
  quoteNumber: { color: colours.primary, fontWeight: '900' },
  search: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    color: colours.ink,
    padding: 14,
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButtonText: { color: colours.ink, fontWeight: '800' },
  stateCard: {
    alignItems: 'flex-start',
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 22,
    borderWidth: 1,
    gap: 10,
    padding: 20,
  },
  status: {
    borderRadius: 999,
    fontSize: 11,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusAccepted: { backgroundColor: '#DCFCE7', color: '#166534' },
  statusConverted: { backgroundColor: '#E0E7FF', color: '#3730A3' },
  statusDraft: { backgroundColor: '#F1F5F9', color: '#334155' },
  statusSent: { backgroundColor: '#FEF3C7', color: '#92400E' },
  statusTerminal: { backgroundColor: '#FEE2E2', color: '#991B1B' },
  subtitle: { color: colours.muted, maxWidth: 260 },
  title: { color: colours.ink, fontSize: 28, fontWeight: '900' },
  total: { color: colours.ink, fontSize: 18, fontWeight: '900' },
  warning: { color: '#B45309', fontSize: 13, fontWeight: '900' },
});
