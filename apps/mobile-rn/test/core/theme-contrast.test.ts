import { config } from '../../src/core/config';
import { denseLight, palettes, type Colors } from '../../src/core/theme';
import { divisionColor } from '../../src/core/widgets/common';

const fs = jest.requireActual<typeof import('fs')>('fs');
const path = jest.requireActual<typeof import('path')>('path');

const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [16, 8, 0].map((s) => channel(((n >> s) & 255) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio of two #RRGGBB colours. */
const ratio = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

describe('contrast on a phone (WCAG, both appearances)', () => {
  for (const [name, p] of [
    ['dark', palettes.dark(config.accent)],
    ['light', palettes.light(config.accent)],
  ] as [string, Colors][]) {
    it(`${name}: text, secondary text, accent and errors reach 4.5:1`, () => {
      for (const bg of [p.background, p.surface, p.surfaceHigh]) expect(ratio(p.text, bg)).toBeGreaterThanOrEqual(4.5);
      for (const bg of [p.surface, p.surfaceHigh]) expect(ratio(p.outline, bg)).toBeGreaterThanOrEqual(4.5);
      for (const bg of [p.background, p.surface]) expect(ratio(p.primary, bg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(p.onPrimary, p.primary)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(p.error, p.surface)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: tier, rarity and status colours reach 3:1 (bold text and icons)`, () => {
      const bold = { ...p.tier, ...p.rarity, warning: p.warning, heart: p.heart, flame: p.flame };
      expect(Object.keys(bold)).toHaveLength(12);
      // The name rides along so a failure says which colour.
      for (const [k, c] of Object.entries(bold)) expect([k, ratio(c, p.surface) >= 3]).toEqual([k, true]);
      expect(ratio('#FFFFFF', p.badge)).toBeGreaterThanOrEqual(3);
    });

    it(`${name}: every colour stays a 6-digit hex (the code appends alpha suffixes)`, () => {
      const all = Object.values(p).flatMap((v) => (typeof v === 'string' ? [v] : Object.values(v as Record<string, string>)));
      for (const c of all.filter((c) => c !== p.border)) expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  }

  it('the computer’s light palette is the phone’s, so the computer layout does not change', () => {
    const light = palettes.light(config.accent);
    expect(denseLight(config.accent)).toEqual(light);
    expect([light.primary.toLowerCase(), light.onPrimary, light.outline]).toEqual(['#596e16', '#FFFFFF', '#62666F']);
  });

  it('division colours follow the appearance', () => {
    const dark = palettes.dark(config.accent);
    const light = palettes.light(config.accent);
    expect(divisionColor('GOLD', dark)).toBe('#FFD166');
    expect(divisionColor('GOLD', light)).toBe(light.tier.GOLD);
    expect(divisionColor(null, light)).toBe(light.tier.BRONZE);
    expect(divisionColor('UNKNOWN', dark)).toBe(dark.tier.BRONZE);
  });
});

describe('no colour hard-coded in the screens', () => {
  const read = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const p = path.join(dir, d.name);
      return d.isDirectory() ? read(p) : /\.tsx?$/.test(d.name) ? [p] : [];
    });
  const HEX = /['"]#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?['"]/;

  it('src/features uses theme tokens only', () => {
    const found = read(path.join(__dirname, '../../src/features')).flatMap((f) =>
      fs
        .readFileSync(f, 'utf8')
        .split('\n')
        .filter((l) => HEX.test(l))
        .map((l) => `${path.basename(f)}: ${l.trim()}`),
    );
    expect(found).toEqual([]);
  });

  it('the shared widgets keep only the fixed gym tiles (dark initials on a bright tile work in both modes)', () => {
    const common = fs.readFileSync(path.join(__dirname, '../../src/core/widgets/common.tsx'), 'utf8');
    expect(common.split('\n').filter((l) => HEX.test(l) && !/GYM_PALETTE =|color: '#0E0F12'/.test(l))).toEqual([]);
  });
});
