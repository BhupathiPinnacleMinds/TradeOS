import {
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AccountsReceivableResponse, Invoice } from '@tradieos/shared';
import { formatAudCents, formatBusinessDate } from '@tradieos/shared';
import { useCallback, useEffect, useState } from 'react';
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
import { accountsReceivableRequest } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'AccountsReceivable'>;
type ArStatus = 'OUTSTANDING' | 'OVERDUE' | 'DUE_SOON' | 'PAID' | '';

export function AccountsReceivableScreen() {
  const navigation = useNavigation<Navigation>();
  const route = useRoute<Route>();
  const { token, user } = useAuth();
  const [data, setData] = useState<AccountsReceivableResponse | null>(null);
  const [status, setStatus] = useState<ArStatus>(route.params?.status ?? '');
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
        const response = await accountsReceivableRequest(token, {
          customerId: route.params?.customerId,
          search,
          status,
        });
        setData(response);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "We couldn't load accounts receivable.",
        );
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [route.params?.customerId, search, status, token],
  );

  useEffect(() => {
    setStatus(route.params?.status ?? '');
  }, [route.params?.status]);

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
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>ACCOUNTS RECEIVABLE</Text>
          <Text style={styles.title}>Money to collect</Text>
          <Text style={styles.subtitle}>
            Track outstanding invoices, overdue balances and payments received.
          </Text>
        </View>

        <TextInput
          onChangeText={setSearch}
          onSubmitEditing={() => void load()}
          placeholder="Search customer or invoice number"
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
            <FilterChip
              active={status === 'OUTSTANDING'}
              label="Outstanding"
              onPress={() => setStatus('OUTSTANDING')}
            />
            <FilterChip
              active={status === 'OVERDUE'}
              label="Overdue"
              onPress={() => setStatus('OVERDUE')}
            />
            <FilterChip
              active={status === 'DUE_SOON'}
              label="Due soon"
              onPress={() => setStatus('DUE_SOON')}
            />
            <FilterChip
              active={status === 'PAID'}
              label="Paid"
              onPress={() => setStatus('PAID')}
            />
          </View>
        </ScrollView>

        {isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colours.primary} />
            <Text style={styles.muted}>Loading receivables...</Text>
          </View>
        ) : error ? (
          <View style={styles.stateCard}>
            <Text style={styles.errorTitle}>Receivables unavailable</Text>
            <Text style={styles.muted}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void load()}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : data ? (
          <>
            <View style={styles.grid}>
              <Metric
                label="Total outstanding"
                value={formatAudCents(data.summary.totalOutstandingCents)}
              />
              <Metric
                label="Total overdue"
                tone="warning"
                value={formatAudCents(data.summary.totalOverdueCents)}
              />
            </View>
            <View style={styles.grid}>
              <Metric
                label="Due soon"
                value={formatAudCents(data.summary.dueSoonCents)}
              />
              <Metric
                label="Paid this month"
                value={formatAudCents(data.summary.paidThisMonthCents)}
              />
            </View>
            <View style={styles.grid}>
              <Metric
                label="Overdue invoices"
                tone="warning"
                value={data.summary.overdueInvoiceCount}
              />
              <Metric
                label="Outstanding invoices"
                value={data.summary.outstandingInvoiceCount}
              />
            </View>

            <InvoiceSection
              invoices={data.sections.overdue}
              onOpen={(invoice) =>
                navigation.navigate('InvoiceDetails', { invoiceId: invoice.id })
              }
              title="Overdue"
              timezone={user?.business.timezone}
            />
            <InvoiceSection
              invoices={data.sections.dueSoon}
              onOpen={(invoice) =>
                navigation.navigate('InvoiceDetails', { invoiceId: invoice.id })
              }
              title="Due soon"
              timezone={user?.business.timezone}
            />
            <InvoiceSection
              invoices={data.sections.outstanding}
              onOpen={(invoice) =>
                navigation.navigate('InvoiceDetails', { invoiceId: invoice.id })
              }
              title="Outstanding"
              timezone={user?.business.timezone}
            />
            <InvoiceSection
              invoices={data.sections.paid}
              onOpen={(invoice) =>
                navigation.navigate('InvoiceDetails', { invoiceId: invoice.id })
              }
              title="Paid"
              timezone={user?.business.timezone}
            />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Metric({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: 'warning';
  value: number | string;
}) {
  return (
    <View style={[styles.metric, tone === 'warning' && styles.warningMetric]}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
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

function InvoiceSection({
  invoices,
  onOpen,
  timezone,
  title,
}: {
  invoices: Invoice[];
  onOpen(invoice: Invoice): void;
  timezone?: string;
  title: string;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {invoices.length === 0 ? (
        <Text style={styles.emptyText}>No invoices in this section.</Text>
      ) : (
        invoices.map((invoice) => (
          <Pressable
            accessibilityRole="button"
            key={invoice.id}
            onPress={() => onOpen(invoice)}
            style={styles.invoiceCard}
          >
            <View style={styles.invoiceHeader}>
              <Text style={styles.invoiceNumber}>{invoice.invoiceNumber}</Text>
              <Text style={styles.status}>
                {invoice.displayStatus.replaceAll('_', ' ')}
              </Text>
            </View>
            <Text style={styles.invoiceTitle}>{invoice.title}</Text>
            <Text style={styles.muted}>{invoice.customer.displayName}</Text>
            <View style={styles.invoiceFooter}>
              <Text style={styles.balance}>
                Balance {formatAudCents(invoice.balanceDueCents)}
              </Text>
              <Text style={styles.muted}>
                Due {formatBusinessDate(invoice.dueDate, timezone)}
              </Text>
            </View>
          </Pressable>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  balance: { color: colours.ink, fontWeight: '900' },
  chip: {
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  chipActive: {
    backgroundColor: colours.primary,
    borderColor: colours.primary,
  },
  chipText: { color: colours.ink, fontWeight: '800' },
  chipTextActive: { color: '#fff' },
  container: { gap: 16, padding: 20, paddingBottom: 36 },
  emptyText: { color: colours.muted, marginTop: 8 },
  errorTitle: { color: '#be123c', fontSize: 18, fontWeight: '900' },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  filters: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  grid: { flexDirection: 'row', gap: 12 },
  hero: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 28,
    borderWidth: 1,
    padding: 22,
  },
  invoiceCard: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  invoiceFooter: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
  },
  invoiceHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  invoiceNumber: { color: colours.primary, fontSize: 13, fontWeight: '900' },
  invoiceTitle: { color: colours.ink, fontSize: 17, fontWeight: '900' },
  metric: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    flex: 1,
    padding: 16,
  },
  metricLabel: { color: colours.muted, marginTop: 6 },
  metricValue: { color: colours.ink, fontSize: 22, fontWeight: '900' },
  muted: { color: colours.muted, fontSize: 14 },
  page: { backgroundColor: colours.background, flex: 1 },
  search: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    color: colours.ink,
    padding: 14,
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
  secondaryButtonText: { color: colours.primary, fontWeight: '800' },
  section: { gap: 10 },
  sectionTitle: { color: colours.ink, fontSize: 20, fontWeight: '900' },
  stateCard: {
    alignItems: 'flex-start',
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 10,
    padding: 20,
  },
  status: {
    backgroundColor: '#eef2ff',
    borderRadius: 999,
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  subtitle: {
    color: colours.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 6,
  },
  title: { color: colours.ink, fontSize: 28, fontWeight: '900' },
  warningMetric: { borderColor: '#FDBA74' },
});
