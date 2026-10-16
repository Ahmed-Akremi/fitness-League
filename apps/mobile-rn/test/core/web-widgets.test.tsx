import { fireEvent } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import { axisStep, BarChart, Ring, ringArcs } from '../../src/core/widgets/chart';
import { Txt } from '../../src/core/widgets/kit';
import { gridColumns, KpiCard, PageHeader, SearchField, SectionCard, SegmentedInline, SquareButton } from '../../src/core/widgets/web';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

describe('computer page pieces: rules', () => {
  it('grid: 4 / 2 / 1 KPI columns, 3 / 1 for card rows', () => {
    expect(gridColumns(1168, 180, [4, 2, 1])).toBe(4);
    expect(gridColumns(772, 180, [4, 2, 1])).toBe(4);
    expect(gridColumns(700, 180, [4, 2, 1])).toBe(2);
    expect(gridColumns(300, 180, [4, 2, 1])).toBe(1);
    expect(gridColumns(772, 240, [3, 1])).toBe(3);
    expect(gridColumns(600, 240, [3, 1])).toBe(1);
  });

  it('ring arcs follow each other around the circle; an empty ring has none', () => {
    expect(ringArcs([1, 1, 2], 100)).toEqual([{ length: 25, offset: 0 }, { length: 25, offset: 25 }, { length: 50, offset: 50 }]);
    expect(ringArcs([0, 0], 100)).toEqual([{ length: 0, offset: 0 }, { length: 0, offset: 0 }]);
  });

  it('the day axis writes one label in n when there are many days', () => {
    expect(axisStep(5)).toBe(1);
    expect(axisStep(8)).toBe(1);
    expect(axisStep(9)).toBe(2);
    expect(axisStep(40)).toBe(5);
  });
});

describe('computer page pieces: render', () => {
  it('page header: an uppercase 13 px title and the actions', async () => {
    const onPress = jest.fn();
    const screen = await renderScreen(() => <PageHeader testID="ph" title="Participants" actions={<SquareButton testID="x" icon="file-download" label="Export (CSV)" onPress={onPress} />} />, new FakeBackend());
    expect(flat(screen.getByText('Participants'))).toMatchObject({ fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 });
    expect(screen.getByTestId('x').props.accessibilityLabel).toBe('Export (CSV)');
    expect(flat(screen.getByTestId('x'))).toMatchObject({ width: 32, height: 32, borderRadius: 6 });
    fireEvent.press(screen.getByTestId('x'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('a disabled square button says so and does nothing', async () => {
    const onPress = jest.fn();
    const screen = await renderScreen(() => <SquareButton testID="x" icon="file-download" label="Export (CSV)" disabled onPress={onPress} />, new FakeBackend());
    expect(screen.getByTestId('x').props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(screen.getByTestId('x'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('KPI card: title, caption, the number, a footnote', async () => {
    const screen = await renderScreen(() => <KpiCard testID="k" title="Collected" caption="Marked paid" value="35 TND" footnote="Manual payment, no online fees" />, new FakeBackend());
    expect(screen.getByTestId('k-value').props.children).toBe('35 TND');
    expect(flat(screen.getByTestId('k-value'))).toMatchObject({ fontSize: 36 });
    expect(screen.getByText('Marked paid')).toBeTruthy();
    expect(screen.getByText('Manual payment, no online fees')).toBeTruthy();
  });

  it('a long figure wraps instead of being cut (« 12 345,5 TND » needs 183 px in a 152 px card at a 1024 px window)', async () => {
    const screen = await renderScreen(() => <KpiCard testID="k" title="Revenue" value="12 345,5 TND" />, new FakeBackend());
    expect(screen.getByTestId('k-value').props.numberOfLines).toBeUndefined();
  });

  it('section card: « no data » in the middle instead of its content', async () => {
    const screen = await renderScreen(
      () => (
        <SectionCard testID="s" title="Gender" empty="No data yet">
          <Txt>hidden</Txt>
        </SectionCard>
      ),
      new FakeBackend(),
    );
    expect(screen.getByTestId('s-empty').props.children).toBe('No data yet');
    expect(screen.queryByText('hidden')).toBeNull();
  });

  it('inline switch: the chosen option is marked, a press reports the other one', async () => {
    const onChange = jest.fn();
    const screen = await renderScreen(
      () => <SegmentedInline testID="as" label="Show as:" value="percent" options={[{ key: 'percent', label: 'Percentages (%)' }, { key: 'numbers', label: 'Numbers' }]} onChange={onChange} />,
      new FakeBackend(),
    );
    expect(screen.getByTestId('as-percent').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('as-numbers').props.accessibilityState).toMatchObject({ checked: false });
    fireEvent.press(screen.getByTestId('as-numbers'));
    expect(onChange).toHaveBeenCalledWith('numbers');
  });

  it('search field: a filled 32 px box that reports what is typed', async () => {
    const onChangeText = jest.fn();
    const screen = await renderScreen(() => <SearchField testID="q" placeholder="Search a name" value="" onChangeText={onChangeText} />, new FakeBackend());
    fireEvent.changeText(screen.getByTestId('q'), 'kefi');
    expect(onChangeText).toHaveBeenCalledWith('kefi');
    expect(screen.getByTestId('q').props.accessibilityLabel).toBe('Search a name');
  });

  it('the ring says what it shows; each bar carries its value', async () => {
    const screen = await renderScreen(
      () => (
        <>
          <Ring testID="r" label="1 of 4 heats done" parts={[{ value: 1, color: '#FFFFFF' }, { value: 3, color: 'transparent' }]}>
            <Txt>25%</Txt>
          </Ring>
          <BarChart label="Registrations per day" data={[{ key: 'd1', label: '19 Oct', value: 1 }, { key: 'd2', label: '20 Oct', value: 3 }]} />
        </>
      ),
      new FakeBackend(),
    );
    expect(screen.getByTestId('r').props.accessibilityLabel).toBe('1 of 4 heats done');
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getByTestId('bar-d2').props.accessibilityLabel).toBe('20 Oct: 3');
    expect(flat(screen.getByTestId('bar-d2'))).toMatchObject({ height: '100%' });
    expect(screen.getByText('19 Oct')).toBeTruthy();
  });
});
