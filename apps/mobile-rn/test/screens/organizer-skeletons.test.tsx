import { act } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend, regs } from '../organizer-fixtures';
import { setWide } from '../wide-web';

jest.mock('../../src/features/competitions/organizer/web', () => ({
  ...jest.requireActual('../../src/features/competitions/organizer/web'),
  useWideWeb: () => require('../wide-web').useWide(),
}));

const open = (tab: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;

/** The registrations stay on the way until the test lets them through. */
function held() {
  let release!: () => void;
  const b = orgBackend().on('GET', '/competitions/c9/registrations', () => new Promise<[number, unknown]>((r) => (release = () => r([200, regs]))));
  return { b, release: () => release() };
}

describe('organizer lists: skeletons while they load', () => {
  it('phone: participants show a skeleton, then the list', async () => {
    setWide(false);
    const { b, release } = held();
    const screen = await renderScreen(open('participants'), b);
    expect((await screen.findByTestId('skeleton')).props.accessibilityLabel).toBe('Loading');
    expect(StyleSheet.flatten(screen.getAllByTestId('skeleton-row')[0].props.style)).toMatchObject({ height: 76, borderRadius: 18 });
    await act(async () => release());
    expect(await screen.findByTestId('reg-r1')).toBeTruthy();
    expect(screen.queryByTestId('skeleton')).toBeNull();
  });

  it('computer: finances show dense skeleton rows', async () => {
    setWide(true);
    const { b, release } = held();
    const screen = await renderScreen(open('finances'), b);
    await screen.findByTestId('skeleton');
    expect(StyleSheet.flatten(screen.getAllByTestId('skeleton-row')[0].props.style)).toMatchObject({ height: 44, borderRadius: 6 });
    await act(async () => release());
    expect(await screen.findByTestId('fin-table')).toBeTruthy();
  });
});
