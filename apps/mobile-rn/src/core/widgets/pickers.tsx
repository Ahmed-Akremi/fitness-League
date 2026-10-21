import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { FlatList, Modal, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLocale, useT } from '../prefs';
import { isFocused, useFocusRing } from '../focus';
import { radius, useTheme, webDense } from '../theme';
import { formatDate } from '../utils/format';
import { Button, Icon, Txt, type IconName } from './kit';
import { NativePicker } from './native';

export interface Option {
  value: string;
  label: string;
}

/**
 * Field that opens a list (Flutter DropdownButtonFormField): full screen on a phone, a small centered box on a computer.
 * `bare`: no label above (toolbars). `menu`: a short fixed list (days, visibility, language) — on iOS the system
 * pop-up menu instead (HIG Pickers: a short list is a pop-up button, not a picker).
 */
export function Select({ label, value, options, onChange, error, testID, placeholder, bare, menu }: { label: string; value: string | null | undefined; options: Option[]; onChange: (v: string) => void; error?: string | null; testID?: string; placeholder?: string; bare?: boolean; menu?: boolean }) {
  const t = useT();
  const { colors, dense, highContrast } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  if (menu && Platform.OS === 'ios') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.field, borderWidth: 1, borderColor: error ? colors.error : highContrast ? colors.outline : colors.surfaceHigh, backgroundColor: colors.surface, paddingStart: 12, paddingEnd: 4, minHeight: 48 }}>
        <Txt style={{ flex: 1 }}>{label}</Txt>
        <NativePicker testID={testID} label={label} value={value} options={options} onChange={onChange} color={colors.primary} />
      </View>
    );
  }
  const head = (
    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
      <Txt variant="title" style={{ flex: 1 }}>{label}</Txt>
      <Pressable accessibilityRole="button" accessibilityLabel={t('cancel')} onPress={() => setOpen(false)} hitSlop={11}>
        <Icon name="close" />
      </Pressable>
    </View>
  );
  const list = (
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
          style={{ paddingHorizontal: 16, paddingVertical: dense ? 10 : 14, flexDirection: 'row', alignItems: 'center' }}
        >
          <Txt style={{ flex: 1 }}>{item.label}</Txt>
          {item.value === value && <Icon name="check" color={colors.primary} />}
        </Pressable>
      )}
    />
  );
  return (
    <View>
      <FieldButton testID={testID} label={label} bare={bare} value={selected?.label ?? placeholder ?? ''} icon="arrow-drop-down" error={error} onPress={() => setOpen(true)} />
      <Modal visible={open} transparent={dense} animationType={dense ? 'fade' : 'slide'} onRequestClose={() => setOpen(false)}>
        {dense ? (
          <View style={{ flex: 1, backgroundColor: '#00000066', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <View style={{ width: '100%', maxWidth: 360, maxHeight: 480, backgroundColor: colors.surface, borderRadius: webDense.radius.card, overflow: 'hidden' }}>
              {head}
              {list}
            </View>
          </View>
        ) : (
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
            {head}
            {list}
          </SafeAreaView>
        )}
      </Modal>
    </View>
  );
}

/** Tappable read-only field (date, select). `bare`: no label above it (screen readers still read it). */
export function FieldButton({ label, value, icon, error, onPress, testID, bare }: { label: string; value: string; icon: IconName; error?: string | null; onPress: () => void; testID?: string; bare?: boolean }) {
  const { colors, dense, highContrast } = useTheme();
  const ring = useFocusRing();
  return (
    <View>
      {bare ? null : <Txt variant="small" color={error ? colors.error : colors.outline} style={dense ? { marginBottom: 4, fontSize: 12 } : { marginBottom: 6 }}>{label}</Txt>}
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={(state) => [
          { flexDirection: 'row', alignItems: 'center', borderRadius: radius.field, borderWidth: 1, borderColor: error ? colors.error : highContrast ? colors.outline : colors.surfaceHigh, backgroundColor: colors.surface, paddingHorizontal: 12, minHeight: 48 },
          dense && { borderRadius: webDense.radius.field, minHeight: webDense.control, paddingHorizontal: 10 },
          bare && { minWidth: 150, justifyContent: 'space-between', gap: 4 },
          ring(isFocused(state)),
        ]}
      >
        <Txt style={[bare ? { flexShrink: 1 } : { flex: 1 }, dense && { fontSize: 13 }]} numberOfLines={bare ? 1 : undefined} color={value ? colors.text : colors.outline}>{value}</Txt>
        <Icon name={icon} size={dense ? 18 : 22} color={colors.outline} />
      </Pressable>
      {error ? <Txt variant="small" color={colors.error} style={{ marginTop: 4 }}>{error}</Txt> : null}
    </View>
  );
}

/**
 * Date (and optionally time) field backed by the platform picker. `display` (iOS): the calendar by default; `spinner`
 * for dates far back (a birth date), which stays open while the wheels turn, until Done.
 */
export function DateField({ label, value, onChange, minimumDate, maximumDate, mode = 'date', placeholder, error, testID, display = 'inline' }: { label: string; value: Date | null; onChange: (d: Date) => void; minimumDate?: Date; maximumDate?: Date; mode?: 'date' | 'datetime'; placeholder?: string; error?: string | null; testID?: string; display?: 'inline' | 'spinner' }) {
  const t = useT();
  const locale = useLocale();
  const [step, setStep] = useState<'date' | 'time' | null>(null);
  const [draft, setDraft] = useState<Date | null>(null);
  const shown = value ? formatDate(value, locale, mode === 'date' ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' }) : placeholder ?? '';
  return (
    <View>
      <FieldButton testID={testID} label={label} value={shown} icon="calendar-month" error={error} onPress={() => setStep('date')} />
      {step && (
        <DateTimePicker
          testID={testID ? `${testID}-picker` : undefined}
          value={draft ?? value ?? maximumDate ?? new Date()}
          mode={step}
          display={Platform.OS === 'ios' ? display : 'default'}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={(event, d) => {
            if (event.type !== 'set' || !d) {
              setStep(null);
              return;
            }
            if (Platform.OS === 'ios' && display === 'spinner' && mode === 'date') {
              onChange(d);
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
      {step && Platform.OS === 'ios' && <Button kind="text" label={t('done')} onPress={() => setStep(null)} />}
    </View>
  );
}
