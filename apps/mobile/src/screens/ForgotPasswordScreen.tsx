import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { forgotPasswordRequest } from '../api/client';
import { keyboardAvoidingBehavior } from '../components/keyboardAvoidance';
import type { RootStackParamList } from '../navigation/types';
import { colours } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ForgotPassword'>;

export function ForgotPasswordScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit() {
    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const response = await forgotPasswordRequest({ email });
      setMessage(response.message);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Password reset request failed',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={keyboardAvoidingBehavior}
        style={styles.container}
      >
        <Text style={styles.kicker}>ACCOUNT RECOVERY</Text>
        <Text style={styles.title}>Reset your password</Text>
        <Text style={styles.subtitle}>
          Enter your email and we’ll send reset instructions if an account
          exists.
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

          {message ? <Text style={styles.success}>{message}</Text> : null}
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
              <Text style={styles.primaryText}>Send reset instructions</Text>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('Login')}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryText}>Back to login</Text>
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
  title: { color: colours.ink, fontSize: 32, fontWeight: '900', marginTop: 10 },
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
  success: { color: '#166534', lineHeight: 20, marginTop: 14 },
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
