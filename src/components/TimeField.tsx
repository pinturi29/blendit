import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from './ui';
import { colors, fontFamily, fontSize, radii, spacing } from '../theme/tokens';

function formatTime(date: Date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

type TimeFieldProps = {
  label: string;
  value: Date;
  onChange: (date: Date) => void;
};

// Same modal-sheet shape as DateField, but mode="time" -- used for the
// wake-up/sleep-time pickers that bound each day of a generated itinerary.
export function TimeField({ label, value, onChange }: TimeFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  if (Platform.OS === 'android') {
    return (
      <View style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        <Pressable style={styles.input} onPress={() => setIsOpen(true)}>
          <Text style={styles.value}>{formatTime(value)}</Text>
        </Pressable>
        {isOpen && (
          <DateTimePicker
            value={value}
            mode="time"
            display="clock"
            onChange={(event, selected) => {
              setIsOpen(false);
              if (event.type === 'set' && selected) onChange(selected);
            }}
          />
        )}
      </View>
    );
  }

  if (Platform.OS === 'web') {
    return (
      <View style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.input}>
          <Text style={styles.value}>{formatTime(value)}</Text>
        </View>
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
        <Text style={styles.value}>{formatTime(value)}</Text>
      </Pressable>
      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={() => setIsOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setIsOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            {/* Modal keeps its children mounted even while visible={false} --
                gating the picker on isOpen keeps two of these off the tree
                (and off the CPU) whenever neither sheet is open. */}
            {isOpen && (
              <DateTimePicker
                value={draft}
                mode="time"
                display="spinner"
                themeVariant="light"
                onChange={(_event, selected) => {
                  if (selected) setDraft(selected);
                }}
              />
            )}
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
    flex: 1,
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
