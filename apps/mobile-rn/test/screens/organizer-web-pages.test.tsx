import { fireEvent, waitFor, within } from 'expo-router/testing-library';

import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';
import { setWide } from '../wide-web';

jest.mock('../../src/features/competitions/organizer/web', () => ({
  ...jest.requireActual('../../src/features/competitions/organizer/web'),
  useWideWeb: () => require('../wide-web').useWide(),
}));

const open = (tab?: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;
const staff = [{ id: 's1', userId: 'u-me', role: 'ORGANIZER', user: { username: 'ahmed_rx', profile: { fullName: 'Ahmed Ben Salah' } } }];
const backend = () =>
  orgBackend()
    .on('GET', '/competitions/c9/staff', [200, staff])
    .on('GET', '/competitions/c9/coupons', [200, []])
    .on('GET', '/competitions/c9/heats', [200, []])
    .on('GET', '/competitions/c9/announcements', [200, []])
    .on('GET', '/competitions/c9/leaderboard', [200, { status: 'REGISTRATION_OPEN', provisional: true, rows: [] }]);

const PAGES: [ManageTab, string][] = [
  ['dashboard', 'Overview'],
  ['general', 'Event details'],
  ['categories', 'Categories'],
  ['coupons', 'Promo codes'],
  ['team', 'Team'],
  ['wods', 'WODs'],
  ['planning', 'Heats'],
  ['leaderboard', 'Leaderboard'],
  ['announcements', 'Announcements'],
];

describe('organizer pages on a computer: the header row', () => {
  beforeEach(() => setWide(true));

  it('every page starts with its header row, named like its menu entry', async () => {
    const screen = await renderScreen(open(), backend());
    await screen.findByTestId('org-menu');
    for (const [tab, title] of PAGES) {
      await fireEvent.press(screen.getByTestId(`org-menu-${tab}`));
      await waitFor(() => expect(within(screen.getByTestId('org-page-header')).getByText(title)).toBeTruthy());
    }
  });

  it('create buttons and the export sit in the header; the export is a labelled square', async () => {
    const screen = await renderScreen(open('team'), backend());
    const header = await screen.findByTestId('org-page-header');
    expect(within(header).getByTestId('team-add')).toBeTruthy();
    expect(within(header).getByTestId('team-export').props.accessibilityLabel).toBe('Export (CSV)');
    expect(screen.queryByText('Export (CSV)')).toBeNull();
    await fireEvent.press(screen.getByTestId('org-menu-categories'));
    await waitFor(() => expect(within(screen.getByTestId('org-page-header')).getByTestId('cat-new')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('org-menu-planning'));
    await waitFor(() => expect(within(screen.getByTestId('org-page-header')).getByTestId('heat-new')).toBeTruthy());
    expect(within(screen.getByTestId('org-page-header')).getByTestId('heat-auto')).toBeTruthy();
    expect(screen.getAllByTestId('heat-new')).toHaveLength(1);
  });

  it('the phone has no header row and keeps its buttons where they were', async () => {
    setWide(false);
    const screen = await renderScreen(open('team'), backend());
    expect(await screen.findByTestId('team-export')).toBeTruthy();
    expect(screen.queryByTestId('org-page-header')).toBeNull();
    expect(screen.getByText('Export (CSV)')).toBeTruthy();
    expect(screen.getAllByTestId('team-add')).toHaveLength(1);
  });
});
