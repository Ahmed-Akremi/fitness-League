import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { FlatList, Modal, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLocale } from '../prefs';
import { radius, useTheme } from '../theme';
import { formatDate } from '../utils/format';
import { Button, Icon, Txt, type IconName } from './kit';

export interface Option {
  value: string;
  label: string;
}

/** Field that opens a full-screen list (Flutter DropdownButtonFormField). */
export function Select({ label, value, options, onChange, error, testID, placeholder }: { label: string; value: string | null | undefined; options: Option[]; onChange: (v: string) => void; error?: string | null; testID?: string; placeholder?: string }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <View>
      <FieldButton testID={testID} label={label} value={selected?.label ?? placeholder ?? ''} icon="arrow-drop-down" error={error} onPress={() => setOpen(true)} />
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
            <Txt variant="title" style={{ flex: 1 }}>{label}</Txt>
            <Pressable accessibilityRole="button" accessibilityLabel="close" onPress={() => setOpen(false)} hitSlop={8}>
              <Icon name="close" />
            </Pressable>
          </View>
          <FlatList
            data={options}
            keyExtractor={(o) => o.value}
            renderItem={({ item }) => (
              <Pressable
                testID={`${testID ?? 'option'}-${item.value}`}
                accessibilityRole="button"
                accessibilityState={{ selected: item.value === value }}
                onPress={() => {
                  onChange(item.value);
                  setOpen(false);
                }}
                style={{ paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center' }}
              >
                <Txt style={{ flex: 1 }}>{item.label}</Txt>
                {item.value === value && <Icon name="check" color={colors.primary} />}
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

/** Tappable read-only field (date, select). */
export function FieldButton({ label, value, icon, error, onPress, testID }: { label: string; value: string; icon: IconName; error?: string | null; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View>
      <Txt variant="small" color={error ? colors.error : colors.outline} style={{ marginBottom: 6 }}>{label}</Txt>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={{ flexDirection: 'row', alignItems: 'center', borderRadius: radius.field, borderWidth: 1, borderColor: error ? colors.error : colors.surfaceHigh, backgroundColor: colors.surface, paddingHorizontal: 12, minHeight: 48 }}
      >
        <Txt style={{ flex: 1 }} color={value ? colors.text : colors.outline}>{value}</Txt>
        <Icon name={icon} color={colors.outline} />
      </Pressable>
      {error ? <Txt variant="small" color={colors.error} style={{ marginTop: 4 }}>{error}</Txt> : null}
    </View>
  );
}

/** Date (and optionally time) field backed by the platform picker. */
export function DateField({ label, value, onChange, minimumDate, maximumDate, mode = 'date', placeholder, error, testID }: { label: string; value: Date | null; onChange: (d: Date) => void; minimumDate?: Date; maximumDate?: Date; mode?: 'date' | 'datetime'; placeholder?: string; error?: string | null; testID?: string }) {
  const locale = useLocale();
  const [step, setStep] = useState<'date' | 'time' | null>(null);
  const [draft, setDraft] = useState<Date | null>(null);
  const shown = value ? formatDate(value, locale, mode === 'date' ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' }) : placeholder ?? '';
  return (
    <View>
      <FieldButton testID={testID} label={label} value={shown} icon="calendar-month" error={error} onPress={() => setStep('date')} />
      {step && (
        <DateTimePicker
          value={draft ?? value ?? maximumDate ?? new Date()}
          mode={step}
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={(event, d) => {
            if (event.type !== 'set' || !d) {
              setStep(null);
              return;
            }
            if (step === 'date' && mode === 'datetime') {
              setDraft(d);
              setStep(Platform.OS === 'ios' ? null : 'time');
              if (Platform.OS === 'ios') onChange(d);
              return;
            }
            setStep(null);
            setDraft(null);
            onChange(d);
          }}
        />
      )}
      {step && Platform.OS === 'ios' && <Button kind="text" label="OK" onPress={() => setStep(null)} />}
    </View>
  );
}
