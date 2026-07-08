import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { colours } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const { login } = useAuth();
  const [email, setEmail] = useState('owner@demo-tradieos.com');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit() {
    setIsSubmitting(true);
    setError(null);

    try {
      await login({ email, password });
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Login failed',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <Text style={styles.kicker}>TRADIEOS</Text>
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>
          Log in to your business workspace and let Tori help with the office
          work.
        </Text>

        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            style={styles.input}
            value={email}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            autoCapitalize="none"
            onChangeText={setPassword}
            secureTextEntry
            style={styles.input}
            value={password}
          />

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
              <Text style={styles.primaryText}>Log in</Text>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('Register')}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryText}>
              Create a business workspace
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colours.background },
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  kicker: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  title: { color: colours.ink, fontSize: 34, fontWeight: '900', marginTop: 10 },
  subtitle: {
    color: colours.muted,
    fontSize: 16,
    lineHeight: 23,
    marginTop: 8,
  },
  form: { marginTop: 30 },
  label: { color: colours.ink, fontSize: 14, fontWeight: '700', marginTop: 14 },
  input: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colours.ink,
    fontSize: 16,
    marginTop: 7,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  error: { color: '#B00020', lineHeight: 20, marginTop: 14 },
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
