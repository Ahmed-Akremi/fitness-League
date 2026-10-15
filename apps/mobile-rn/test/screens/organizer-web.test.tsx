import { router } from 'expo-router';
import { act, fireEvent, waitFor } from 'expo-router/testing-library';
import { Share } from 'react-native';

import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';

// The computer layout is chosen by useWideWeb(); the tests pick the answer.
let mockWide = true;
jest.mock('../../src/features/competitions/organizer/web', () => ({
  ...jest.requireActual('../../src/features/competitions/organizer/web'),
  useWideWeb: () => mockWide,
}));

const open = (tab?: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;
const incomplete = { ...event, status: 'DRAFT', coverUrl: null, workouts: [] };

describe('organizer space on a computer', () => {
  beforeEach(() => {
    mockWide = true;
  });
  afterEach(() => jest.restoreAllMocks());

  it('shows the grouped menu and the top bar instead of the tabs', async () => {
    const screen = await renderScreen(open(), orgBackend());
    expect(await screen.findByTestId('org-menu')).toBeTruthy();
    expect(screen.queryByTestId('org-tab-dashboard')).toBeNull();
    expect(screen.getByTestId('org-top-title')).toBeTruthy();
    expect(screen.getByText('Event details')).toBeTruthy();
    expect(screen.getByText('Heats')).toBeTruthy();
    expect(screen.getByTestId('org-menu-dashboard').props.accessibilityState?.selected).toBe(true);
  });

  it('each menu entry opens its page', async () => {
    const screen = await renderScreen(open(), orgBackend().on('GET', '/competitions/c9/heats', [200, []]));
    await fireEvent.press(await screen.findByTestId('org-menu-participants'));
    expect(await screen.findByTestId('reg-search')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('org-menu-planning'));
    expect(await screen.findByTestId('heat-new')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('org-menu-general'));
    expect(await screen.findByTestId('org-title')).toBeTruthy();
    expect(screen.getByTestId('org-menu-general').props.accessibilityState?.selected).toBe(true);
  });

  it('marks what the draft misses and the payments to collect; « Go to… » opens the right page', async () => {
    const screen = await renderScreen(open(), orgBackend(incomplete));
    expect(await screen.findByTestId('org-mark-wods')).toBeTruthy();
    expect(screen.getByTestId('org-mark-general')).toBeTruthy();
    expect(screen.queryByTestId('org-mark-categories')).toBeNull();
    // r1 and r4 wait for payment (r5 is cancelled).
    expect(await screen.findByTestId('org-mark-participants')).toBeTruthy();
    expect(screen.getByTestId('org-mark-participants').props.children).toBe('2');
    await fireEvent.press(screen.getByTestId('check-WOD'));
    expect(await screen.findByTestId('wod-new')).toBeTruthy();
    expect(screen.getByTestId('org-menu-wods').props.accessibilityState?.selected).toBe(true);
  });

  it('top bar: « Preview » opens the public page; a complete draft asks for publication once', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    const backend = orgBackend({ ...event, status: 'DRAFT' }).on('POST', '/competitions/c9/publication-request', [200, {}]);
    const screen = await renderScreen(open(), backend);
    await fireEvent.press(await screen.findByTestId('org-top-preview'));
    expect(push).toHaveBeenCalledWith('/competitions/c9');
    await act(async () => {
      fireEvent.press(screen.getByTestId('org-top-request'));
      fireEvent.press(screen.getByTestId('org-top-request'));
    });
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/publication-request')).toHaveLength(1));
  });

  it('top bar: an incomplete draft cannot ask for publication yet', async () => {
    const screen = await renderScreen(open(), orgBackend(incomplete));
    expect((await screen.findByTestId('org-top-request')).props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByText('Draft')).toBeTruthy();
  });

  it('top bar: a published event is shared with its app link', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const screen = await renderScreen(open(), orgBackend());
    await fireEvent.press(await screen.findByTestId('org-top-share'));
    expect(share.mock.calls[0][0].message).toMatch(/fitnessleague:\/\/competitions\/c9$/);
  });

  it('a narrow window keeps the page that was open', async () => {
    const screen = await renderScreen(open(), orgBackend().on('GET', '/competitions/c9/staff', [200, []]));
    await fireEvent.press(await screen.findByTestId('org-menu-participants'));
    expect(await screen.findByTestId('reg-search')).toBeTruthy();
    mockWide = false;
    // The next render of the organizer screen reads the window again: the team entry is still the menu's.
    await fireEvent.press(screen.getByTestId('org-menu-team'));
    expect(await screen.findByTestId('org-tab-team')).toBeTruthy();
    expect(screen.queryByTestId('org-menu')).toBeNull();
    expect(screen.getByTestId('org-tab-team').props.accessibilityState?.selected).toBe(true);
  });

  it('no menu for someone who is not an organizer', async () => {
    const screen = await renderScreen(open(), orgBackend({ ...event, myRoles: [] }));
    expect(await screen.findByText('Only the organizers of this event can open this page.')).toBeTruthy();
    expect(screen.queryByTestId('org-menu')).toBeNull();
  });
});
