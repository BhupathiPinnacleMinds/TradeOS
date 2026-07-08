import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { colours } from '../theme';

export function SettingsScreen() {
  const { logout, user } = useAuth();

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>
          Manage your business workspace, members, defaults and integrations.
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>Business workspace</Text>
          <Text style={styles.value}>{user?.business.name}</Text>
          <Text style={styles.meta}>
            {user?.business.tradeType ?? 'Trade not set'} · ABN{' '}
            {user?.business.abn ?? 'not set'}
          </Text>
          <Text style={styles.meta}>
            GST {user?.business.gstRegistered ? 'registered' : 'not registered'}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Signed in as</Text>
          <Text style={styles.value}>
            {user?.firstName} {user?.lastName}
          </Text>
          <Text style={styles.meta}>{user?.email}</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => void logout()}
          style={({ pressed }) => [
            styles.logoutButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colours.background },
  container: { padding: 24 },
  title: { color: colours.ink, fontSize: 30, fontWeight: '900' },
  subtitle: { color: colours.muted, lineHeight: 22, marginTop: 8 },
  card: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 18,
    padding: 18,
  },
  label: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  value: { color: colours.ink, fontSize: 20, fontWeight: '800', marginTop: 8 },
  meta: { color: colours.muted, marginTop: 5 },
  logoutButton: {
    alignItems: 'center',
    backgroundColor: '#9F1239',
    borderRadius: 16,
    marginTop: 24,
    paddingVertical: 15,
  },
  buttonPressed: { opacity: 0.75 },
  logoutText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
