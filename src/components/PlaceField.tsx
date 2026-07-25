import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { TextField } from './ui';
import { colors, fontFamily, fontSize, radii, spacing } from '../theme/tokens';

type Suggestion = {
  id: string;
  label: string;
  lat: number;
  lon: number;
};

type PlaceFieldProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  onSelect: (place: { label: string; lat: number; lon: number }) => void;
  placeholder?: string;
};

// Free-text search against OpenStreetMap's Nominatim API — no API key
// needed. Debounced so we don't hammer the public endpoint on every
// keystroke.
export function PlaceField({ label, value, onChangeText, onSelect, placeholder }: PlaceFieldProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < 3) {
      setSuggestions([]);
      return;
    }

    const requestId = ++requestIdRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&limit=6&q=${encodeURIComponent(
            value
          )}`,
          {
            headers: {
              Accept: 'application/json',
              ...(Platform.OS !== 'web' ? { 'User-Agent': 'blendit-app' } : {}),
            },
          }
        );
        const data: Array<{ place_id: number; display_name: string; lat: string; lon: string }> =
          await res.json();
        if (requestId !== requestIdRef.current) return; // a newer keystroke superseded this request
        setSuggestions(
          data.map((item) => ({
            id: String(item.place_id),
            label: item.display_name,
            lat: parseFloat(item.lat),
            lon: parseFloat(item.lon),
          }))
        );
      } catch {
        if (requestId === requestIdRef.current) setSuggestions([]);
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  return (
    <View>
      <TextField
        label={label}
        value={value}
        onChangeText={(text) => {
          onChangeText(text);
          setIsOpen(true);
        }}
        placeholder={placeholder}
        onFocus={() => setIsOpen(true)}
      />
      {isOpen && suggestions.length > 0 && (
        <View style={styles.dropdown}>
          {suggestions.map((item) => (
            <Pressable
              key={item.id}
              style={styles.row}
              onPress={() => {
                onSelect({ label: item.label, lat: item.lat, lon: item.lon });
                setSuggestions([]);
                setIsOpen(false);
              }}
            >
              <Text style={styles.rowText} numberOfLines={2}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dropdown: {
    marginTop: -8,
    marginBottom: spacing.xl,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  row: {
    paddingVertical: 11,
    paddingHorizontal: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  rowText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.md,
    color: colors.text,
  },
});
