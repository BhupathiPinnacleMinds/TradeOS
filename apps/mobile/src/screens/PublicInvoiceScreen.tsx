import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { PublicInvoiceResponse } from '@tradieos/shared';
import { formatAudCents, formatBusinessDate } from '@tradieos/shared';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { publicInvoiceRequest, publicInvoiceViewRequest } from '../api/client';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'PublicInvoice'>;

export function PublicInvoiceScreen({ route }: Props) {
  const { token } = route.params;
  const [data, setData] = useState<PublicInvoiceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <ScrollView contentContainerStyle={styles.container} style={styles.page}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{business.name}</Text>
        <Text style={styles.title}>
          {isTaxInvoice ? 'Tax Invoice' : 'Invoice'}
        </Text>
        <Text style={styles.invoiceNumber}>{invoice.invoiceNumber}</Text>
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
        <Text style={styles.meta}>
          {invoice.paymentTerms ||
            'Please contact the business for payment details.'}
        </Text>
        {invoice.customerNotes ? (
          <Text style={styles.meta}>{invoice.customerNotes}</Text>
        ) : null}
      </Card>
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
  muted: {
    color: colours.muted,
    fontSize: 14,
  },
  page: {
    backgroundColor: colours.background,
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  strong: {
    color: colours.ink,
    fontWeight: '900',
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
});
