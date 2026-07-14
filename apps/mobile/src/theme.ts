import type { Theme } from '@react-navigation/native';

export const colours = {
  background: '#F8FAFC',
  border: '#E2E8F0',
  card: '#FFFFFF',
  ink: '#0F172A',
  muted: '#64748B',
  primary: '#4F46E5',
  tori: '#7C3AED',
  warning: '#D97706',
} as const;

export const navigationTheme: Theme = {
  dark: false,
  colors: {
    primary: colours.primary,
    background: colours.background,
    card: colours.card,
    text: colours.ink,
    border: colours.border,
    notification: colours.tori,
  },
  fonts: {
    regular: { fontFamily: 'System', fontWeight: '400' },
    medium: { fontFamily: 'System', fontWeight: '500' },
    bold: { fontFamily: 'System', fontWeight: '700' },
    heavy: { fontFamily: 'System', fontWeight: '800' },
  },
};
