import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, TextField } from './ui';
import { colors, fontFamily, fontSize, radii, spacing } from '../theme/tokens';

function formatDate(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function toDateOnly(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

type DateFieldProps = {
  label: string;
  value: Date;
  onChange: (date: Date) => void;
  minimumDate?: Date;
};

export function DateField({ label, value, onChange, minimumDate }: DateFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  // @react-native-community/datetimepicker has no web build; fall back to a
  // plain text field there so the web preview doesn't crash. iOS/Android
  // (the real targets) get the actual calendar below.
  if (Platform.OS === 'web') {
    return (
      <TextField
        label={label}
        value={value.toISOString().slice(0, 10)}
        onChangeText={(text) => {
          const parsed = new Date(text + 'T00:00:00');
          if (!isNaN(parsed.getTime())) onChange(parsed);
        }}
        placeholder="YYYY-MM-DD"
      />
    );
  }

  if (Platform.OS === 'android') {
    return (
      <View style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        <Pressable style={styles.input} onPress={() => setIsOpen(true)}>
          <Text style={styles.value}>{formatDate(value)}</Text>
        </Pressable>
        {isOpen && (
          <DateTimePicker
            value={value}
            mode="date"
            display="calendar"
            minimumDate={minimumDate}
            onChange={(event, selected) => {
              setIsOpen(false);
              if (event.type === 'set' && selected) onChange(toDateOnly(selected));
            }}
          />
        )}
      </View>
    );
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={styles.input}
        onPress={() => {
          setDraft(value);
          setIsOpen(true);
        }}
      >
        <Text style={styles.value}>{formatDate(value)}</Text>
      </Pressable>
      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setIsOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <DateTimePicker
              value={draft}
              mode="date"
              display="inline"
              themeVariant="light"
              minimumDate={minimumDate}
              onChange={(_event, selected) => {
                if (selected) setDraft(toDateOnly(selected));
              }}
            />
            <View style={styles.sheetFooter}>
              <Button
                title="Done"
                onPress={() => {
                  onChange(draft);
                  setIsOpen(false);
                }}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    marginBottom: spacing.xl,
  },
  label: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.smd,
    color: colors.muted,
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingVertical: 13,
    paddingHorizontal: 13,
  },
  value: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.base,
    color: colors.text,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(12,40,66,0.36)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.xxl,
  },
  sheetFooter: {
    marginTop: spacing.lg,
  },
});
