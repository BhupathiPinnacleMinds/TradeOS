import type { Customer, CustomerType } from '@tradieos/shared';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
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
import { customersRequest } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import type { RootStackParamList } from '../navigation/types';
import { canCreateCustomer } from '../permissions/roleVisibility';
import { colours } from '../theme';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

const customerTypes: Array<CustomerType | 'ALL'> = [
  'ALL',
  'RESIDENTIAL',
  'COMMERCIAL',
  'REAL_ESTATE',
  'STRATA',
  'BUILDER',
  'OTHER',
];

function label(value: string) {
  return value.replaceAll('_', ' ');
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "We couldn't load customers. Check your connection and try again.";
}

export function CustomersScreen() {
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const navigation = useNavigation<Navigation>();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [customerType, setCustomerType] = useState<CustomerType | 'ALL'>('ALL');
  const [archived, setArchived] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const canAddCustomer = canCreateCustomer(user?.role);

  const loadCustomers = useCallback(
    async (options: { refreshing?: boolean } = {}) => {
      if (!token) return;
      if (options.refreshing) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);
      try {
        const response = await customersRequest(token, {
          archived,
          customerType: customerType === 'ALL' ? undefined : customerType,
          page: 1,
          pageSize: 50,
          search,
          sortBy: 'displayName',
          sortOrder: 'asc',
        });
        setCustomers(response.records);
        setTotal(response.total);
      } catch (loadError) {
        const message = errorMessage(loadError);
        setError(message);
        showToast({ message, tone: 'error' });
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [archived, customerType, search, showToast, token],
  );

  useFocusEffect(
    useCallback(() => {
      void loadCustomers();
    }, [loadCustomers]),
  );

  const emptyTitle = useMemo(() => {
    if (search.trim()) return 'No customers match your search.';
    if (archived) return 'No archived customers.';
    return canAddCustomer
      ? 'No customers yet. Add your first customer to start creating jobs, quotes and invoices.'
      : 'No customers yet.';
  }, [archived, canAddCustomer, search]);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={() => void loadCustomers({ refreshing: true })}
        />
      }
    >
      <Text style={styles.eyebrow}>CUSTOMERS</Text>
      <Text style={styles.title}>Customer Management</Text>
      <Text style={styles.subtitle}>
        Keep customer contacts, properties and notes ready for jobs, quotes and
        invoices.
      </Text>

      {canAddCustomer ? (
        <Pressable
          accessibilityLabel="Add Customer"
          accessibilityRole="button"
          onPress={() => navigation.navigate('CustomerForm', {})}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>Add Customer</Text>
        </Pressable>
      ) : null}

      <TextInput
        accessibilityLabel="Search customers"
        autoCapitalize="none"
        onChangeText={setSearch}
        onSubmitEditing={() => void loadCustomers()}
        placeholder="Search name, email, phone, suburb, postcode or tag"
        placeholderTextColor={colours.muted}
        style={styles.search}
        value={search}
      />

      <View style={styles.toggleRow}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setArchived(false)}
          style={[styles.toggle, !archived && styles.toggleActive]}
        >
          <Text
            style={[styles.toggleText, !archived && styles.toggleTextActive]}
          >
            Active
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setArchived(true)}
          style={[styles.toggle, archived && styles.toggleActive]}
        >
          <Text
            style={[styles.toggleText, archived && styles.toggleTextActive]}
          >
            Archived
          </Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.filterRow}>
          {customerTypes.map((type) => (
            <Pressable
              accessibilityRole="button"
              key={type}
              onPress={() => setCustomerType(type)}
              style={[styles.chip, customerType === type && styles.chipActive]}
            >
              <Text
                style={[
                  styles.chipText,
                  customerType === type && styles.chipTextActive,
                ]}
              >
                {type === 'ALL' ? 'All types' : label(type)}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <View style={styles.countRow}>
        <Text style={styles.resultCount}>
          {customers.length} of {total} customer{total === 1 ? '' : 's'}
        </Text>
        <Pressable
          onPress={() => void loadCustomers()}
          style={styles.linkButton}
        >
          <Text style={styles.linkButtonText}>Refresh</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color={colours.primary} />
          <Text style={styles.stateText}>Loading customers...</Text>
        </View>
      ) : null}

      {!isLoading && error ? (
        <View style={styles.stateCard}>
          <Text style={styles.emptyTitle}>Customers unavailable</Text>
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      ) : null}

      {!isLoading && !error && customers.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{emptyTitle}</Text>
          <Text style={styles.emptyText}>
            Customer records stay scoped to your business workspace.
          </Text>
        </View>
      ) : null}

      {customers.map((customer) => (
        <CustomerCard
          customer={customer}
          key={customer.id}
          onPress={() =>
            navigation.navigate('CustomerDetails', { customerId: customer.id })
          }
        />
      ))}
    </ScrollView>
  );
}

function CustomerCard({
  customer,
  onPress,
}: {
  customer: Customer;
  onPress(): void;
}) {
  const primarySite = customer.sites.find((site) => site.isPrimary);
  const suburb = primarySite?.suburb ?? customer.suburb;
  return (
    <Pressable
      accessibilityHint="Opens customer details"
      accessibilityLabel={`Open ${customer.displayName}`}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.card}
    >
      <View style={styles.cardHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {customer.displayName.slice(0, 2).toUpperCase()}
          </Text>
        </View>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardTitle}>{customer.displayName}</Text>
          {customer.companyName ? (
            <Text style={styles.cardSub}>{customer.companyName}</Text>
          ) : null}
        </View>
        <View style={styles.typeBadge}>
          <Text style={styles.typeBadgeText}>
            {label(customer.customerType)}
          </Text>
        </View>
      </View>
      <Text style={styles.meta}>Phone: {customer.phone ?? 'Not recorded'}</Text>
      <Text style={styles.meta}>Email: {customer.email ?? 'Not recorded'}</Text>
      <Text style={styles.meta}>
        Primary suburb: {suburb ?? 'Not recorded'}
      </Text>
      <Text style={styles.meta}>
        Prefers: {label(customer.contactPreference)}
      </Text>
      {customer.tags.length ? (
        <View style={styles.tagRow}>
          {customer.tags.map((tag) => (
            <Text key={tag} style={styles.tag}>
              {tag}
            </Text>
          ))}
        </View>
      ) : null}
      {customer.isArchived ? (
        <Text style={styles.archivedText}>Archived</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  archivedText: { color: '#9F1239', fontWeight: '800', marginTop: 8 },
  avatar: {
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  avatarText: { color: colours.primary, fontWeight: '900' },
  card: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 14,
    padding: 16,
  },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  cardSub: { color: colours.muted, marginTop: 2 },
  cardTitle: { color: colours.ink, fontSize: 18, fontWeight: '900' },
  cardTitleWrap: { flex: 1 },
  chip: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  chipActive: { backgroundColor: colours.primary },
  chipText: { color: colours.muted, fontWeight: '800' },
  chipTextActive: { color: '#FFFFFF' },
  container: { padding: 24, paddingBottom: 40 },
  countRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  emptyCard: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 14,
    padding: 18,
  },
  emptyText: { color: colours.muted, lineHeight: 21, marginTop: 6 },
  emptyTitle: { color: colours.ink, fontSize: 18, fontWeight: '900' },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  filterRow: { flexDirection: 'row', gap: 8, paddingVertical: 10 },
  linkButton: { padding: 8 },
  linkButtonText: { color: colours.primary, fontWeight: '900' },
  meta: { color: colours.muted, marginTop: 8 },
  primaryButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colours.primary,
    borderRadius: 999,
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '900' },
  resultCount: { color: colours.muted, fontWeight: '800' },
  search: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 16,
    borderWidth: 1,
    color: colours.ink,
    fontSize: 16,
    marginTop: 22,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  stateCard: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    marginTop: 14,
    padding: 18,
  },
  stateText: { color: colours.muted },
  subtitle: { color: colours.muted, lineHeight: 22, marginTop: 8 },
  tag: {
    backgroundColor: '#F1F5F9',
    borderRadius: 999,
    color: colours.muted,
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  title: { color: colours.ink, fontSize: 34, fontWeight: '900', marginTop: 4 },
  toggle: {
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  toggleActive: { backgroundColor: colours.primary },
  toggleRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  toggleText: { color: colours.muted, fontWeight: '900' },
  toggleTextActive: { color: '#FFFFFF' },
  typeBadge: {
    backgroundColor: '#EFF6FF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  typeBadgeText: { color: '#1D4ED8', fontSize: 12, fontWeight: '900' },
});
