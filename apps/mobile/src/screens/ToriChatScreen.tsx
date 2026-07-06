import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colours } from '../theme';

export function ToriChatScreen() {
  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>T</Text>
        </View>
        <Text style={styles.title}>Hi, I'm Tori.</Text>
        <Text style={styles.body}>
          Ask me to draft a quote, prepare a customer reply, plan your day, or
          find an unpaid invoice.
        </Text>
        <View style={styles.safety}>
          <Text style={styles.safetyTitle}>You're always in control</Text>
          <Text style={styles.safetyBody}>
            I will never send a message, quote or invoice without your
            confirmation.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colours.background },
  container: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 28,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colours.tori,
    borderRadius: 32,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  avatarText: { color: '#FFFFFF', fontSize: 28, fontWeight: '800' },
  title: {
    color: colours.ink,
    fontSize: 30,
    fontWeight: '800',
    marginTop: 20,
  },
  body: {
    color: colours.muted,
    fontSize: 17,
    lineHeight: 25,
    marginTop: 10,
    textAlign: 'center',
  },
  safety: {
    backgroundColor: '#FFF5E8',
    borderRadius: 16,
    marginTop: 28,
    padding: 18,
    width: '100%',
  },
  safetyTitle: { color: colours.warning, fontSize: 15, fontWeight: '700' },
  safetyBody: { color: colours.muted, lineHeight: 20, marginTop: 6 },
});
