import { act, fireEvent, within } from 'expo-router/testing-library';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { useTheme } from '../../src/core/theme';
import { Txt } from '../../src/core/widgets/kit';
import { SidePanel } from '../../src/core/widgets/panel';
import { DataTable, type Column } from '../../src/core/widgets/table';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

type Row = { id: string; name: string };
const rows: Row[] = [
  { id: 'a', name: 'Amira' },
  { id: 'b', name: 'Hédi' },
];
const columns: Column<Row>[] = [
  { key: 'n', label: '#', width: 32, render: (_, i) => String(i + 1) },
  { key: 'name', label: 'Name', flex: 2, render: (r) => r.name },
];

describe('table', () => {
  it('a header strip, one row each, a press opens the row', async () => {
    const onRowPress = jest.fn();
    const screen = await renderScreen(() => <DataTable testID="t" rows={rows} keyOf={(r) => r.id} nameOf={(r) => r.name} columns={columns} onRowPress={onRowPress} />, new FakeBackend());
    expect(within(screen.getByTestId('t-head')).getByText('Name')).toBeTruthy();
    expect(within(screen.getByTestId('t-row-b')).getByText('2')).toBeTruthy();
    fireEvent.press(screen.getByTestId('t-row-b'));
    expect(onRowPress).toHaveBeenCalledWith(rows[1]);
    expect(StyleSheet.flatten(screen.getByTestId('t-row-a').props.style)).toMatchObject({ minHeight: 44 });
  });

  it('checkboxes: one row, then all; the header box is « mixed » in between', async () => {
    function Host() {
      const [sel, setSel] = useState<ReadonlySet<string>>(new Set());
      const toggle = (k: string) =>
        setSel((s) => {
          const n = new Set(s);
          if (n.has(k)) n.delete(k);
          else n.add(k);
          return n;
        });
      return (
        <DataTable
          testID="t"
          rows={rows}
          keyOf={(r) => r.id}
          nameOf={(r) => r.name}
          columns={columns}
          selection={{ selected: sel, onToggle: toggle, onToggleAll: () => setSel((s) => (s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))), label: (n) => `Select ${n}`, allLabel: 'Select all' }}
        />
      );
    }
    const screen = await renderScreen(() => <Host />, new FakeBackend());
    await fireEvent.press(screen.getByTestId('t-check-a'));
    expect(screen.getByTestId('t-check-a').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('t-check-all').props.accessibilityState).toMatchObject({ checked: 'mixed' });
    expect(screen.getByLabelText('Select Hédi')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('t-check-all'));
    expect(screen.getByTestId('t-check-b').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('t-check-all').props.accessibilityState).toMatchObject({ checked: true });
  });

  it('the row menu lists the row actions and is named after the row', async () => {
    const pay = jest.fn();
    const screen = await renderScreen(
      () => <DataTable testID="t" rows={rows} keyOf={(r) => r.id} nameOf={(r) => r.name} columns={columns} menuLabel={(n) => `Actions for ${n}`} rowActions={(r) => [{ label: 'Mark paid', testID: `pay-${r.id}`, onPress: pay }]} />,
      new FakeBackend(),
    );
    expect(screen.getByTestId('t-menu-b').props.accessibilityLabel).toBe('Actions for Hédi');
    await fireEvent.press(screen.getByTestId('t-menu-a'));
    await fireEvent.press(screen.getByTestId('pay-a'));
    expect(pay).toHaveBeenCalledTimes(1);
  });

  it('an empty list shows the header strip and the empty element', async () => {
    const screen = await renderScreen(() => <DataTable testID="t" rows={[] as Row[]} keyOf={(r) => r.id} nameOf={(r) => r.name} columns={columns} empty={<Txt>No payment</Txt>} />, new FakeBackend());
    expect(screen.getByTestId('t-head')).toBeTruthy();
    expect(screen.getByText('No payment')).toBeTruthy();
  });
});

describe('side panel', () => {
  function Probe() {
    const { colors } = useTheme();
    return <Txt testID="bg">{colors.background}</Txt>;
  }

  it('light even on a dark page, 420 px at the end of the window, its footer under the content', async () => {
    const screen = await renderScreen(
      () => (
        <SidePanel visible title="Sami Ben Ali" closeLabel="Close" onClose={() => {}} footer={<Txt>footer</Txt>}>
          <Probe />
        </SidePanel>
      ),
      new FakeBackend(),
    );
    expect(screen.getByTestId('bg').props.children).toBe('#FFFFFF');
    expect(screen.getByText('Sami Ben Ali')).toBeTruthy();
    expect(screen.getByText('footer')).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByTestId('side-panel').props.style)).toMatchObject({ width: 420, right: 0, top: 0, bottom: 0 });
  });

  it('closes with its X, a click on the backdrop, or Esc', async () => {
    const onClose = jest.fn();
    const screen = await renderScreen(
      () => (
        <SidePanel visible title="Sami Ben Ali" closeLabel="Close" onClose={onClose}>
          <Txt>body</Txt>
        </SidePanel>
      ),
      new FakeBackend(),
    );
    expect(screen.getByTestId('side-panel-close').props.accessibilityLabel).toBe('Close');
    await fireEvent.press(screen.getByTestId('side-panel-close'));
    // The backdrop is for the mouse: screen readers stay in the drawer (accessibilityViewIsModal), so it is hidden from them.
    await fireEvent.press(screen.getByTestId('side-panel-backdrop', { includeHiddenElements: true }));
    // Esc: react-native-web's Modal calls onRequestClose.
    await act(async () => screen.getByTestId('side-panel-modal').props.onRequestClose());
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('shows nothing while closed', async () => {
    const screen = await renderScreen(
      () => (
        <SidePanel visible={false} title="Sami Ben Ali" closeLabel="Close" onClose={() => {}}>
          <Txt>body</Txt>
        </SidePanel>
      ),
      new FakeBackend(),
    );
    expect(screen.queryByText('body')).toBeNull();
  });
});
