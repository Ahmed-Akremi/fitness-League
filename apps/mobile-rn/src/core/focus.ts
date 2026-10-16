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

export function useKeyboardModality(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => keyboard,
    () => false,
  );
}

/** The ring of a focused control, or null: only on a computer, only after a key press. */
export function useFocusRing() {
  const { colors, dense } = useTheme();
  const keyboardOn = useKeyboardModality();
  return (focused?: boolean): ViewStyle | null => (dense && keyboardOn && focused ? { outlineStyle: 'solid', outlineWidth: 2, outlineColor: colors.primary, outlineOffset: 2 } : null);
}

/** `focused` from a Pressable's state: react-native-web passes it, the phones do not. */
export const isFocused = (state: unknown) => !!(state as { focused?: boolean }).focused;
