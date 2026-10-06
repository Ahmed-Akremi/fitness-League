import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Image, Pressable, TextInput, View } from 'react-native';

import { useLocale, useT } from '../prefs';
import { displayText, fonts, radius, space, useTheme } from '../theme';
import { formatDuration, localized, parseDuration } from '../utils/format';
import { Button, Chip, Icon, LinkButton, Txt, type IconName } from './kit';

export function Loading() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

/** Athletic card: big number, small label. */
export function StatCard({ label, children, onPress, trailing }: { label: string; children: ReactNode; onPress?: () => void; trailing?: ReactNode }) {
  const { colors } = useTheme();
  const Box = onPress ? Pressable : View;
  return (
    <Box onPress={onPress} accessibilityRole={onPress ? 'button' : undefined} style={{ backgroundColor: colors.surface, borderRadius: radius.card, padding: space.lg, borderWidth: 1, borderColor: colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <Txt variant="label" color={colors.outline} style={{ flex: 1 }}>{label}</Txt>
        {trailing}
      </View>
      {children}
    </Box>
  );
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

/** Animated XP bar. Animations are skipped when the OS asks for reduced motion (spec §19.6). */
export function XpBar({ value, label }: { value: number; label?: string }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const v = Math.min(1, Math.max(0, value));
  const anim = useRef(new Animated.Value(reduced ? v : 0)).current;
  useEffect(() => {
    if (reduced) anim.setValue(v);
    else Animated.timing(anim, { toValue: v, duration: 900, useNativeDriver: false }).start();
  }, [v, reduced, anim]);
  return (
    <View accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }} style={{ height: 10, borderRadius: 8, backgroundColor: colors.surfaceHigh, overflow: 'hidden' }}>
      <Animated.View style={{ height: 10, borderRadius: 8, backgroundColor: colors.primary, width: anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
    </View>
  );
}

export function EmptyState({ icon, message, actionLabel, onAction }: { icon: IconName; message: string; actionLabel?: string; onAction?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
      <Icon name={icon} size={56} color={colors.primary} />
      <Txt variant="title" style={{ textAlign: 'center', fontWeight: '500' }}>{message}</Txt>
      {actionLabel && <Button label={actionLabel} onPress={onAction} />}
    </View>
  );
}

export function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  const { colors } = useTheme();
  return (
    // In a Screen (gap 12) this gives 24 px above the title and 12 px between the title and its content.
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: space.md, paddingHorizontal: space.xs }}>
      <Txt accessibilityRole="header" variant="label" color={colors.outline} style={{ flex: 1, letterSpacing: 1.4 }}>{title}</Txt>
      {actionLabel && <LinkButton label={actionLabel} onPress={onAction} />}
    </View>
  );
}

/** Small tinted status pill (Accepted, Pending…). */
export function StatusPill({ label, color, testID }: { label: string; color: string; testID?: string }) {
  return (
    <View testID={testID} style={{ backgroundColor: color + '24', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Txt variant="small" color={color} style={{ fontSize: 12, fontWeight: '700' }}>{label}</Txt>
    </View>
  );
}

/** Movement arrow for leaderboard rows: ↑4, ↓2, NEW. */
export function MovementBadge({ movement }: { movement: unknown }) {
  const { colors } = useTheme();
  const t = useT();
  if (movement === 'NEW') return <Txt variant="small" color={colors.primary} style={{ fontWeight: '800' }}>{t('movementNew')}</Txt>;
  const m = typeof movement === 'number' ? Math.trunc(movement) : 0;
  if (m === 0) return <Txt variant="small" color={colors.outline}>–</Txt>;
  const up = m > 0;
  return (
    <Txt variant="small" accessibilityLabel={`${up ? '+' : '-'}${Math.abs(m)}`} color={up ? '#3DDC84' : '#FF6B6B'} style={{ fontWeight: '800' }}>
      {`${up ? '↑' : '↓'}${Math.abs(m)}`}
    </Txt>
  );
}

/** Pulsing placeholders while a list loads (static when animations are disabled). */
export function SkeletonList({ count = 6, height = 76 }: { count?: number; height?: number }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.6, duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduced, pulse]);
  return (
    <View testID="skeleton" style={{ padding: 16, gap: 10 }}>
      {Array.from({ length: count }, (_, i) => (
        <Animated.View key={i} style={{ height, borderRadius: 18, backgroundColor: colors.surfaceHigh, opacity: pulse }} />
      ))}
    </View>
  );
}

// ───────────── Athletes, ranks, sports ─────────────

export function divisionColor(code?: string | null): string {
  switch (code) {
    case 'SILVER':
      return '#C0C4CC';
    case 'GOLD':
      return '#FFD166';
    case 'PLATINUM':
      return '#7FDBDA';
    case 'DIAMOND':
      return '#3DA9FC';
    case 'ELITE':
      return '#C6F432';
    default:
      return '#E09F6B'; // BRONZE / none
  }
}

/** Initials avatar ringed with the division colour. */
export function AvatarBadge({ name, division, size = 44 }: { name: string; division?: string | null; size?: number }) {
  const { colors } = useTheme();
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0].toUpperCase()).join('');
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2.5, borderColor: divisionColor(division), padding: 2.5 }}>
      <View style={{ flex: 1, borderRadius: size, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' }}>
        <Txt style={{ fontWeight: '800', fontSize: size * 0.32 }}>{initials}</Txt>
      </View>
    </View>
  );
}

/** Leaderboard row: rank (medal colours for the podium), optional avatar, name, value; "me" highlighted. */
export function RankRow({ rank, name, value, highlight, leading, subtitle, trailing, onPress, onLongPress, testID }: { rank: number; name: string; value: string; highlight?: boolean; leading?: ReactNode; subtitle?: string; trailing?: ReactNode; onPress?: () => void; onLongPress?: () => void; testID?: string }) {
  const { colors } = useTheme();
  const medal = rank === 1 ? '#FFD166' : rank === 2 ? '#C0C4CC' : rank === 3 ? '#E09F6B' : colors.outline;
  return (
    <Pressable
      testID={testID}
      accessible
      accessibilityLabel={`Rank ${rank}, ${name}, ${value}`}
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress && !onLongPress}
      onPress={onPress}
      onLongPress={onLongPress}
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: highlight ? colors.primary + '24' : 'transparent' }}
    >
      <Txt style={[displayText(20), { width: 44, color: medal }]}>#{rank}</Txt>
      {leading ? <View style={{ marginEnd: 12 }}>{leading}</View> : null}
      <View style={{ flex: 1 }}>
        <Txt numberOfLines={1} style={{ fontSize: 16, fontWeight: highlight ? '800' : '600' }}>{name}</Txt>
        {subtitle ? <Txt variant="small" color={colors.outline}>{subtitle}</Txt> : null}
      </View>
      {trailing ? <View style={{ marginEnd: 8 }}>{trailing}</View> : null}
      <Txt style={displayText(22)}>{value}</Txt>
    </Pressable>
  );
}

export function sportIcon(code: string): IconName {
  switch (code) {
    case 'CROSSFIT':
      return 'sports-gymnastics';
    case 'HYROX':
      return 'flag-circle';
    case 'RUNNING':
      return 'directions-run';
    case 'CYCLING':
      return 'directions-bike';
    case 'SWIMMING':
      return 'pool';
    case 'WALKING':
      return 'directions-walk';
    case 'FUNCTIONAL':
      return 'bolt';
    default:
      return 'fitness-center';
  }
}

/** Sport pill; selectable when onPress is set (filters). */
export function SportChip({ code, name, selected, onPress, testID }: { code: string; name: unknown; selected?: boolean; onPress?: () => void; testID?: string }) {
  const locale = useLocale();
  return <Chip testID={testID} icon={sportIcon(code)} label={localized(name, locale)} selected={selected} onPress={onPress} />;
}

const GYM_PALETTE = ['#C6F432', '#3DA9FC', '#FF8A3D', '#F15BB5', '#06D6A0', '#FFD166', '#9B5DE5'];

/** Gym logo (rounded square). Without a URL, initials on a colour derived from the name. */
export function GymLogo({ name, url, size = 56 }: { name: string; url?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const r = size * 0.24;
  if (url && !failed) {
    return <Image accessibilityLabel={name} source={{ uri: url }} onError={() => setFailed(true)} style={{ width: size, height: size, borderRadius: r }} />;
  }
  const words = name.split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  const initials = words.length === 0 ? '?' : words.length === 1 ? [...words[0]].slice(0, 2).join('').toUpperCase() : words.slice(0, 2).map((w) => [...w][0].toUpperCase()).join('');
  const bg = GYM_PALETTE[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % GYM_PALETTE.length];
  return (
    <View accessibilityLabel={name} accessibilityRole="image" style={{ width: size, height: size, borderRadius: r, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Txt style={{ fontFamily: fonts.display, fontSize: size * 0.4, color: '#0E0F12' }}>{initials}</Txt>
    </View>
  );
}

/** Duration input in m:ss or h:mm:ss. Reports seconds, or null while the text is invalid. */
export function TimeField({ onChange, label, initialSeconds, value: controlled, onChangeText, testID }: { onChange: (seconds: number | null) => void; label?: string; initialSeconds?: number; value?: string; onChangeText?: (text: string) => void; testID?: string }) {
  const t = useT();
  const { colors } = useTheme();
  const [own, setOwn] = useState(initialSeconds == null ? '' : formatDuration(initialSeconds));
  const text = controlled ?? own;
  const invalid = text.trim() !== '' && parseDuration(text) == null;
  return (
    <View style={{ flex: 1 }}>
      {label ? <Txt variant="small" color={colors.outline} style={{ marginBottom: 6 }}>{label}</Txt> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.field, borderWidth: 1, borderColor: invalid ? colors.error : colors.surfaceHigh, backgroundColor: colors.surface, paddingHorizontal: 12 }}>
        <Icon name="timer" size={20} color={colors.outline} />
        <TextInput
          testID={testID}
          accessibilityLabel={label}
          value={text}
          placeholder="0:00"
          placeholderTextColor={colors.outline}
          keyboardType="numbers-and-punctuation"
          maxLength={8}
          style={[displayText(22), { flex: 1, color: colors.text, paddingVertical: 8 }]}
          onChangeText={(raw) => {
            const clean = raw.replace(/[^0-9:]/g, '');
            if (onChangeText) onChangeText(clean);
            else setOwn(clean);
            onChange(parseDuration(clean));
          }}
        />
      </View>
      {invalid ? <Txt variant="small" color={colors.error} style={{ marginTop: 4 }}>{t('timeFormatError')}</Txt> : null}
    </View>
  );
}

/** "2d 4h left" / "3h 12m left" / "8m left"; refreshes every 30 s. */
export function CountdownText({ endsAt, style }: { endsAt: Date | string; style?: object }) {
  const t = useT();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const left = new Date(endsAt).getTime() - Date.now();
  const minutes = Math.floor(left / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const text =
    left < 0
      ? t('wodEnded')
      : days > 0
        ? t('timeLeftDays', { days, hours: hours % 24 })
        : hours > 0
          ? t('timeLeftHours', { hours, minutes: minutes % 60 })
          : t('timeLeftMinutes', { minutes: Math.min(59, Math.max(1, minutes)) });
  return <Txt style={style}>{text}</Txt>;
}
