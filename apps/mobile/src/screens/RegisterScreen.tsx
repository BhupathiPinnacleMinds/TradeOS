import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AUSTRALIAN_TIMEZONES,
  timezoneForAustralianState,
} from '@tradieos/shared';
import { useAuth } from '../auth/AuthContext';
import { colours } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Register'>;

export function RegisterScreen({ navigation }: Props) {
  const { register } = useAuth();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    businessName: '',
    abn: '',
    tradeType: '',
    gstRegistered: true,
    phone: '',
    businessEmail: '',
    address: '',
    suburb: '',
    state: 'NSW',
    postcode: '',
    timezone: timezoneForAustralianState('NSW'),
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function update<K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(key === 'state'
        ? { timezone: timezoneForAustralianState(String(value)) }
        : {}),
    }));
  }

  async function submit() {
    setIsSubmitting(true);
    setError(null);

    try {
      await register(form);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Registration failed',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>Create your TradieOS workspace</Text>
          <Text style={styles.subtitle}>
            This creates an owner account and a business workspace. All jobs,
            customers, invoices and Tori chats stay scoped to this business.
          </Text>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Owner</Text>
            <Field
              label="First name"
              onChangeText={(value) => update('firstName', value)}
              value={form.firstName}
            />
            <Field
              label="Last name"
              onChangeText={(value) => update('lastName', value)}
              value={form.lastName}
            />
            <Field
              autoCapitalize="none"
              keyboardType="email-address"
              label="Login email"
              onChangeText={(value) => update('email', value)}
              value={form.email}
            />
            <Field
              autoCapitalize="none"
              label="Password"
              onChangeText={(value) => update('password', value)}
              secureTextEntry
              value={form.password}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Business</Text>
            <Field
              label="Business name"
              onChangeText={(value) => update('businessName', value)}
              value={form.businessName}
            />
            <Field
              label="ABN"
              onChangeText={(value) => update('abn', value)}
              value={form.abn}
            />
            <Field
              label="Trade type"
              onChangeText={(value) => update('tradeType', value)}
              placeholder="Electrician, plumber, cleaner..."
              value={form.tradeType}
            />
            <View style={styles.switchRow}>
              <Text style={styles.label}>GST registered</Text>
              <Switch
                onValueChange={(value) => update('gstRegistered', value)}
                value={form.gstRegistered}
              />
            </View>
            <Field
              keyboardType="phone-pad"
              label="Phone"
              onChangeText={(value) => update('phone', value)}
              value={form.phone}
            />
            <Field
              autoCapitalize="none"
              keyboardType="email-address"
              label="Business email"
              onChangeText={(value) => update('businessEmail', value)}
              value={form.businessEmail}
            />
            <Field
              label="Address"
              onChangeText={(value) => update('address', value)}
              value={form.address}
            />
            <Field
              label="Suburb"
              onChangeText={(value) => update('suburb', value)}
              value={form.suburb}
            />
            <View style={styles.row}>
              <View style={styles.rowItem}>
                <Field
                  label="State"
                  onChangeText={(value) => update('state', value)}
                  value={form.state}
                />
              </View>
              <View style={styles.rowItem}>
                <Field
                  keyboardType="number-pad"
                  label="Postcode"
                  onChangeText={(value) => update('postcode', value)}
                  value={form.postcode}
                />
              </View>
            </View>
            <Text style={styles.label}>Business timezone</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {AUSTRALIAN_TIMEZONES.map((timezone) => (
                  <Pressable
                    accessibilityRole="button"
                    key={timezone}
                    onPress={() => update('timezone', timezone)}
                    style={[
                      styles.chip,
                      form.timezone === timezone && styles.chipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        form.timezone === timezone && styles.chipTextActive,
                      ]}
                    >
                      {timezone}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting}
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.buttonPressed,
              isSubmitting && styles.buttonDisabled,
            ]}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryText}>Create workspace</Text>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('Login')}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryText}>I already have an account</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  ...props
}: {
  label: string;
} & ComponentProps<typeof TextInput>) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor="#94A3B8"
        style={styles.input}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colours.background },
  keyboard: { flex: 1 },
  container: { padding: 24, paddingBottom: 40 },
  title: { color: colours.ink, fontSize: 28, fontWeight: '900' },
  subtitle: { color: colours.muted, lineHeight: 22, marginTop: 8 },
  section: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 20,
    padding: 18,
  },
  sectionTitle: { color: colours.ink, fontSize: 18, fontWeight: '800' },
  label: { color: colours.ink, fontSize: 14, fontWeight: '700', marginTop: 14 },
  input: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colours.ink,
    fontSize: 16,
    marginTop: 7,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  chip: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  chipActive: {
    backgroundColor: colours.primary,
    borderColor: colours.primary,
  },
  chipRow: { flexDirection: 'row', gap: 8, paddingVertical: 8 },
  chipText: { color: colours.muted, fontWeight: '800' },
  chipTextActive: { color: '#FFFFFF' },
  row: { flexDirection: 'row', gap: 12 },
  rowItem: { flex: 1 },
  switchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  error: { color: '#B00020', lineHeight: 20, marginTop: 16 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colours.primary,
    borderRadius: 16,
    marginTop: 20,
    paddingVertical: 15,
  },
  buttonPressed: { opacity: 0.75 },
  buttonDisabled: { opacity: 0.6 },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  secondaryButton: { alignItems: 'center', marginTop: 16, paddingVertical: 8 },
  secondaryText: { color: colours.primary, fontSize: 15, fontWeight: '700' },
});
