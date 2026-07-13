import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colours } from '../theme';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

type Toast = {
  id: string;
  message: string;
  tone: ToastTone;
};

type ToastContextValue = {
  showToast(input: { message: string; tone?: ToastTone }): void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const insets = useSafeAreaInsets();

  const showToast = useCallback(
    (input: { message: string; tone?: ToastTone }) => {
      setToast((current) => {
        if (
          current?.message === input.message &&
          current.tone === (input.tone ?? 'info')
        ) {
          return current;
        }

        const next = {
          id: `${Date.now()}-${Math.random()}`,
          message: input.message,
          tone: input.tone ?? 'info',
        };
        AccessibilityInfo.announceForAccessibility(input.message);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timeout);
  }, [toast]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <View
          pointerEvents="box-none"
          style={[styles.host, { paddingTop: Math.max(insets.top, 12) + 8 }]}
        >
          <View style={[styles.toast, styles[`${toast.tone}Toast`]]}>
            <Text style={styles.message}>{toast.message}</Text>
            <Pressable
              accessibilityLabel="Close notification"
              accessibilityRole="button"
              onPress={() => setToast(null)}
              style={styles.closeButton}
            >
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}

const styles = StyleSheet.create({
  host: {
    left: 0,
    paddingHorizontal: 16,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 9999,
  },
  toast: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
  },
  successToast: { backgroundColor: '#ECFDF5', borderColor: '#BBF7D0' },
  errorToast: { backgroundColor: '#FFF1F2', borderColor: '#FECDD3' },
  warningToast: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  infoToast: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' },
  message: { color: colours.ink, flex: 1, fontWeight: '800', lineHeight: 20 },
  closeButton: {
    alignItems: 'center',
    borderRadius: 999,
    minHeight: 32,
    minWidth: 32,
    justifyContent: 'center',
  },
  closeText: { color: colours.muted, fontSize: 22, fontWeight: '800' },
});
