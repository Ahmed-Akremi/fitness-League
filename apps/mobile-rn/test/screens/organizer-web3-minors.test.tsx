import { act, fireEvent } from 'expo-router/testing-library';

import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';
import { setWide } from '../wide-web';

jest.mock('../../src/features/competitions/organizer/web', () => ({
  ...jest.requireActual('../../src/features/competitions/organizer/web'),
  useWideWeb: () => require('../wide-web').useWide(),
}));

const open = (tab: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;

describe('lot Web 2 review minors', () => {
  beforeEach(() => setWide(true));

  it('while a batch runs, a single « Mark paid » is not offered, and the batch waits for a single payment', async () => {
    let answer!: (a: [number, unknown]) => void;
    const b = orgBackend()
      .on('GET', '/competitions/c9/heats', [200, []])
      .on('POST', '/competitions/c9/registrations/r4/mark-paid', () => new Promise<[number, unknown]>((r) => (answer = r)))
      .on('POST', '/competitions/c9/registrations/r1/mark-paid', [200, {}]);
    const screen = await renderScreen(open('participants'), b);
    await fireEvent.press(await screen.findByTestId('tab-collect'));
    await fireEvent.press(screen.getByTestId('reg-table-check-r4'));
    await fireEvent.press(screen.getByTestId('reg-batch'));
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    // r4 is on its way: r1 cannot be paid on its own meanwhile.
    await fireEvent.press(screen.getByTestId('reg-r1'));
    expect((await screen.findByTestId('reg-panel-pay')).props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('reg-panel-dismiss'));
    await fireEvent.press(screen.getByTestId('reg-table-menu-r1'));
    expect(screen.queryByTestId('reg-paid-r1')).toBeNull();
    await act(async () => answer([200, {}]));
  });

  it('a search that hides every payment says so', async () => {
    const screen = await renderScreen(open('finances'), orgBackend());
    await fireEvent.changeText(await screen.findByTestId('fin-search'), 'zzz');
    expect(screen.getByText('No payment matches.')).toBeTruthy();
  });

  it('the Judges card says when the team cannot be read', async () => {
    const screen = await renderScreen(open('dashboard'), orgBackend().on('GET', '/competitions/c9/staff', [500, { code: 'INTERNAL' }]));
    expect(await screen.findByText('Not available right now')).toBeTruthy();
    expect(screen.getByTestId('ov-kpi-judges-value').props.children).toBe('—');
  });
});
