import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { AccountsReceivableScreen } from '../screens/AccountsReceivableScreen';
import { AcceptInvitationScreen } from '../screens/AcceptInvitationScreen';
import { AppointmentDetailsScreen } from '../screens/AppointmentDetailsScreen';
import { AppointmentFormScreen } from '../screens/AppointmentFormScreen';
import { AppointmentReassignScreen } from '../screens/AppointmentReassignScreen';
import { CalendarScreen } from '../screens/CalendarScreen';
import { CustomerDetailsScreen } from '../screens/CustomerDetailsScreen';
import { CustomerFormScreen } from '../screens/CustomerFormScreen';
import { CustomersScreen } from '../screens/CustomersScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { InvoicesScreen } from '../screens/InvoicesScreen';
import { InvoiceDetailsScreen } from '../screens/InvoiceDetailsScreen';
import { InvoiceFormScreen } from '../screens/InvoiceFormScreen';
import { ForgotPasswordScreen } from '../screens/ForgotPasswordScreen';
import { JobDetailsScreen } from '../screens/JobDetailsScreen';
import { JobFormScreen } from '../screens/JobFormScreen';
import { JobsScreen } from '../screens/JobsScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { MediaEvidenceScreen } from '../screens/MediaEvidenceScreen';
import { MediaViewerScreen } from '../screens/MediaViewerScreen';
import { MoreScreen } from '../screens/MoreScreen';
import { MyDayScreen } from '../screens/MyDayScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { QuoteDetailsScreen } from '../screens/QuoteDetailsScreen';
import { QuoteFormScreen } from '../screens/QuoteFormScreen';
import { QuotesScreen } from '../screens/QuotesScreen';
import { PublicQuoteScreen } from '../screens/PublicQuoteScreen';
import { PublicInvoiceScreen } from '../screens/PublicInvoiceScreen';
import { RegisterScreen } from '../screens/RegisterScreen';
import { ResetPasswordScreen } from '../screens/ResetPasswordScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { TeamScreen } from '../screens/TeamScreen';
import { TeamMemberProfileScreen } from '../screens/TeamMemberProfileScreen';
import { ToriChatScreen } from '../screens/ToriChatScreen';
import { colours } from '../theme';
import {
  canAccessStackRoute,
  getBottomTabsForRole,
  getDefaultTabForRole,
} from '../permissions/roleVisibility';
import type { MainTabsParamList, RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabsParamList>();
type IoniconName = ComponentProps<typeof Ionicons>['name'];

const tabIcons: Partial<
  Record<
    keyof MainTabsParamList,
    {
      focused: IoniconName;
      unfocused: IoniconName;
    }
  >
> = {
  Calendar: {
    focused: 'calendar',
    unfocused: 'calendar-outline',
  },
  Dashboard: {
    focused: 'home',
    unfocused: 'home-outline',
  },
  Jobs: {
    focused: 'briefcase',
    unfocused: 'briefcase-outline',
  },
  More: {
    focused: 'menu',
    unfocused: 'menu-outline',
  },
  MyDay: {
    focused: 'today',
    unfocused: 'today-outline',
  },
  Tori: {
    focused: 'chatbubble-ellipses',
    unfocused: 'chatbubble-ellipses-outline',
  },
};

function getInviteTokenFromLocation() {
  const pathname =
    typeof globalThis.location === 'undefined'
      ? ''
      : globalThis.location.pathname;
  const match = pathname.match(/^\/invite\/([^/]+)$/);

  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function getPublicQuoteTokenFromLocation() {
  const pathname =
    typeof globalThis.location === 'undefined'
      ? ''
      : globalThis.location.pathname;
  const match = pathname.match(/^\/quote\/([^/]+)$/);

  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function getPublicInvoiceTokenFromLocation() {
  const pathname =
    typeof globalThis.location === 'undefined'
      ? ''
      : globalThis.location.pathname;
  const match = pathname.match(/^\/invoice\/([^/]+)$/);

  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function getResetPasswordTokenFromLocation() {
  if (typeof globalThis.location === 'undefined') {
    return null;
  }

  const pathname = globalThis.location.pathname;
  const tokenFromQuery = new URLSearchParams(globalThis.location.search).get(
    'token',
  );
  if (pathname === '/reset-password' && tokenFromQuery) {
    return tokenFromQuery;
  }

  const match = pathname.match(/^\/reset-password\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function MainTabs() {
  const { user } = useAuth();
  const tabs = getBottomTabsForRole(user?.role);

  return (
    <Tabs.Navigator
      initialRouteName={getDefaultTabForRole(user?.role)}
      screenOptions={({ route }) => ({
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colours.background },
        tabBarIcon: ({ color, focused, size }) => {
          const icon = tabIcons[route.name];
          if (!icon) return null;

          return (
            <Ionicons
              color={color}
              name={focused ? icon.focused : icon.unfocused}
              size={Math.min(Math.max(size, 22), 24)}
            />
          );
        },
        tabBarActiveTintColor: colours.primary,
        tabBarInactiveTintColor: colours.muted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      })}
    >
      {tabs.includes('Dashboard') ? (
        <Tabs.Screen name="Dashboard" component={DashboardScreen} />
      ) : null}
      {tabs.includes('MyDay') ? (
        <Tabs.Screen
          name="MyDay"
          component={MyDayScreen}
          options={{ title: 'My Day' }}
        />
      ) : null}
      {tabs.includes('Calendar') ? (
        <Tabs.Screen name="Calendar" component={CalendarScreen} />
      ) : null}
      {tabs.includes('Customers') ? (
        <Tabs.Screen name="Customers" component={CustomersScreen} />
      ) : null}
      {tabs.includes('Jobs') ? (
        <Tabs.Screen name="Jobs" component={JobsScreen} />
      ) : null}
      {tabs.includes('Quotes') ? (
        <Tabs.Screen name="Quotes" component={QuotesScreen} />
      ) : null}
      {tabs.includes('Tori') ? (
        <Tabs.Screen name="Tori" component={ToriChatScreen} />
      ) : null}
      {tabs.includes('More') ? (
        <Tabs.Screen name="More" component={MoreScreen} />
      ) : null}
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  const { isLoading, token, user } = useAuth();
  const inviteToken = getInviteTokenFromLocation();
  const publicQuoteToken = getPublicQuoteTokenFromLocation();
  const publicInvoiceToken = getPublicInvoiceTokenFromLocation();
  const resetPasswordToken = getResetPasswordTokenFromLocation();

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
      initialRouteName={
        !token && publicQuoteToken
          ? 'PublicQuote'
          : !token && publicInvoiceToken
            ? 'PublicInvoice'
            : !token && resetPasswordToken
              ? 'ResetPassword'
              : !token && inviteToken
                ? 'AcceptInvitation'
                : undefined
      }
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
          {canAccessStackRoute(user?.role, 'Quotes') ? (
            <Stack.Screen name="Quotes" component={QuotesScreen} />
          ) : null}
          {canAccessStackRoute(user?.role, 'Quotes') ? (
            <Stack.Screen
              name="QuoteDetails"
              component={QuoteDetailsScreen}
              options={{ title: 'Quote' }}
            />
          ) : null}
          {canAccessStackRoute(user?.role, 'QuoteForm') ? (
            <Stack.Screen
              name="QuoteForm"
              component={QuoteFormScreen}
              options={{ title: 'New quote' }}
            />
          ) : null}
          {canAccessStackRoute(user?.role, 'Invoices') ? (
            <Stack.Screen name="Invoices" component={InvoicesScreen} />
          ) : null}
          {canAccessStackRoute(user?.role, 'AccountsReceivable') ? (
            <Stack.Screen
              name="AccountsReceivable"
              component={AccountsReceivableScreen}
              options={{ title: 'Accounts Receivable' }}
            />
          ) : null}
          {canAccessStackRoute(user?.role, 'InvoiceDetails') ? (
            <Stack.Screen
              name="InvoiceDetails"
              component={InvoiceDetailsScreen}
              options={{ title: 'Invoice' }}
            />
          ) : null}
          {canAccessStackRoute(user?.role, 'InvoiceForm') ? (
            <Stack.Screen
              name="InvoiceForm"
              component={InvoiceFormScreen}
              options={{ title: 'New invoice' }}
            />
          ) : null}
          {canAccessStackRoute(user?.role, 'Notifications') ? (
            <Stack.Screen
              name="Notifications"
              component={NotificationsScreen}
            />
          ) : null}
          {canAccessStackRoute(user?.role, 'Settings') ? (
            <Stack.Screen name="Settings" component={SettingsScreen} />
          ) : null}
          {canAccessStackRoute(user?.role, 'MyDay') ? (
            <Stack.Screen
              name="MyDay"
              component={MyDayScreen}
              options={{ title: 'My Day' }}
            />
          ) : null}
          {canAccessStackRoute(user?.role, 'AppointmentDetails') ? (
            <Stack.Screen
              name="AppointmentDetails"
              component={AppointmentDetailsScreen}
              options={{ title: 'Appointment' }}
            />
          ) : null}
          {canAccessStackRoute(user?.role, 'AppointmentForm') ? (
            <Stack.Screen
              name="AppointmentForm"
              component={AppointmentFormScreen}
              options={{ title: 'New appointment' }}
            />
          ) : null}
          {canAccessStackRoute(user?.role, 'AppointmentReassign') ? (
            <Stack.Screen
              name="AppointmentReassign"
              component={AppointmentReassignScreen}
              options={{ title: 'Reassign appointment' }}
            />
          ) : null}
          {canAccessStackRoute(user?.role, 'MediaEvidence') ? (
            <Stack.Screen
              name="MediaEvidence"
              component={MediaEvidenceScreen}
              options={{ title: 'Add evidence' }}
            />
          ) : null}
          {canAccessStackRoute(user?.role, 'MediaViewer') ? (
            <Stack.Screen
              name="MediaViewer"
              component={MediaViewerScreen}
              options={{ title: 'File preview' }}
            />
          ) : null}
          {canAccessStackRoute(user?.role, 'CustomerDetails') ? (
            <Stack.Screen
              name="CustomerDetails"
              component={CustomerDetailsScreen}
            />
          ) : null}
          {canAccessStackRoute(user?.role, 'Customers') ? (
            <Stack.Screen name="Customers" component={CustomersScreen} />
          ) : null}
          {canAccessStackRoute(user?.role, 'CustomerForm') ? (
            <Stack.Screen name="CustomerForm" component={CustomerFormScreen} />
          ) : null}
          {canAccessStackRoute(user?.role, 'JobDetails') ? (
            <Stack.Screen name="JobDetails" component={JobDetailsScreen} />
          ) : null}
          {canAccessStackRoute(user?.role, 'Jobs') ? (
            <Stack.Screen name="Jobs" component={JobsScreen} />
          ) : null}
          {canAccessStackRoute(user?.role, 'JobForm') ? (
            <Stack.Screen name="JobForm" component={JobFormScreen} />
          ) : null}
          {canAccessStackRoute(user?.role, 'Team') ? (
            <Stack.Screen name="Team" component={TeamScreen} />
          ) : null}
          {canAccessStackRoute(user?.role, 'TeamMemberProfile') ? (
            <Stack.Screen
              name="TeamMemberProfile"
              component={TeamMemberProfileScreen}
              options={{ title: 'Team profile' }}
            />
          ) : null}
        </>
      ) : (
        <>
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="ForgotPassword"
            component={ForgotPasswordScreen}
            options={{ title: 'Forgot password' }}
          />
          <Stack.Screen
            name="ResetPassword"
            component={ResetPasswordScreen}
            initialParams={
              resetPasswordToken ? { token: resetPasswordToken } : undefined
            }
            options={{ title: 'Reset password' }}
          />
          {inviteToken ? (
            <Stack.Screen
              name="AcceptInvitation"
              component={AcceptInvitationScreen}
              initialParams={{ token: inviteToken }}
              options={{ title: 'Accept invitation' }}
            />
          ) : null}
          {publicQuoteToken ? (
            <Stack.Screen
              name="PublicQuote"
              component={PublicQuoteScreen}
              initialParams={{ token: publicQuoteToken }}
              options={{ title: 'Quote' }}
            />
          ) : null}
          {publicInvoiceToken ? (
            <Stack.Screen
              name="PublicInvoice"
              component={PublicInvoiceScreen}
              initialParams={{ token: publicInvoiceToken }}
              options={{ title: 'Invoice' }}
            />
          ) : null}
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
