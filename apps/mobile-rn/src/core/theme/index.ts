import { useColorScheme } from 'react-native';

import { config } from '../config';
import { usePrefs } from '../prefs';

/**
 * Visual direction (spec §19.5): sport × competitive gaming × minimal fitness.
 * Dark first (graphite base), one configurable accent, big numbers, no neon overload.
 */
export interface Colors {
  background: string;
  surface: string;
  surfaceHigh: string;
  text: string;
  outline: string;
  /** Hairline borders and dividers. */
  border: string;
  primary: string;
  onPrimary: string;
  error: string;
  success: string;
}

/** Colour of `accent` darkened as Flutter's alphaBlend(black 45%, accent) — readable on white. */
function darken(hex: string, alpha = 0.45): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 0xff) * (1 - alpha)).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

export const palettes = {
  dark: (accent: string): Colors => ({
    background: '#0E0F12',
    surface: '#17191E',
    surfaceHigh: '#20232A',
    text: '#E6E8EC',
    outline: '#8C919B',
    border: '#FFFFFF14',
    primary: accent,
    onPrimary: '#000000',
    error: '#FF6B6B',
    success: '#3DDC84',
  }),
  light: (accent: string): Colors => ({
    background: '#FFFFFF',
    surface: '#F6F7F9',
    surfaceHigh: '#E9EBEF',
    text: '#14161A',
    outline: '#6B7079',
    border: '#0000000F',
    primary: darken(accent),
    onPrimary: '#000000',
    error: '#C62828',
    success: '#1E8E4E',
  }),
};

export const fonts = {
  display: 'BarlowCondensed-ExtraBold',
  displaySemi: 'BarlowCondensed-SemiBold',
  body: 'Inter',
};

export const radius = { card: 20, field: 14, pill: 999 };

/** Spacing scale: the gaps and paddings used by shared widgets and screens. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export function useTheme(): { dark: boolean; colors: Colors } {
  const mode = usePrefs((s) => s.themeMode);
  const system = useColorScheme();
  const dark = mode === 'system' ? system !== 'light' : mode === 'dark';
  return { dark, colors: dark ? palettes.dark(config.accent) : palettes.light(config.accent) };
}

/** Big athletic numbers (LP, scores, times). */
export const displayText = (size = 40) => ({ fontFamily: fonts.display, fontSize: size, lineHeight: size * 1.05, letterSpacing: -0.5, fontVariant: ['tabular-nums' as const] });
