import type { Customer, CustomerSitePayload } from '@tradieos/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  archiveCustomerRequest,
  archiveCustomerSiteRequest,
  createCustomerSiteRequest,
  customerDetailRequest,
  restoreCustomerRequest,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'CustomerDetails'>;

function label(value: string) {
  return value.replaceAll('_', ' ');
}

function formatDate(date: string | null) {
  if (!date) return 'Not recorded';
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date));
}

export function CustomerDetailsScreen({ navigation, route }: Props) {
  const { customerId } = route.params;
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [activity, setActivity] = useState<
    Array<{ action: string; createdAt: string }>
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [siteModal, setSiteModal] = useState(false);
  const [siteForm, setSiteForm] = useState<CustomerSitePayload>({
    addressLine1: '',
    isPrimary: false,
    label: 'Home',
    postcode: '',
    state: 'NSW',
    suburb: '',
  });

  const canArchive = ['OWNER', 'ADMIN', 'OFFICE_MANAGER'].includes(
    user?.role ?? '',
  );
  const canEdit = [
    'OWNER',
    'ADMIN',
    'OFFICE_MANAGER',
    'SCHEDULER',
    'SALES',
  ].includes(user?.role ?? '');

  async function loadCustomer() {
    if (!token) return;
    setIsLoading(true);
    try {
      const response = await customerDetailRequest(token, customerId);
      setCustomer(response.customer);
      setActivity(response.activity);
      navigation.setOptions({ title: response.customer.displayName });
    } catch {
      showToast({ message: "We couldn't load this customer.", tone: 'error' });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadCustomer();
  }, [customerId, token]);

  async function archiveOrRestore() {
    if (!token || !customer) return;
    setIsBusy(true);
    try {
      const response = customer.isArchived
        ? await restoreCustomerRequest(token, customer.id)
        : await archiveCustomerRequest(token, customer.id);
      setCustomer(response.customer);
      setConfirmArchive(false);
      await loadCustomer();
      showToast({
        message: customer.isArchived
          ? `${response.customer.displayName} was restored.`
          : `${response.customer.displayName} was archived.`,
        tone: 'success',
      });
    } catch (error) {
      showToast({
        message:
          error instanceof Error
            ? error.message
            : "We couldn't update this customer.",
        tone: 'error',
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function saveSite() {
    if (!token || !customer || isBusy) return;
    setIsBusy(true);
    try {
      await createCustomerSiteRequest(token, customer.id, siteForm);
      setSiteModal(false);
      setSiteForm({
        addressLine1: '',
        isPrimary: false,
        label: 'Home',
        postcode: '',
        state: 'NSW',
        suburb: '',
      });
      await loadCustomer();
      showToast({ message: 'Service location added.', tone: 'success' });
    } catch (error) {
      showToast({
        message:
          error instanceof Error
            ? error.message
            : "We couldn't save this location.",
        tone: 'error',
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function archiveSite(siteId: string) {
    if (!token || !customer || isBusy) return;
    setIsBusy(true);
    try {
      await archiveCustomerSiteRequest(token, customer.id, siteId);
      await loadCustomer();
      showToast({ message: 'Service location archived.', tone: 'success' });
    } catch {
      showToast({
        message: "We couldn't archive this location.",
        tone: 'error',
      });
    } finally {
      setIsBusy(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.loadingPage}>
        <ActivityIndicator color={colours.primary} />
        <Text style={styles.muted}>Loading customer...</Text>
      </View>
    );
  }

  if (!customer) {
    return (
      <View style={styles.loadingPage}>
        <Text style={styles.title}>Customer not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.eyebrow}>CUSTOMER PROFILE</Text>
        <Text style={styles.title}>{customer.displayName}</Text>
        {customer.companyName ? (
          <Text style={styles.subtitle}>{customer.companyName}</Text>
        ) : null}
        {customer.isArchived ? (
          <Text style={styles.archived}>Archived customer</Text>
        ) : null}

        <View style={styles.quickRow}>
          <QuickAction
            disabled={!customer.phone}
            label="Call"
            onPress={() => void Linking.openURL(`tel:${customer.phone}`)}
          />
          <QuickAction
            disabled={!customer.phone}
            label="SMS"
            onPress={() => void Linking.openURL(`sms:${customer.phone}`)}
          />
          <QuickAction
            disabled={!customer.email}
            label="Email"
            onPress={() => void Linking.openURL(`mailto:${customer.email}`)}
          />
          {canEdit ? (
            <QuickAction
              label="Edit"
              onPress={() =>
                navigation.navigate('CustomerForm', { customerId: customer.id })
              }
            />
          ) : null}
        </View>

        <Card title="Profile summary">
          <Text style={styles.meta}>
            Customer since {formatDate(customer.createdAt)}
          </Text>
          <Text style={styles.meta}>
            {label(customer.customerType)} customer
          </Text>
          <Text style={styles.meta}>
            Prefers {label(customer.contactPreference)}
          </Text>
          <Text style={styles.meta}>
            Primary suburb:{' '}
            {customer.sites.find((site) => site.isPrimary)?.suburb ??
              customer.suburb ??
              'Not recorded'}
          </Text>
          <Text style={styles.meta}>
            {customer.sites.length} service location
            {customer.sites.length === 1 ? '' : 's'}
          </Text>
        </Card>

        <Card title="Contact details">
          <Text style={styles.meta}>
            Phone: {customer.phone ?? 'Not recorded'}
          </Text>
          <Text style={styles.meta}>
            Email: {customer.email ?? 'Not recorded'}
          </Text>
          <Text style={styles.meta}>
            Alternate phone: {customer.alternatePhone ?? 'Not recorded'}
          </Text>
          <Text style={styles.meta}>
            Address:{' '}
            {[
              customer.addressLine1,
              customer.addressLine2,
              customer.suburb,
              customer.state,
              customer.postcode,
            ]
              .filter(Boolean)
              .join(', ') || 'Not recorded'}
          </Text>
          <Text style={styles.meta}>
            Notes: {customer.notes ?? 'No notes recorded.'}
          </Text>
          <View style={styles.tagRow}>
            {customer.tags.map((tag) => (
              <Text key={tag} style={styles.tag}>
                {tag}
              </Text>
            ))}
          </View>
        </Card>

        <Card title="Service locations">
          {customer.sites.length === 0 ? (
            <Text style={styles.muted}>No service locations recorded yet.</Text>
          ) : null}
          {customer.sites.map((site) => (
            <View key={site.id} style={styles.siteCard}>
              <Text style={styles.siteTitle}>
                {site.label} {site.isPrimary ? 'â€¢ Primary' : ''}
              </Text>
              <Text style={styles.meta}>
                {[
                  site.addressLine1,
                  site.addressLine2,
                  site.suburb,
                  site.state,
                  site.postcode,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </Text>
              {canArchive ? (
                <Pressable
                  onPress={() => void archiveSite(site.id)}
                  style={styles.linkButton}
                >
                  <Text style={styles.linkText}>Archive location</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          {canEdit ? (
            <Pressable
              onPress={() => setSiteModal(true)}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryText}>Add service location</Text>
            </Pressable>
          ) : null}
        </Card>

        <Card title="Future history">
          <Text style={styles.muted}>
            No jobs recorded for this customer yet.
          </Text>
          <Text style={styles.muted}>No quotes created yet.</Text>
          <Text style={styles.muted}>No invoices recorded yet.</Text>
          <Text style={styles.muted}>No documents uploaded yet.</Text>
        </Card>

        <Card title="Activity">
          {activity.length === 0 ? (
            <Text style={styles.muted}>No customer activity recorded yet.</Text>
          ) : null}
          {activity.map((entry) => (
            <Text
              key={`${entry.action}-${entry.createdAt}`}
              style={styles.meta}
            >
              {label(entry.action)} â€” {formatDate(entry.createdAt)}
            </Text>
          ))}
        </Card>

        {canArchive ? (
          <Pressable
            accessibilityLabel={
              customer.isArchived ? 'Restore customer' : 'Archive customer'
            }
            accessibilityRole="button"
            onPress={() =>
              customer.isArchived
                ? void archiveOrRestore()
                : setConfirmArchive(true)
            }
            style={[
              styles.dangerButton,
              customer.isArchived && styles.restoreButton,
            ]}
          >
            <Text style={styles.dangerText}>
              {customer.isArchived ? 'Restore customer' : 'Archive customer'}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <Modal transparent visible={confirmArchive} animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Archive {customer.displayName}?
            </Text>
            <Text style={styles.modalBody}>
              They will be hidden from the active customer list, but their
              history will remain available.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setConfirmArchive(false)}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void archiveOrRestore()}
                style={styles.dangerButton}
              >
                <Text style={styles.dangerText}>Archive</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <SiteModal
        form={siteForm}
        isBusy={isBusy}
        onClose={() => setSiteModal(false)}
        onSave={() => void saveSite()}
        setForm={setSiteForm}
        visible={siteModal}
      />

      <BusyOverlay visible={isBusy} />
    </View>
  );
}

function QuickAction({
  disabled,
  label: text,
  onPress,
}: {
  disabled?: boolean;
  label: string;
  onPress(): void;
}) {
  if (disabled) return null;
  return (
    <Pressable
      accessibilityLabel={text}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.quickAction}
    >
      <Text style={styles.quickText}>{text}</Text>
    </Pressable>
  );
}

function Card({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function SiteModal({
  form,
  isBusy,
  onClose,
  onSave,
  setForm,
  visible,
}: {
  form: CustomerSitePayload;
  isBusy: boolean;
  onClose(): void;
  onSave(): void;
  setForm(value: CustomerSitePayload): void;
  visible: boolean;
}) {
  function update(key: keyof CustomerSitePayload, value: string | boolean) {
    setForm({ ...form, [key]: value });
  }
  return (
    <Modal transparent visible={visible} animationType="slide">
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Add service location</Text>
          {(['label', 'addressLine1', 'suburb', 'postcode'] as const).map(
            (field) => (
              <TextInput
                key={field}
                accessibilityLabel={field}
                onChangeText={(value) => update(field, value)}
                placeholder={label(field)}
                placeholderTextColor={colours.muted}
                style={styles.input}
                value={String(form[field] ?? '')}
              />
            ),
          )}
          <View style={styles.stateRow}>
            {(
              ['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'] as const
            ).map((state) => (
              <Pressable
                key={state}
                onPress={() => update('state', state)}
                style={[
                  styles.stateChip,
                  form.state === state && styles.stateChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.stateText,
                    form.state === state && styles.stateTextActive,
                  ]}
                >
                  {state}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={() => update('isPrimary', !form.isPrimary)}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryText}>
              {form.isPrimary ? 'Primary location' : 'Mark as primary'}
            </Text>
          </Pressable>
          <View style={styles.modalActions}>
            <Pressable
              disabled={isBusy}
              onPress={onClose}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={isBusy}
              onPress={onSave}
              style={styles.quickAction}
            >
              <Text style={styles.quickText}>Save location</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function BusyOverlay({ visible }: { visible: boolean }) {
  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={styles.loadingOverlay}>
        <View style={styles.loadingCard}>
          <ActivityIndicator color={colours.primary} size="large" />
          <Text style={styles.loadingText}>Updating customer...</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  archived: { color: '#9F1239', fontWeight: '900', marginTop: 8 },
  card: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 16,
    padding: 16,
  },
  cardTitle: { color: colours.ink, fontSize: 18, fontWeight: '900' },
  container: { padding: 24, paddingBottom: 44 },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: '#9F1239',
    borderRadius: 999,
    marginTop: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  dangerText: { color: '#FFFFFF', fontWeight: '900' },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  flex: { backgroundColor: colours.background, flex: 1 },
  input: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colours.ink,
    fontSize: 16,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  linkButton: { marginTop: 8 },
  linkText: { color: '#9F1239', fontWeight: '900' },
  loadingCard: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderRadius: 24,
    gap: 14,
    maxWidth: 360,
    padding: 24,
    width: '100%',
  },
  loadingOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.32)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  loadingPage: {
    alignItems: 'center',
    backgroundColor: colours.background,
    flex: 1,
    justifyContent: 'center',
  },
  loadingText: { color: colours.ink, fontWeight: '900' },
  meta: { color: colours.muted, lineHeight: 21, marginTop: 8 },
  modalActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 18,
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  modalBody: { color: colours.muted, lineHeight: 21, marginTop: 8 },
  modalCard: {
    backgroundColor: colours.card,
    borderRadius: 22,
    maxWidth: 560,
    padding: 20,
    width: '100%',
  },
  modalTitle: { color: colours.ink, fontSize: 22, fontWeight: '900' },
  muted: { color: colours.muted, lineHeight: 21, marginTop: 8 },
  quickAction: {
    backgroundColor: colours.primary,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18 },
  quickText: { color: '#FFFFFF', fontWeight: '900' },
  restoreButton: { backgroundColor: colours.primary },
  secondaryButton: {
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryText: { color: colours.muted, fontWeight: '900' },
  siteCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    marginTop: 10,
    padding: 12,
  },
  siteTitle: { color: colours.ink, fontWeight: '900' },
  stateChip: {
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  stateChipActive: { backgroundColor: colours.primary },
  stateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  stateText: { color: colours.muted, fontWeight: '900' },
  stateTextActive: { color: '#FFFFFF' },
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
  title: { color: colours.ink, fontSize: 32, fontWeight: '900', marginTop: 4 },
});
