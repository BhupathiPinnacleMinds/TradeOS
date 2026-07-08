import type { AuthUser } from '@tradieos/shared';
import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform } from 'react-native';
import { loginRequest, meRequest, registerRequest } from '../api/client';

const TOKEN_KEY = 'tradieos.jwt';

type RegisterInput = Parameters<typeof registerRequest>[0];

interface AuthContextValue {
  isLoading: boolean;
  token: string | null;
  user: AuthUser | null;
  login(input: { email: string; password: string }): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function getStoredToken() {
  if (Platform.OS === 'web') {
    return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
  }

  return SecureStore.getItemAsync(TOKEN_KEY);
}

async function setStoredToken(token: string) {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(TOKEN_KEY, token);
    return;
  }

  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

async function deleteStoredToken() {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(TOKEN_KEY);
    return;
  }

  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [isLoading, setIsLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    async function restoreSession() {
      try {
        const storedToken = await getStoredToken();

        if (storedToken) {
          const response = await meRequest(storedToken);
          setToken(storedToken);
          setUser(response.user);
        }
      } catch {
        await deleteStoredToken();
      } finally {
        setIsLoading(false);
      }
    }

    void restoreSession();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoading,
      token,
      user,
      async login(input) {
        const response = await loginRequest(input);
        await setStoredToken(response.accessToken);
        setToken(response.accessToken);
        setUser(response.user);
      },
      async register(input) {
        const response = await registerRequest(input);
        await setStoredToken(response.accessToken);
        setToken(response.accessToken);
        setUser(response.user);
      },
      async logout() {
        await deleteStoredToken();
        setToken(null);
        setUser(null);
      },
    }),
    [isLoading, token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}
