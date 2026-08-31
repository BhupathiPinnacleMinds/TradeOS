import type { InvitationPreviewResponse } from '@tradieos/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { invitationPreviewRequest } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { keyboardAvoidingBehavior } from '../components/keyboardAvoidance';
import { colours } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'AcceptInvitation'>;

function roleLabel(role?: string) {
  return role ? role.replaceAll('_', ' ') : 'Team member';
}

function stateMessage(state: InvitationPreviewResponse['state']) {
  switch (state) {
    case 'EXPIRED':
      return 'This invitation has expired. Ask the business owner to resend it.';
    case 'ACCEPTED':
      return 'This invitation has already been accepted. Log in with your account instead.';
    case 'CANCELLED':
      return 'This invitation has been cancelled by the business owner.';
    case 'INVALID':
      return 'This invitation link is invalid. Check the link or ask for a new invite.';
    default:
      return null;
  }
}

export function AcceptInvitationScreen({ route }: Props) {
  const inviteToken = route.params.token;
  const { acceptInvitation } = useAuth();
  const [preview, setPreview] = useState<InvitationPreviewResponse | null>(
    null,
  );
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    async function loadInvitation() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await invitationPreviewRequest(inviteToken);
        setPreview(response);
        setEmail(response.invitedEmail ?? '');
      } catch (loadError) {
        setPreview({ state: 'INVALID' });
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load invitation',
        );
      } finally {
        setIsLoading(false);
      }
    }

    void loadInvitation();
  }, [inviteToken]);

  async function submit() {
    setIsSubmitting(true);
    setError(null);

    try {
      await acceptInvitation(inviteToken, {
        email,
        firstName,
        lastName,
        password,
        confirmPassword,
      });
      setIsSuccess(true);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Unable to accept invitation',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const blockingMessage = preview ? stateMessage(preview.state) : null;
  const canAccept = preview?.state === 'VALID';

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={keyboardAvoidingBehavior}
        style={styles.keyboard}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardDismissMode={
            Platform.OS === 'ios' ? 'interactive' : 'on-drag'
          }
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.kicker}>TRADIEOS INVITE</Text>
          <Text style={styles.title}>Join your team workspace</Text>
          <Text style={styles.subtitle}>
            Set up your login to join the existing business. You won’t need ABN,
            GST, or workspace details.
          </Text>

          {isLoading ? (
            <View style={styles.stateCard}>
              <ActivityIndicator color={colours.primary} />
              <Text style={styles.stateText}>Checking invitation...</Text>
            </View>
          ) : null}

          {!isLoading && preview ? (
            <View style={styles.inviteCard}>
              <Text style={styles.cardLabel}>Business</Text>
              <Text style={styles.businessName}>
                {preview.businessName ?? 'TradieOS workspace'}
              </Text>
              <Text style={styles.meta}>Email: {preview.invitedEmail}</Text>
              <Text style={styles.meta}>Role: {roleLabel(preview.role)}</Text>
            </View>
          ) : null}

          {blockingMessage ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>
                {roleLabel(preview?.state)} invitation
              </Text>
              <Text style={styles.errorBody}>{blockingMessage}</Text>
            </View>
          ) : null}

          {isSuccess ? (
            <View style={styles.successCard}>
              <Text style={styles.successTitle}>Invitation accepted</Text>
              <Text style={styles.successBody}>
                You’re signed in and ready to use your team workspace.
              </Text>
            </View>
          ) : null}

          {canAccept && !isSuccess ? (
            <View style={styles.form}>
              <Text style={styles.label}>Invited email</Text>
              <TextInput
                autoCapitalize="none"
                keyboardType="email-address"
                onChangeText={setEmail}
                style={styles.input}
                value={email}
              />

              <Text style={styles.label}>First name</Text>
              <TextInput
                onChangeText={setFirstName}
                style={styles.input}
                value={firstName}
              />

              <Text style={styles.label}>Last name</Text>
              <TextInput
                onChangeText={setLastName}
                style={styles.input}
                value={lastName}
              />

              <Text style={styles.label}>Password</Text>
              <TextInput
                onChangeText={setPassword}
                secureTextEntry
                style={styles.input}
                value={password}
              />

              <Text style={styles.label}>Confirm password</Text>
              <TextInput
                onChangeText={setConfirmPassword}
                secureTextEntry
                style={styles.input}
                value={confirmPassword}
              />

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={() => void submit()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  (pressed || isSubmitting) && styles.buttonPressed,
                ]}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryText}>Accept invitation</Text>
                )}
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colours.background },
  keyboard: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
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
  stateCard: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    marginTop: 24,
    padding: 18,
  },
  stateText: { color: colours.muted },
  inviteCard: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 24,
    padding: 18,
  },
  cardLabel: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  businessName: {
    color: colours.ink,
    fontSize: 22,
    fontWeight: '900',
    marginTop: 6,
  },
  meta: { color: colours.muted, marginTop: 6 },
  form: { marginTop: 18 },
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
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colours.primary,
    borderRadius: 16,
    marginTop: 20,
    paddingVertical: 15,
  },
  buttonPressed: { opacity: 0.7 },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  errorText: { color: '#B00020', lineHeight: 20, marginTop: 14 },
  errorCard: {
    backgroundColor: '#FFF1F2',
    borderColor: '#FECDD3',
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 18,
    padding: 18,
  },
  errorTitle: { color: '#9F1239', fontSize: 18, fontWeight: '900' },
  errorBody: { color: '#9F1239', lineHeight: 21, marginTop: 8 },
  successCard: {
    backgroundColor: '#DCFCE7',
    borderColor: '#BBF7D0',
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 18,
    padding: 18,
  },
  successTitle: { color: '#166534', fontSize: 18, fontWeight: '900' },
  successBody: { color: '#166534', lineHeight: 21, marginTop: 8 },
});
