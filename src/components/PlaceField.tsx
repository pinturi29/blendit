import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { TextField } from './ui';
import { colors, fontFamily, fontSize, radii, spacing } from '../theme/tokens';

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;

type Suggestion = {
  placeId: string;
  label: string;
};

type PlaceFieldProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  onSelect: (place: { label: string; lat: number; lon: number }) => void;
  placeholder?: string;
};

// Google Places Autocomplete -- unlike a plain geocoder (Nominatim/OSM),
// this is actually built for "type-as-you-go" search, including full
// street addresses (a hotel/Airbnb address), not just place names like
// city/country. Debounced so we're not firing a request per keystroke.
// Autocomplete predictions don't include coordinates -- Place Details is a
// second call, made only once, when something is actually selected.
export function PlaceField({ label, value, onChangeText, onSelect, placeholder }: PlaceFieldProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!GOOGLE_PLACES_API_KEY || value.trim().length < 3) {
      setSuggestions([]);
      return;
    }

    const requestId = ++requestIdRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
        url.searchParams.set('input', value);
        url.searchParams.set('key', GOOGLE_PLACES_API_KEY);

        const res = await fetch(url.toString());
        const data = (await res.json()) as {
          predictions?: Array<{ place_id: string; description: string }>;
          status: string;
        };
        if (requestId !== requestIdRef.current) return; // a newer keystroke superseded this request

        setSuggestions(
          data.status === 'OK'
            ? (data.predictions ?? []).map((p) => ({ placeId: p.place_id, label: p.description }))
            : []
        );
      } catch {
        if (requestId === requestIdRef.current) setSuggestions([]);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  async function handleSelect(item: Suggestion) {
    setSuggestions([]);
    setIsOpen(false);
    if (!GOOGLE_PLACES_API_KEY) return;

    setIsResolving(true);
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
      url.searchParams.set('place_id', item.placeId);
      url.searchParams.set('fields', 'geometry,formatted_address');
      url.searchParams.set('key', GOOGLE_PLACES_API_KEY);

      const res = await fetch(url.toString());
      const data = (await res.json()) as {
        result?: { geometry?: { location?: { lat: number; lng: number } }; formatted_address?: string };
        status: string;
      };
      const location = data.result?.geometry?.location;
      if (data.status === 'OK' && location) {
        onSelect({ label: data.result?.formatted_address ?? item.label, lat: location.lat, lon: location.lng });
      }
    } finally {
      setIsResolving(false);
    }
  }

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
      {isResolving && (
        <View style={styles.resolving}>
          <ActivityIndicator size="small" color={colors.navy} />
        </View>
      )}
      {isOpen && suggestions.length > 0 && (
        <View style={styles.dropdown}>
          {suggestions.map((item) => (
            <Pressable key={item.placeId} style={styles.row} onPress={() => handleSelect(item)}>
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
  resolving: {
    marginTop: -8,
    marginBottom: spacing.xl,
    alignItems: 'center',
  },
});
