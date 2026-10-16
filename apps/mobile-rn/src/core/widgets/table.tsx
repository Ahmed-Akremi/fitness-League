import { MaterialIcons } from '@expo/vector-icons';
import type { ReactElement, ReactNode } from 'react';
import { FlatList, Pressable, View, type ViewStyle } from 'react-native';

import { isFocused, useFocusRing } from '../focus';
import { space, useTheme, webDense } from '../theme';
import { Menu, Txt } from './kit';

export type Column<T> = { key: string; label: string; flex?: number; width?: number; align?: 'start' | 'end'; render: (row: T, index: number) => ReactNode };
export type RowAction = { label: string; onPress: () => void; testID?: string };
export type Selection = { selected: ReadonlySet<string>; onToggle: (key: string) => void; onToggleAll: () => void; label: (name: string) => string; allLabel: string };

const ROW_HEIGHT = 44;

/**
 * Desktop table (Circle21 refs 12, 14): a rounded header strip with 12 px muted labels, 44 px rows, an optional
 * checkbox column and a ⋯ menu per row. A FlatList inside, so a list of hundreds stays fast; `header` scrolls with it.
 */
export function DataTable<T>({ testID, rows, keyOf, nameOf, columns, rowTestID, onRowPress, selection, rowActions, menuLabel, header, empty }: {
  testID: string;
  rows: T[];
  keyOf: (row: T) => string;
  /** What the row is called: read with its checkbox and its menu. */
  nameOf: (row: T) => string;
  columns: Column<T>[];
  rowTestID?: (row: T) => string;
  onRowPress?: (row: T) => void;
  selection?: Selection;
  rowActions?: (row: T) => RowAction[];
  menuLabel?: (name: string) => string;
  header?: ReactElement;
  empty?: ReactElement;
}) {
  const { colors } = useTheme();
  const ring = useFocusRing();
  const all = !!selection && rows.length > 0 && rows.every((r) => selection.selected.has(keyOf(r)));
  const some = !!selection && rows.some((r) => selection.selected.has(keyOf(r)));
  const cell = (c: Column<T>): ViewStyle => ({ flex: c.width ? undefined : (c.flex ?? 1), width: c.width, alignItems: c.align === 'end' ? 'flex-end' : 'flex-start', justifyContent: 'center' });
  const strip = (
    <View testID={`${testID}-head`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 40, paddingHorizontal: space.md, borderRadius: webDense.radius.field, backgroundColor: colors.surface }}>
      {selection ? <Check testID={`${testID}-check-all`} checked={all} mixed={!all && some} label={selection.allLabel} onPress={selection.onToggleAll} /> : null}
      {columns.map((c) => (
        <View key={c.key} style={cell(c)}>
          <Txt numberOfLines={1} style={webDense.caption} color={colors.outline}>
            {c.label}
          </Txt>
        </View>
      ))}
      {rowActions ? <View style={{ width: webDense.control }} /> : null}
    </View>
  );
  return (
    <FlatList
      testID={testID}
      data={rows}
      keyExtractor={keyOf}
      contentContainerStyle={{ padding: space.lg }}
      ListHeaderComponent={
        <View style={{ gap: space.md, marginBottom: space.xs }}>
          {header}
          {strip}
        </View>
      }
      ListEmptyComponent={empty}
      renderItem={({ item, index }) => {
        const key = keyOf(item);
        const name = nameOf(item);
        return (
          <Pressable
            testID={rowTestID ? rowTestID(item) : `${testID}-row-${key}`}
            // A row that holds its own buttons (menu, checkbox) is not a button itself: on the web a button cannot contain one. The menu's « open » is then the keyboard way.
            accessibilityRole={onRowPress && !rowActions && !selection ? 'button' : undefined}
            disabled={!onRowPress}
            onPress={onRowPress && (() => onRowPress(item))}
            style={(state) => {
              // react-native-web passes `hovered` too.
              const hovered = (state as { hovered?: boolean }).hovered;
              const row: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: ROW_HEIGHT, paddingHorizontal: space.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: hovered || state.pressed ? colors.surface : 'transparent' };
              return [row, ring(isFocused(state))];
            }}
          >
            {selection ? <Check testID={`${testID}-check-${key}`} checked={selection.selected.has(key)} label={selection.label(name)} onPress={() => selection.onToggle(key)} /> : null}
            {columns.map((c) => {
              const v = c.render(item, index);
              return (
                <View key={c.key} style={cell(c)}>
                  {typeof v === 'string' || typeof v === 'number' ? (
                    <Txt numberOfLines={1} style={{ fontSize: 13 }}>
                      {String(v)}
                    </Txt>
                  ) : (
                    v
                  )}
                </View>
              );
            })}
            {rowActions ? <Menu testID={`${testID}-menu-${key}`} icon="more-horiz" label={menuLabel ? menuLabel(name) : name} items={rowActions(item)} /> : null}
          </Pressable>
        );
      }}
    />
  );
}

function Check({ testID, checked, mixed, label, onPress }: { testID: string; checked: boolean; mixed?: boolean; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const ring = useFocusRing();
  return (
    <Pressable testID={testID} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: mixed ? 'mixed' : checked }} hitSlop={6} onPress={onPress} style={(state) => [{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }, ring(isFocused(state))]}>
      <MaterialIcons name={checked ? 'check-box' : mixed ? 'indeterminate-check-box' : 'check-box-outline-blank'} size={20} color={checked || mixed ? colors.primary : colors.outline} />
    </Pressable>
  );
}
