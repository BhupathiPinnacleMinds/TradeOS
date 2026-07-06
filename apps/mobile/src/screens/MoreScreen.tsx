import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colours } from '../theme';
import type { MainTabsParamList, RootStackParamList } from '../navigation/types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabsParamList, 'More'>,
  NativeStackScreenProps<RootStackParamList>
>;

const destinations: Array<{
  label: string;
  route: Exclude<keyof RootStackParamList, 'Main'>;
}> = [
  { label: 'Quotes', route: 'Quotes' },
  { label: 'Invoices', route: 'Invoices' },
  { label: 'Notifications', route: 'Notifications' },
  { label: 'Settings', route: 'Settings' },
];

export function MoreScreen({ navigation }: Props) {
  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <View style={styles.container}>
        {destinations.map(({ label, route }) => (
          <Pressable
            accessibilityRole="button"
            key={route}
            onPress={() => navigation.navigate(route)}
            style={({ pressed }) => [
              styles.row,
              pressed && styles.rowPressed,
            ]}
          >
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colours.background },
  container: { gap: 10, padding: 20 },
  row: {
    alignItems: 'center',
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 17,
  },
  rowPressed: { opacity: 0.65 },
  label: { color: colours.ink, fontSize: 17, fontWeight: '600' },
  chevron: { color: colours.muted, fontSize: 25 },
});
