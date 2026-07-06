import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colours } from '../theme';

export function DashboardScreen() {
  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.greeting}>Good morning</Text>
        <Text style={styles.title}>Today at a glance</Text>
        <View style={styles.grid}>
          <View style={styles.card}>
            <Text style={styles.value}>0</Text>
            <Text style={styles.label}>Jobs today</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.value}>$0</Text>
            <Text style={styles.label}>Outstanding</Text>
          </View>
        </View>
        <View style={styles.toriCard}>
          <Text style={styles.toriLabel}>TORI'S DAILY PRIORITIES</Text>
          <Text style={styles.toriTitle}>Your day is clear.</Text>
          <Text style={styles.toriBody}>
            Tori will surface jobs, follow-ups and admin drafts here.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colours.background },
  container: { flex: 1, padding: 24 },
  greeting: { color: colours.muted, fontSize: 16, marginTop: 20 },
  title: {
    color: colours.ink,
    fontSize: 32,
    fontWeight: '800',
    marginTop: 4,
  },
  grid: { flexDirection: 'row', gap: 12, marginTop: 28 },
  card: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    padding: 18,
  },
  value: { color: colours.ink, fontSize: 28, fontWeight: '800' },
  label: { color: colours.muted, marginTop: 6 },
  toriCard: {
    backgroundColor: '#EFEDFF',
    borderRadius: 20,
    marginTop: 16,
    padding: 20,
  },
  toriLabel: {
    color: colours.tori,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  toriTitle: {
    color: colours.ink,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 10,
  },
  toriBody: { color: colours.muted, lineHeight: 21, marginTop: 6 },
});
