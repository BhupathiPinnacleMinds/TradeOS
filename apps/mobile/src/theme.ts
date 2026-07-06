import type { Theme } from '@react-navigation/native';

export const colours = {
  background: '#F4F7F4',
  border: '#DDE5DD',
  card: '#FFFFFF',
  ink: '#17201A',
  muted: '#68746B',
  primary: '#176B45',
  tori: '#5B4BC4',
  warning: '#9A5A12',
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
