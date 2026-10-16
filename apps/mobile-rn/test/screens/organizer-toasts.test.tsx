import { fireEvent } from 'expo-router/testing-library';

import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';

const open = (tab: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;
// No category: any confirmed registration can take lane 1 (r2).
const heat = { id: 'h1', number: 1, name: 'Heat 1', startsAt: '2026-12-12T10:00:00.000Z', durationMin: 12, laneCount: 2, workout: null, category: null, lanes: [{ lane: 2, registrationId: 'r3', athlete: { id: 'u-r3', fullName: 'Hédi Kéfi', username: 'hedi' } }] };

describe('organizer space: a toast after every action', () => {
  it('categories: deactivate one, then change the order', async () => {
    const b = orgBackend().on('PUT', '/competitions/c9/categories/k1', [200, {}]).on('PUT', '/competitions/c9/categories/k2', [200, {}]);
    const screen = await renderScreen(open('categories'), b);
    await fireEvent.press(await screen.findByTestId('cat-k1'));
    await fireEvent.press(screen.getByTestId('cat-toggle'));
    expect(await screen.findByText('Deactivated.')).toBeTruthy();
    await fireEvent.press(await screen.findByLabelText('Move up'));
    expect(await screen.findByText('Order updated.')).toBeTruthy();
  });

  it('WODs: delete one', async () => {
    const b = orgBackend().on('DELETE', '/competitions/c9/wods/w1', [200, {}]);
    const screen = await renderScreen(open('wods'), b);
    await fireEvent.press(await screen.findByTestId('wod-w1'));
    await fireEvent.press(screen.getByTestId('wod-delete'));
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(await screen.findByText('Deleted.')).toBeTruthy();
  });

  it('heats: free a lane, then fill one', async () => {
    const b = orgBackend().on('GET', '/competitions/c9/heats', [200, [heat]]).on('DELETE', '/competitions/c9/heats/h1/lanes/2', [200, {}]).on('POST', '/competitions/c9/heats/h1/lanes', [200, {}]);
    const screen = await renderScreen(open('planning'), b);
    await fireEvent.press(await screen.findByTestId('heat-h1'));
    await fireEvent.press(await screen.findByLabelText('Free the lane'));
    expect(await screen.findByText('Lane 2 freed.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('lane-1'));
    await fireEvent.press(await screen.findByTestId('lane-cand-r2'));
    expect(await screen.findByText('Lane 1 assigned.')).toBeTruthy();
  });

  it('team: remove a co-organizer', async () => {
    const staff = [
      { id: 's1', userId: 'u-me', role: 'ORGANIZER', user: { username: 'ahmed_rx' } },
      { id: 's2', userId: 'u-2', role: 'ORGANIZER', user: { username: 'amel', profile: { fullName: 'Amel' } } },
    ];
    const b = orgBackend().on('GET', '/competitions/c9/staff', [200, staff]).on('DELETE', '/competitions/c9/staff/s2', [200, {}]);
    const screen = await renderScreen(open('team'), b);
    await fireEvent.press(await screen.findByLabelText('Remove from the organizers'));
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(await screen.findByText('Amel left the team.')).toBeTruthy();
  });

  it('event details: the banner removed, then the next status', async () => {
    const b = orgBackend().on('DELETE', '/competitions/c9/cover', [200, {}]).on('PATCH', '/competitions/c9/status', [200, {}]);
    const screen = await renderScreen(open('general'), b);
    await fireEvent.press(await screen.findByTestId('org-banner-remove'));
    expect(await screen.findByText('Banner removed.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('org-next-REGISTRATION_CLOSED'));
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(await screen.findByText(/^Status updated: .+\.$/)).toBeTruthy();
  });

  it('a failed save shows the error, not a toast', async () => {
    const b = orgBackend().on('PUT', '/competitions/c9/categories/k1', [500, { code: 'INTERNAL' }]);
    const screen = await renderScreen(open('categories'), b);
    await fireEvent.press(await screen.findByTestId('cat-k1'));
    await fireEvent.press(screen.getByTestId('cat-toggle'));
    expect(await screen.findByText('Something went wrong on our side. Try again later.')).toBeTruthy();
    expect(screen.queryByText('Deactivated.')).toBeNull();
  });
});
