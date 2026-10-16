import { MaterialIcons } from '@expo/vector-icons';
import { Children, Fragment, isValidElement, useState, type ReactNode } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { ariaPressed, isFocused, useFocusRing } from '../focus';
import { displayText, space, useTheme, webDense } from '../theme';
import { Txt, type IconName } from './kit';

/** Organizer space on a computer (lot Web 2): the page pieces of the Circle21 back-office, in our colours and fonts. */

/** Section header row (Circle21 refs 01, 12, 20): uppercase title, the page's actions on the right, a hairline under it. `flush`: inside an already padded list. */
export function PageHeader({ title, actions, flush, testID }: { title: string; actions?: ReactNode; flush?: boolean; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: webDense.gap, minHeight: 56, paddingHorizontal: flush ? 0 : space.lg, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}
    >
      <Txt accessibilityRole="header" style={[webDense.sectionTitle, { flexGrow: 1 }]}>
        {title}
      </Txt>
      {actions ? <Toolbar>{actions}</Toolbar> : null}
    </View>
  );
}

/** A row of filters, search and buttons that wraps when the window is narrow. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm }}>{children}</View>;
}

/** Filled search box with a magnifier (Circle21 refs 12, 19, 20). */
export function SearchField({ value, onChangeText, placeholder, testID, width = 220 }: { value: string; onChangeText: (s: string) => void; placeholder: string; testID?: string; width?: number }) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    // The border is always there (transparent at rest): the focus only colours it, so the box keeps its size.
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: webDense.control, width, borderRadius: webDense.radius.field, backgroundColor: colors.surfaceHigh, paddingHorizontal: 10, borderWidth: 1, borderColor: focused ? colors.primary : 'transparent' }}>
      <MaterialIcons name="search" size={16} color={colors.outline} />
      <TextInput
        testID={testID}
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.outline}
        autoCapitalize="none"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ flex: 1, color: colors.text, fontSize: 13, paddingVertical: 0, textAlign: 'auto' }}
      />
    </View>
  );
}

/** 32 px square icon button (export, refresh): the label is what screen readers say. */
export function SquareButton({ icon, label, onPress, disabled, testID }: { icon: IconName; label: string; onPress?: () => void; disabled?: boolean; testID?: string }) {
  const { colors } = useTheme();
  const ring = useFocusRing();
  const off = disabled || !onPress;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={onPress}
      style={(state) => [{ width: webDense.control, height: webDense.control, borderRadius: webDense.radius.field, borderWidth: 1, borderColor: colors.outline, alignItems: 'center', justifyContent: 'center', opacity: off ? 0.45 : state.pressed ? 0.8 : 1 }, ring(isFocused(state))]}
    >
      <MaterialIcons name={icon} size={18} color={colors.text} />
    </Pressable>
  );
}

/** « Afficher en : Pourcentages (%) | Nombres » (Circle21 ref 03): a caption and text options, the chosen one underlined. */
export function SegmentedInline<K extends string>({ label, options, value, onChange, testID }: { label: string; options: { key: K; label: string }[]; value: K; onChange: (k: K) => void; testID?: string }) {
  const { colors } = useTheme();
  const ring = useFocusRing();
  return (
    // Toggle buttons in a group named by the label (role radio needs arrow keys, which this switch does not have).
    <View testID={testID} role="group" aria-label={label} style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
      <Txt aria-hidden style={webDense.caption} color={colors.outline}>
        {label}
      </Txt>
      {options.map((o, i) => {
        const on = o.key === value;
        return (
          <Fragment key={o.key}>
            {i > 0 ? (
              <Txt aria-hidden style={webDense.caption} color={colors.outline}>
                |
              </Txt>
            ) : null}
            <Pressable testID={testID ? `${testID}-${o.key}` : undefined} accessibilityRole="button" {...ariaPressed(on)} hitSlop={6} onPress={() => onChange(o.key)} style={(state) => [{ minHeight: 24, justifyContent: 'center' }, ring(isFocused(state))]}>
              <Txt style={[webDense.caption, { textDecorationLine: on ? 'underline' : 'none', fontWeight: on ? '700' : '400' }]} color={on ? colors.text : colors.outline}>
                {o.label}
              </Txt>
            </Pressable>
          </Fragment>
        );
      })}
    </View>
  );
}

/** Figure card (Circle21 refs 01, 16): title, caption, big number, an optional footnote with an info icon. */
export function KpiCard({ title, caption, value, footnote, testID }: { title: string; caption?: string; value: string; footnote?: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ backgroundColor: colors.surface, borderRadius: webDense.radius.card, padding: webDense.pad, gap: 2, minHeight: 140 }}>
      <Txt style={webDense.cardTitle}>{title}</Txt>
      {caption ? (
        <Txt style={webDense.caption} color={colors.outline}>
          {caption}
        </Txt>
      ) : null}
      {/* No line limit: a long amount wraps on a narrow card rather than ending in « … ». */}
      <Txt testID={testID ? `${testID}-value` : undefined} style={[displayText(webDense.kpi), { marginTop: space.md }]}>
        {value}
      </Txt>
      {footnote ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: space.xs }}>
          <MaterialIcons name="info-outline" size={14} color={colors.outline} />
          <Txt style={webDense.caption} color={colors.outline}>
            {footnote}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

/** Card with a title, a caption and an optional action (Circle21 refs 02, 03); `empty` shows « no data » in the middle instead of the content. */
export function SectionCard({ title, caption, action, empty, children, testID }: { title: string; caption?: string; action?: ReactNode; empty?: string | null; children?: ReactNode; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ backgroundColor: colors.surface, borderRadius: webDense.radius.card, padding: webDense.pad, gap: space.md, minHeight: 200 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt style={webDense.cardTitle}>{title}</Txt>
          {caption ? (
            <Txt style={webDense.caption} color={colors.outline}>
              {caption}
            </Txt>
          ) : null}
        </View>
        {action}
      </View>
      {empty ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Txt testID={testID ? `${testID}-empty` : undefined} style={{ fontSize: 13 }} color={colors.outline}>
            {empty}
          </Txt>
        </View>
      ) : (
        children
      )}
    </View>
  );
}

/** How many columns fit: the largest of `counts` whose items keep at least `min` px. */
export const gridColumns = (width: number, min: number, counts: number[]) => counts.find((n) => n * min + (n - 1) * webDense.gap <= width) ?? 1;

/** Equal columns (KPI cards 4 / 2 / 1, card rows 3 / 1), measured on the real width. */
export function Grid({ min, counts, children, testID }: { min: number; counts: number[]; children: ReactNode; testID?: string }) {
  const [width, setWidth] = useState(0);
  const items = Children.toArray(children).filter(isValidElement);
  const cols = width > 0 ? gridColumns(width, min, counts) : counts[0];
  // Rounded down: a fraction of a pixel too much would push the last card to the next row.
  const itemWidth = width > 0 ? Math.floor((width - webDense.gap * (cols - 1)) / cols) : undefined;
  return (
    <View testID={testID} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: webDense.gap }}>
      {items.map((child, i) => (
        <View key={child.key ?? i} style={itemWidth ? { width: itemWidth } : { flexGrow: 1, flexBasis: 0 }}>
          {child}
        </View>
      ))}
    </View>
  );
}
