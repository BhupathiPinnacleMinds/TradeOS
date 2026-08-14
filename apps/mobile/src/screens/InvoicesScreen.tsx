import {
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Invoice, InvoiceStatus } from '@tradieos/shared';
import {
  INVOICE_STATUSES,
  formatAudCents,
  formatBusinessDate,
  roleCanCreateInvoices,
} from '@tradieos/shared';
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
import { invoicesRequest } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'Invoices'>;
type InvoiceFilterStatus = InvoiceStatus | 'OUTSTANDING' | '';

export function InvoicesScreen() {
  const navigation = useNavigation<Navigation>();
  const route = useRoute<Route>();
  const { token, user } = useAuth();
  const canCreateInvoice = roleCanCreateInvoices(user?.role ?? 'READ_ONLY');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [status, setStatus] = useState<InvoiceFilterStatus>(
    route.params?.status ?? '',
  );
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
        const response = await invoicesRequest(token, {
          page: 1,
          pageSize: 25,
          search,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          status,
        });
        setInvoices(response.records);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "We couldn't load invoices.",
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

  useEffect(() => {
    setStatus(route.params?.status ?? '');
  }, [route.params?.status]);

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
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>INVOICES</Text>
            <Text style={styles.title}>Invoice pipeline</Text>
            <Text style={styles.subtitle}>
              Draft, send and record payments against customer invoices.
            </Text>
          </View>
          {canCreateInvoice ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('InvoiceForm')}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>+ New</Text>
            </Pressable>
          ) : null}
        </View>

        <TextInput
          onChangeText={setSearch}
          onSubmitEditing={() => void load()}
          placeholder="Search invoice, customer, job or title"
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
            {INVOICE_STATUSES.map((invoiceStatus) => (
              <FilterChip
                active={status === invoiceStatus}
                key={invoiceStatus}
                label={invoiceStatus.replaceAll('_', ' ')}
                onPress={() => setStatus(invoiceStatus)}
              />
            ))}
          </View>
        </ScrollView>

        {isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colours.primary} />
            <Text style={styles.muted}>Loading invoices...</Text>
          </View>
        ) : error ? (
          <View style={styles.stateCard}>
            <Text style={styles.errorTitle}>Invoices unavailable</Text>
            <Text style={styles.muted}>{error}</Text>
            <Pressable
              onPress={() => void load()}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : invoices.length === 0 ? (
          <View style={styles.stateCard}>
            <Text style={styles.emptyTitle}>
              {status
                ? `No ${status.toLowerCase()} invoices`
                : 'No invoices yet'}
            </Text>
            <Text style={styles.muted}>
              {canCreateInvoice
                ? 'Create a draft invoice from here, a customer or a completed job.'
                : 'Invoices you can view will appear here.'}
            </Text>
          </View>
        ) : (
          invoices.map((invoice) => (
            <Pressable
              accessibilityRole="button"
              key={invoice.id}
              onPress={() =>
                navigation.navigate('InvoiceDetails', { invoiceId: invoice.id })
              }
              style={[
                styles.card,
                invoice.displayStatus === 'OVERDUE' && styles.overdueCard,
              ]}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.invoiceNumber}>
                  {invoice.invoiceNumber}
                </Text>
                <Text
                  style={[styles.status, statusStyle(invoice.displayStatus)]}
                >
                  {invoice.displayStatus.replaceAll('_', ' ')}
                </Text>
              </View>
              <Text style={styles.cardTitle}>{invoice.title}</Text>
              <Text style={styles.muted}>{invoice.customer.displayName}</Text>
              <View style={styles.cardFooter}>
                <View>
                  <Text style={styles.total}>
                    {formatAudCents(invoice.totalCents)}
                  </Text>
                  <Text style={styles.balance}>
                    Balance {formatAudCents(invoice.balanceDueCents)}
                  </Text>
                </View>
                <Text style={styles.muted}>
                  Due{' '}
                  {formatBusinessDate(invoice.dueDate, user?.business.timezone)}
                </Text>
              </View>
              {invoice.job ? (
                <Text style={styles.linked}>
                  Job {invoice.job.jobNumber} · {invoice.job.title}
                </Text>
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

function statusStyle(status: InvoiceStatus) {
  if (status === 'PAID') return styles.statusPaid;
  if (status === 'OVERDUE') return styles.statusOverdue;
  if (status === 'SENT' || status === 'VIEWED') return styles.statusSent;
  if (status === 'PARTIALLY_PAID') return styles.statusPartial;
  if (status === 'VOID') return styles.statusVoid;
  return styles.statusDraft;
}

const styles = StyleSheet.create({
  balance: {
    color: colours.ink,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  card: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
  cardFooter: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: colours.ink,
    fontSize: 18,
    fontWeight: '800',
  },
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
  chipText: {
    color: colours.ink,
    fontWeight: '700',
  },
  chipTextActive: {
    color: '#fff',
  },
  container: {
    gap: 16,
    padding: 20,
    paddingBottom: 36,
  },
  emptyTitle: {
    color: colours.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  errorTitle: {
    color: '#be123c',
    fontSize: 18,
    fontWeight: '800',
  },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  filters: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  headerText: {
    flex: 1,
  },
  invoiceNumber: {
    color: colours.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  linked: {
    color: colours.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  muted: {
    color: colours.muted,
    fontSize: 14,
  },
  overdueCard: {
    borderColor: '#fb7185',
  },
  page: {
    backgroundColor: colours.background,
    flex: 1,
  },
  primaryButton: {
    backgroundColor: colours.primary,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '800',
  },
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
    alignSelf: 'flex-start',
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
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusDraft: {
    backgroundColor: '#e0e7ff',
    color: '#3730a3',
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
  subtitle: {
    color: colours.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 4,
  },
  title: {
    color: colours.ink,
    fontSize: 28,
    fontWeight: '900',
  },
  total: {
    color: colours.ink,
    fontSize: 20,
    fontWeight: '900',
  },
});
