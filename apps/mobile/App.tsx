import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/auth/AuthContext';
import { ToastProvider } from './src/components/ToastProvider';
import { mobileConfig } from './src/config/mobileConfig';
import { RootNavigator } from './src/navigation/RootNavigator';
import { navigationTheme } from './src/theme';

let didLogMobileEnvironment = false;

export default function App() {
  if (!didLogMobileEnvironment && mobileConfig.environment !== 'production') {
    didLogMobileEnvironment = true;
    console.info('[MOBILE_ENV]', {
      apiBaseUrl: mobileConfig.apiBaseUrl,
      environment: mobileConfig.environment,
    });
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ToastProvider>
          <NavigationContainer theme={navigationTheme}>
            <RootNavigator />
            <StatusBar style="dark" />
          </NavigationContainer>
        </ToastProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
