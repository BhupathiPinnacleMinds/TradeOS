import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { CustomersScreen } from '../screens/CustomersScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { InvoicesScreen } from '../screens/InvoicesScreen';
import { JobsScreen } from '../screens/JobsScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { MoreScreen } from '../screens/MoreScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { QuotesScreen } from '../screens/QuotesScreen';
import { RegisterScreen } from '../screens/RegisterScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ToriChatScreen } from '../screens/ToriChatScreen';
import { colours } from '../theme';
import type { MainTabsParamList, RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabsParamList>();

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colours.background },
        tabBarActiveTintColor: colours.primary,
        tabBarInactiveTintColor: colours.muted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="Dashboard" component={DashboardScreen} />
      <Tabs.Screen name="Tori" component={ToriChatScreen} />
      <Tabs.Screen name="Customers" component={CustomersScreen} />
      <Tabs.Screen name="Jobs" component={JobsScreen} />
      <Tabs.Screen name="More" component={MoreScreen} />
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  const { isLoading, token } = useAuth();

  if (isLoading) {
    return (
      <View
        style={{
          alignItems: 'center',
          backgroundColor: colours.background,
          flex: 1,
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={colours.primary} />
        <Text style={{ color: colours.muted, marginTop: 12 }}>
          Loading TradieOS...
        </Text>
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colours.background },
      }}
    >
      {token ? (
        <>
          <Stack.Screen
            name="Main"
            component={MainTabs}
            options={{ headerShown: false }}
          />
          <Stack.Screen name="Quotes" component={QuotesScreen} />
          <Stack.Screen name="Invoices" component={InvoicesScreen} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
        </>
      ) : (
        <>
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Register"
            component={RegisterScreen}
            options={{ title: 'Create business workspace' }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}
