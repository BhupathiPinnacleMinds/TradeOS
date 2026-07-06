import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colours } from '../theme';

interface ScreenPlaceholderProps {
  title: string;
  description: string;
  eyebrow?: string;
}

export function ScreenPlaceholder({
  title,
  description,
  eyebrow = 'FOUNDATION READY',
}: ScreenPlaceholderProps) {
  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Coming next</Text>
          <Text style={styles.cardText}>
            This workspace is ready for its first product workflow.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colours.background,
  },
  container: {
    flex: 1,
    padding: 24,
  },
  eyebrow: {
    color: colours.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: 24,
  },
  title: {
    color: colours.ink,
    fontSize: 32,
    fontWeight: '800',
    marginTop: 8,
  },
  description: {
    color: colours.muted,
    fontSize: 17,
    lineHeight: 25,
    marginTop: 12,
  },
  card: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 32,
    padding: 20,
  },
  cardTitle: {
    color: colours.ink,
    fontSize: 16,
    fontWeight: '700',
  },
  cardText: {
    color: colours.muted,
    lineHeight: 21,
    marginTop: 6,
  },
});
