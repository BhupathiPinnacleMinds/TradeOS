import type { KeyboardAvoidingViewProps } from 'react-native';
import { Platform } from 'react-native';

export const keyboardAvoidingBehavior: KeyboardAvoidingViewProps['behavior'] =
  Platform.select({
    android: 'height',
    ios: 'padding',
  });
