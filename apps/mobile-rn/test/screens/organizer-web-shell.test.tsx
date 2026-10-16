import { router } from 'expo-router';
import { fireEvent, within } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import * as exportModule from '../../src/features/competitions/organizer/export';
import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';
import { setWide } from '../wide-web';

jest.mock('../../src/features/competitions/organizer/web', () => ({
  ...jest.requireActual('../../src/features/competitions/organizer/web'),
  useWideWeb: () => require('../wide-web').useWide(),
}));

const open = (tab?: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

describe('computer top bar and menu (Circle21 look)', () => {
  beforeEach(() => setWide(true));
  afterEach(() => jest.restoreAllMocks());

  it('one compact row: back, title with a lock while unpublished, « format · status », registration dates', async () => {
    const navigate = jest.spyOn(router, 'navigate').mockImplementation(() => {});
    const screen = await renderScreen(open(), orgBackend({ ...event, status: 'DRAFT' }));
    expect(await screen.findByTestId('org-top-title')).toBeTruthy();
    expect(screen.getByLabelText('Not published yet')).toBeTruthy();
    expect(screen.getByText(/^On site · Draft$/)).toBeTruthy();
    expect(screen.getByTestId('org-top-status').props.children).toBe('Draft');
    expect(screen.getByTestId('org-top-dates')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('org-top-back'));
    expect(navigate).toHaveBeenCalledWith('/competitions/c9');
  });

  it('the cover as a 32 px round thumbnail; no lock once published', async () => {
    const screen = await renderScreen(open(), orgBackend());
    expect(await screen.findByTestId('org-top-title')).toBeTruthy();
    expect(screen.queryByLabelText('Not published yet')).toBeNull();
    expect(flat(screen.getByLabelText('Sousse Summer Throwdown'))).toMatchObject({ width: 32, height: 32, borderRadius: 16 });
  });

  it('« ⋯ » holds the rarer actions: the checklist, the event details, the participants export', async () => {
    const download = jest.spyOn(exportModule, 'exportCsv').mockImplementation(() => {});
    const screen = await renderScreen(open('team'), orgBackend().on('GET', '/competitions/c9/staff', [200, []]));
    expect(await screen.findByTestId('org-mark-participants')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('org-top-more'));
    await fireEvent.press(screen.getByTestId('org-more-checklist'));
    expect(await screen.findByTestId('org-state')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('org-top-more'));
    await fireEvent.press(screen.getByTestId('org-more-edit'));
    expect(await screen.findByTestId('org-title')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('org-top-more'));
    await fireEvent.press(screen.getByTestId('org-more-export'));
    expect(download.mock.calls[0][0]).toBe('event-participants.csv');
    expect(download.mock.calls[0][1].split('\n')).toHaveLength(6);
  });

  it('menu: 220 px wide, 36 px entries with an icon, an accent bar on the page open', async () => {
    const screen = await renderScreen(open(), orgBackend().on('GET', '/competitions/c9/staff', [200, []]));
    expect(flat(await screen.findByTestId('org-menu'))).toMatchObject({ width: 220 });
    // Scoped to the menu: from Task 6 on, the page header says « Overview » too.
    expect(within(screen.getByTestId('org-menu')).getByText('Overview')).toBeTruthy();
    expect(within(screen.getByTestId('org-menu-dashboard')).getByTestId('org-menu-active')).toBeTruthy();
    expect(screen.getAllByTestId('org-menu-active')).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('org-menu-team'));
    expect(within(screen.getByTestId('org-menu-team')).getByTestId('org-menu-active')).toBeTruthy();
    expect(flat(screen.getByTestId('org-menu-team'))).toMatchObject({ height: 36, borderRadius: 6 });
  });

  it('the dense look reaches the page; the phone keeps its tabs and its cards', async () => {
    const wide = await renderScreen(open(), orgBackend());
    expect(flat(await wide.findByTestId('org-state'))).toMatchObject({ borderRadius: 10 });
    wide.unmount();
    setWide(false);
    const phone = await renderScreen(open(), orgBackend());
    expect(await phone.findByTestId('org-tab-dashboard')).toBeTruthy();
    expect(flat(phone.getByTestId('org-state'))).toMatchObject({ borderRadius: 20 });
  });
});
