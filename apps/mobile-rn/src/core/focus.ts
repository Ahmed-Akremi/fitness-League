import { useSyncExternalStore } from 'react';
import { Platform, type ViewStyle } from 'react-native';

import { useTheme } from './theme';

/**
 * Keyboard or pointer (lot Web 3): the focus ring shows after a key press and goes away with a click, as CSS
 * `:focus-visible` does (react-native-web cannot say it). Only the computer layout draws it (`ThemeScope dense`).
 */
let keyboard = false;
const listeners = new Set<() => void>();

export function setKeyboardModality(on: boolean) {
  if (keyboard === on) return;
  keyboard = on;
  listeners.forEach((l) => l());
}

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.addEventListener(
    'keydown',
    (e) => {
      if (!e.metaKey && !e.ctrlKey && !e.altKey) setKeyboardModality(true);
    },
    true,
  );
  document.addEventListener('pointerdown', () => setKeyboardModality(false), true);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const ignore = () => () => {};

/** `enabled` false: no subscription at all, so a key press does not re-render the controls that never draw a ring. */
export function useKeyboardModality(enabled = true): boolean {
  return useSyncExternalStore(enabled ? subscribe : ignore, () => enabled && keyboard, () => false);
}

/** The ring of a focused control, or null: only on a computer, only after a key press. */
export function useFocusRing() {
  const { colors, dense } = useTheme();
  const keyboardOn = useKeyboardModality(dense);
  return (focused?: boolean): ViewStyle | null => (dense && keyboardOn && focused ? { outlineStyle: 'solid', outlineWidth: 2, outlineColor: colors.primary, outlineOffset: 2 } : null);
}

/** Space ticks a checkbox in the browser: react-native-web only presses buttons and menu items with it. A phone never calls it. */
export function spaceKey(fn: () => void): object {
  return {
    onKeyDown: (e: { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
      if ((e.key ?? e.nativeEvent?.key) !== ' ') return;
      // Not the page scroll as well.
      e.preventDefault?.();
      fn();
    },
  };
}

/** `aria-pressed` for a toggle button: react-native-web writes it in the page, React Native's types do not list it. */
export const ariaPressed = (on: boolean): object => ({ 'aria-pressed': on });

/** `focused` from a Pressable's state: react-native-web passes it, the phones do not. */
export const isFocused = (state: unknown) => !!(state as { focused?: boolean }).focused;
