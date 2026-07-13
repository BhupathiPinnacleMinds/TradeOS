import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { colours } from '../theme';
import type {
  MainTabsParamList,
  RootStackParamList,
} from '../navigation/types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabsParamList, 'More'>,
  NativeStackScreenProps<RootStackParamList>
>;

const destinations: Array<{
  label: string;
  route: 'Quotes' | 'Invoices' | 'Notifications' | 'Team' | 'Settings';
}> = [
  { label: 'Quotes', route: 'Quotes' },
  { label: 'Invoices', route: 'Invoices' },
  { label: 'Notifications', route: 'Notifications' },
  { label: 'Team', route: 'Team' },
  { label: 'Settings', route: 'Settings' },
];

export function MoreScreen({ navigation }: Props) {
  const { logout, user } = useAuth();

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.businessCard}>
          <Text style={styles.businessName}>{user?.business.name}</Text>
          <Text style={styles.businessMeta}>
            {user?.email} · {user?.role}
          </Text>
        </View>

        {destinations.map(({ label, route }) => (
          <Pressable
            accessibilityRole="button"
            key={route}
            onPress={() => navigation.navigate(route)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}

        <Pressable
          accessibilityRole="button"
          onPress={() => void logout()}
          style={({ pressed }) => [
            styles.logoutButton,
            pressed && styles.rowPressed,
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
  container: { gap: 10, padding: 20 },
  businessCard: {
    backgroundColor: '#E8F3EC',
    borderColor: '#CFE5D7',
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
  },
  businessName: { color: colours.ink, fontSize: 20, fontWeight: '800' },
  businessMeta: { color: colours.muted, marginTop: 5 },
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
  logoutButton: {
    alignItems: 'center',
    backgroundColor: '#FFF1F2',
    borderColor: '#FECDD3',
    borderRadius: 15,
    borderWidth: 1,
    marginTop: 10,
    paddingVertical: 16,
  },
  logoutText: { color: '#9F1239', fontSize: 16, fontWeight: '800' },
});
