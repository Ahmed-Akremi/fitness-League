import { createContext, createElement, useContext, type ReactNode } from 'react';
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

/**
 * The light palette on a computer (lot Web 3): a darker accent with white on it, and darker secondary text, so every
 * text reaches 4.5:1 (WCAG AA) on each light surface — the light side panel included. Phones keep `palettes.light`.
 */
export const denseLight = (accent: string): Colors => ({ ...palettes.light(accent), primary: darken(accent, 0.55), onPrimary: '#FFFFFF', outline: '#62666F' });

export const fonts = {
  display: 'BarlowCondensed-ExtraBold',
  displaySemi: 'BarlowCondensed-SemiBold',
  body: 'Inter',
};

export const radius = { card: 20, field: 14, pill: 999 };

/** Spacing scale: the gaps and paddings used by shared widgets and screens. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

/** Organizer space on a computer (lot Web 2): the dense desktop look of the Circle21 back-office. Phones keep `radius` and the default sizes. */
export const webDense = {
  radius: { card: 10, field: 6 },
  /** Height of buttons, inputs and icon squares. */
  control: 32,
  pad: 16,
  gap: 12,
  sectionTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardTitle: { fontSize: 14, fontWeight: '700' },
  caption: { fontSize: 12 },
  kpi: 36,
} as const;

type Scope = { dense: boolean; scheme: 'light' | 'dark' | null };
const ScopeContext = createContext<Scope>({ dense: false, scheme: null });

/**
 * A part of the screen with its own look (lot Web 2): `dense` for the organizer space on a computer, `scheme` to force
 * a palette (the light side panel on a dark page). Nested scopes add up. Phones never set one.
 */
export function ThemeScope({ dense, scheme, children }: { dense?: boolean; scheme?: 'light' | 'dark'; children: ReactNode }) {
  const outer = useContext(ScopeContext);
  return createElement(ScopeContext.Provider, { value: { dense: dense ?? outer.dense, scheme: scheme ?? outer.scheme } }, children);
}

export function useTheme(): { dark: boolean; colors: Colors; dense: boolean } {
  const mode = usePrefs((s) => s.themeMode);
  const system = useColorScheme();
  const scope = useContext(ScopeContext);
  const dark = scope.scheme ? scope.scheme === 'dark' : mode === 'system' ? system !== 'light' : mode === 'dark';
  return { dark, colors: dark ? palettes.dark(config.accent) : scope.dense ? denseLight(config.accent) : palettes.light(config.accent), dense: scope.dense };
}

/** Big athletic numbers (LP, scores, times). */
export const displayText = (size = 40) => ({ fontFamily: fonts.display, fontSize: size, lineHeight: size * 1.05, letterSpacing: -0.5, fontVariant: ['tabular-nums' as const] });
