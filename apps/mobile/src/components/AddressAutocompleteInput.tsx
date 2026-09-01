import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { AustralianState } from '@tradieos/shared';
import { colours } from '../theme';

export type AddressSuggestion = {
  id: string;
  label: string;
  addressLine1: string;
  addressLine2?: string;
  suburb: string;
  state: AustralianState;
  postcode: string;
};

export type AddressSuggestionProvider = (
  query: string,
) => Promise<AddressSuggestion[]>;

type Props = {
  error?: string;
  label: string;
  onChangeText(value: string): void;
  onSelectSuggestion(suggestion: AddressSuggestion): void;
  placeholder?: string;
  provider?: AddressSuggestionProvider;
  value: string;
};

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 300;

export function AddressAutocompleteInput({
  error,
  label,
  onChangeText,
  onSelectSuggestion,
  placeholder,
  provider,
  value,
}: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const query = useMemo(() => value.trim(), [value]);

  useEffect(() => {
    let cancelled = false;
    setSearchError(null);

    if (!provider || query.length < MIN_QUERY_LENGTH) {
      setIsLoading(false);
      setHasSearched(false);
      setSuggestions([]);
      return () => {
        cancelled = true;
      };
    }

    setIsLoading(true);
    const timeout = setTimeout(() => {
      provider(query)
        .then((records) => {
          if (cancelled) return;
          setSuggestions(records);
          setHasSearched(true);
        })
        .catch(() => {
          if (cancelled) return;
          setSuggestions([]);
          setHasSearched(true);
          setSearchError(
            'Address suggestions are unavailable. You can still enter the address manually.',
          );
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [provider, query]);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoComplete="street-address"
        onChangeText={onChangeText}
        placeholder={placeholder ?? label}
        placeholderTextColor={colours.muted}
        style={[styles.input, error && styles.inputError]}
        textContentType="fullStreetAddress"
        value={value}
      />
      {isLoading ? (
        <View style={styles.statusRow}>
          <ActivityIndicator color={colours.primary} size="small" />
          <Text style={styles.helper}>Finding matching addresses...</Text>
        </View>
      ) : null}
      {suggestions.length ? (
        <View style={styles.suggestionList}>
          {suggestions.map((suggestion) => (
            <Pressable
              accessibilityRole="button"
              key={suggestion.id}
              onPress={() => onSelectSuggestion(suggestion)}
              style={styles.suggestion}
            >
              <Text style={styles.suggestionTitle}>{suggestion.label}</Text>
              <Text style={styles.helper}>
                {[suggestion.suburb, suggestion.state, suggestion.postcode]
                  .filter(Boolean)
                  .join(' ')}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {provider && hasSearched && !isLoading && !suggestions.length ? (
        <Text style={styles.helper}>
          No addresses found. Keep typing manually.
        </Text>
      ) : null}
      {searchError ? <Text style={styles.helper}>{searchError}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  error: { color: '#BE123C', fontWeight: '700', marginTop: 4 },
  field: { gap: 6, marginTop: 12 },
  helper: { color: colours.muted, lineHeight: 20 },
  input: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colours.ink,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputError: { borderColor: '#E11D48', borderWidth: 2 },
  label: { color: colours.ink, fontWeight: '800' },
  statusRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  suggestion: {
    backgroundColor: '#FFFFFF',
    borderColor: colours.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  suggestionList: { gap: 8 },
  suggestionTitle: { color: colours.ink, fontWeight: '900' },
});
