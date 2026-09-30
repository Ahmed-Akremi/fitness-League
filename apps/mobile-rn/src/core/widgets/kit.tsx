import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { fonts, radius, useTheme } from '../theme';

export type IconName = ComponentProps<typeof MaterialIcons>['name'];

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: string }) {
  const { colors } = useTheme();
  return <MaterialIcons name={name} size={size} color={color ?? colors.text} />;
}

export function Txt({ children, style, variant = 'body', color, ...rest }: { children: ReactNode; variant?: 'body' | 'title' | 'label' | 'small' | 'display' | 'headline'; color?: string; style?: StyleProp<any> } & Omit<ComponentProps<typeof Text>, 'style'>) {
  const { colors } = useTheme();
  const v = {
    body: { fontSize: 15, fontFamily: fonts.body },
    title: { fontSize: 17, fontFamily: fonts.body, fontWeight: '700' as const },
    label: { fontSize: 12, fontFamily: fonts.body, fontWeight: '700' as const, letterSpacing: 1.2, textTransform: 'uppercase' as const },
    small: { fontSize: 13, fontFamily: fonts.body },
    display: { fontSize: 36, fontFamily: fonts.display, letterSpacing: -0.5 },
    headline: { fontSize: 28, fontFamily: fonts.display },
  }[variant];
  return (
    <Text style={[{ color: color ?? colors.text, textAlign: 'auto' }, v, style]} {...rest}>
      {children}
    </Text>
  );
}

type ButtonKind = 'filled' | 'tonal' | 'outlined' | 'text';

export function Button({ label, onPress, kind = 'filled', icon, busy, disabled, testID, style }: { label: string; onPress?: () => void; kind?: ButtonKind; icon?: IconName; busy?: boolean; disabled?: boolean; testID?: string; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const off = disabled || busy || !onPress;
  const bg = { filled: colors.primary, tonal: colors.surfaceHigh, outlined: 'transparent', text: 'transparent' }[kind];
  const fg = kind === 'filled' ? colors.onPrimary : kind === 'tonal' ? colors.text : colors.primary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: off && !busy ? 0.45 : pressed ? 0.8 : 1 },
        kind === 'outlined' && { borderWidth: 1, borderColor: colors.outline },
        kind === 'text' && { minHeight: 40, paddingHorizontal: 8 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <MaterialIcons name={icon} size={18} color={fg} />}
          <Text style={{ color: fg, fontWeight: '700', fontSize: 15, letterSpacing: 0.4 }}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, color }: { icon: IconName; onPress: () => void; label: string; color?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={{ padding: 8 }}>
      <Icon name={icon} color={color} />
    </Pressable>
  );
}

export function TextField({ label, error, icon, style, ...props }: { label?: string; error?: string | null; icon?: IconName; style?: StyleProp<ViewStyle> } & TextInputProps) {
  const { colors } = useTheme();
  return (
    <View style={style}>
      {label ? <Txt variant="small" color={colors.outline} style={{ marginBottom: 6 }}>{label}</Txt> : null}
      <View style={[styles.field, { backgroundColor: colors.surface, borderColor: error ? colors.error : colors.surfaceHigh }]}>
        {icon && <Icon name={icon} size={20} color={colors.outline} />}
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={colors.outline}
          style={{ flex: 1, color: colors.text, fontSize: 16, paddingVertical: 12, textAlign: 'auto' }}
          {...props}
        />
      </View>
      {error ? <Txt variant="small" color={colors.error} style={{ marginTop: 4 }}>{error}</Txt> : null}
    </View>
  );
}

export function Card({ children, onPress, style, testID }: { children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>; testID?: string }) {
  const { colors } = useTheme();
  const base = [{ backgroundColor: colors.surface, borderRadius: radius.card, padding: 16 }, style];
  return onPress ? (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  ) : (
    <View testID={testID} style={base}>{children}</View>
  );
}

export function Chip({ label, selected, onPress, icon, testID }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName; testID?: string }) {
  const { colors } = useTheme();
  const fg = selected ? colors.onPrimary : colors.text;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={{ selected }}
      disabled={!onPress}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.surfaceHigh }]}
    >
      {icon && <MaterialIcons name={icon} size={16} color={fg} />}
      <Text style={{ color: fg, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

/** Segmented tabs (league scopes, filters). */
export function Segmented<K extends string>({ options, value, onChange }: { options: { key: K; label: string }[]; value: K; onChange: (k: K) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
      {options.map((o) => (
        <Chip key={o.key} testID={`tab-${o.key}`} label={o.label} selected={o.key === value} onPress={() => onChange(o.key)} />
      ))}
    </ScrollView>
  );
}

export function Screen({ children, scroll = true, padded = true, edges = ['bottom'] }: { children: ReactNode; scroll?: boolean; padded?: boolean; edges?: ('top' | 'bottom')[] }) {
  const { colors } = useTheme();
  const pad = padded ? { padding: 16 } : null;
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: colors.background }}>
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[pad, { gap: 12, paddingBottom: 32 }]}>
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, pad]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Checkbox({ label, value, onChange, testID }: { label: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="checkbox" accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
      <MaterialIcons name={value ? 'check-box' : 'check-box-outline-blank'} size={24} color={value ? colors.primary : colors.outline} />
      <Txt style={{ flex: 1 }}>{label}</Txt>
    </Pressable>
  );
}

// ───────────── Toasts (Flutter SnackBar) ─────────────

const useToastStore = create<{ message: string | null; id: number }>(() => ({ message: null, id: 0 }));

export const toast = (message: string) => useToastStore.setState((s) => ({ message, id: s.id + 1 }));

export function ToastHost() {
  const { message, id } = useToastStore();
  const { colors } = useTheme();
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => useToastStore.setState({ message: null }), 3500);
    return () => clearTimeout(t);
  }, [message, id]);
  if (!message) return null;
  return (
    <SafeAreaView edges={['bottom']} pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={{ flex: 1, justifyContent: 'flex-end', padding: 16, paddingBottom: 72 }}>
        <View accessibilityLiveRegion="polite" style={{ backgroundColor: colors.surfaceHigh, borderRadius: 12, padding: 14 }}>
          <Txt>{message}</Txt>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 50, borderRadius: radius.pill, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.field, borderWidth: 1, paddingHorizontal: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
});
