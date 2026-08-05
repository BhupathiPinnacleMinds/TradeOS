import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colours } from '../theme';

export function ScreenBackButton({
  accessibilityLabel,
  label,
  onPress,
}: {
  accessibilityLabel: string;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
    >
      <View style={styles.content}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.chevronFrame}
        >
          <View style={styles.chevron} />
        </View>
        <Text style={styles.label}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  buttonPressed: {
    backgroundColor: '#EEF2FF',
    opacity: 0.92,
  },
  chevron: {
    borderBottomColor: colours.ink,
    borderBottomWidth: 2.25,
    borderLeftColor: colours.ink,
    borderLeftWidth: 2.25,
    height: 9,
    transform: [{ rotate: '45deg' }],
    width: 9,
  },
  chevronFrame: {
    alignItems: 'center',
    height: 22,
    justifyContent: 'center',
    marginRight: 7,
    width: 22,
  },
  content: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  label: {
    color: colours.ink,
    fontSize: 17,
    fontWeight: '700',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});
