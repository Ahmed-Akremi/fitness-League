import { act } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import { isFocused, setKeyboardModality, useFocusRing } from '../../src/core/focus';
import { denseLight, palettes, ThemeScope, useTheme } from '../../src/core/theme';
import { BarChart } from '../../src/core/widgets/chart';
import { LinkButton, Txt } from '../../src/core/widgets/kit';
import { SidePanel } from '../../src/core/widgets/panel';
import { DataTable } from '../../src/core/widgets/table';
import { SegmentedInline } from '../../src/core/widgets/web';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

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
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
const ACCENT = '#C6F432';

describe('contrast on a computer (WCAG AA, 4.5:1)', () => {
  for (const [name, p] of [
    ['dark', palettes.dark(ACCENT)],
    ['light on a computer', denseLight(ACCENT)],
  ] as const) {
    it(`${name}: every text on every surface`, () => {
      for (const bg of [p.background, p.surface, p.surfaceHigh]) {
        expect(ratio(p.text, bg)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(p.outline, bg)).toBeGreaterThanOrEqual(4.5);
      }
      for (const bg of [p.background, p.surface]) {
        expect(ratio(p.primary, bg)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(p.error, bg)).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio(p.onPrimary, p.primary)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('the computer’s light palette is the one the light side panel uses; the phone keeps its own', async () => {
    function Probe() {
      const { colors } = useTheme();
      return <Txt testID="primary">{colors.primary}</Txt>;
    }
    const screen = await renderScreen(
      () => (
        <>
          <ThemeScope scheme="light">
            <Probe />
          </ThemeScope>
          <ThemeScope dense scheme="light">
            <Probe />
          </ThemeScope>
        </>
      ),
      new FakeBackend(),
    );
    const [phone, computer] = screen.getAllByTestId('primary').map((n) => n.props.children);
    expect(phone).toBe(palettes.light(ACCENT).primary);
    expect(computer).toBe('#596e16');
  });
});

describe('keyboard focus on a computer', () => {
  afterEach(() => setKeyboardModality(false));

  it('the ring shows only on a computer, only after a key press, only on the focused control', async () => {
    function Probe({ focused }: { focused: boolean }) {
      const ring = useFocusRing();
      return <Txt testID="ring">{JSON.stringify(ring(focused))}</Txt>;
    }
    setKeyboardModality(true);
    const screen = await renderScreen(
      () => (
        <>
          <Probe focused />
          <ThemeScope dense>
            <Probe focused />
            <Probe focused={false} />
          </ThemeScope>
        </>
      ),
      new FakeBackend(),
    );
    const read = () => screen.getAllByTestId('ring').map((n) => n.props.children);
    expect(read()[0]).toBe('null');
    expect(JSON.parse(read()[1])).toMatchObject({ outlineStyle: 'solid', outlineWidth: 2, outlineOffset: 2 });
    expect(read()[2]).toBe('null');
    await act(async () => setKeyboardModality(false));
    expect(read()[1]).toBe('null');
    expect(isFocused({ focused: true })).toBe(true);
    expect(isFocused({ pressed: true })).toBe(false);
  });

  it('targets are at least 24 px tall on a computer', async () => {
    const screen = await renderScreen(
      () => (
        <ThemeScope dense>
          <LinkButton testID="link" label="See all" onPress={() => {}} />
          <SegmentedInline testID="as" label="Show as:" value="a" options={[{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]} onChange={() => {}} />
          <DataTable testID="t" rows={[{ id: 'x' }]} keyOf={(r) => r.id} nameOf={() => 'X'} columns={[{ key: 'n', label: 'N', render: () => 'x' }]} selection={{ selected: new Set(), onToggle: () => {}, onToggleAll: () => {}, label: (n) => n, allLabel: 'All' }} />
        </ThemeScope>
      ),
      new FakeBackend(),
    );
    expect(flat(screen.getByTestId('link'))).toMatchObject({ minHeight: 24 });
    expect(flat(screen.getByTestId('as-b'))).toMatchObject({ minHeight: 24 });
    expect(flat(screen.getByTestId('t-check-x'))).toMatchObject({ height: 24 });
  });
});

describe('names for screen readers', () => {
  it('the inline switch is a radio group; the panel is a dialog named after its title; the chart reads its values', async () => {
    const screen = await renderScreen(
      () => (
        <>
          <SegmentedInline testID="as" label="Show as:" value="a" options={[{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]} onChange={() => {}} />
          <BarChart label="Registrations per day" data={[{ key: 'd1', label: '19 Oct', value: 1 }, { key: 'd2', label: '20 Oct', value: 3 }]} />
          <SidePanel visible title="Sami Ben Ali" closeLabel="Close" onClose={() => {}}>
            <Txt>body</Txt>
          </SidePanel>
        </>
      ),
      new FakeBackend(),
    );
    expect(screen.getByTestId('as').props.accessibilityRole).toBe('radiogroup');
    expect(screen.getByTestId('as-a').props.accessibilityRole).toBe('radio');
    expect(screen.getByTestId('as-a').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByLabelText('Registrations per day: 19 Oct 1, 20 Oct 3')).toBeTruthy();
    expect(screen.getByTestId('side-panel').props.role).toBe('dialog');
    expect(screen.getByTestId('side-panel').props.accessibilityLabel).toBe('Sami Ben Ali');
  });
});
