import { act, fireEvent, waitFor, within } from 'expo-router/testing-library';
import { Share } from 'react-native';

import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';

const open = (tab: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;
const board = {
  status: 'REGISTRATION_OPEN',
  provisional: true,
  rows: [
    { rank: 1, athlete: { id: 'u-r3', fullName: 'Hédi Kéfi', username: 'hedi' }, totalPoints: 180, pending: 0 },
    { rank: 2, athlete: { id: 'u-r6', fullName: 'Karim Mansour', username: 'karim' }, totalPoints: 150, pending: 1 },
  ],
};
const coupons = [{ id: 'p1', code: 'EARLY', type: 'PERCENTAGE', value: 20, categoryId: null, maxUses: 50, usedCount: 12, expiresAt: null, active: true }];

describe('leaderboard: search and export', () => {
  afterEach(() => jest.restoreAllMocks());

  it('the leaderboard search ignores accents and says when nobody matches', async () => {
    const screen = await renderScreen(open('leaderboard'), orgBackend().on('GET', '/competitions/c9/leaderboard', [200, board]));
    await fireEvent.changeText(await screen.findByTestId('board-search'), 'KEFI');
    expect(screen.getByTestId('board-u-r3')).toBeTruthy();
    expect(screen.queryByTestId('board-u-r6')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('board-search'), 'zz');
    expect(screen.getByText('No athlete matches.')).toBeTruthy();
    expect(screen.getByTestId('board-export').props.accessibilityState?.disabled).toBe(true);
  });

  it('the export is named after the category', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const screen = await renderScreen(open('leaderboard'), orgBackend().on('GET', '/competitions/c9/leaderboard', [200, board]));
    await fireEvent.press(await screen.findByTestId('board-cat-k2'));
    await waitFor(() => expect(screen.getByTestId('board-cat-k2').props.accessibilityState?.selected).toBe(true));
    await fireEvent.press(await screen.findByTestId('board-export'));
    expect(share.mock.calls[0][0].title).toBe('event-leaderboard-rx-women.csv');
  });
});

describe('promo codes: optimistic toggle', () => {
  it('the toggle shows at once, and a failure puts it back and says which code', async () => {
    let answer!: (a: [number, unknown]) => void;
    const b = orgBackend()
      .on('GET', '/competitions/c9/coupons', [200, coupons])
      .on('POST', '/competitions/c9/coupons/p1/deactivate', () => new Promise<[number, unknown]>((r) => (answer = r)));
    const screen = await renderScreen(open('coupons'), b);
    await screen.findByTestId('coupon-toggle-p1');
    // Not awaited: the press handler waits for the held request.
    await act(async () => {
      fireEvent.press(screen.getByTestId('coupon-toggle-p1'));
    });
    // Before the server answers (its request is held): already « Activate ».
    await waitFor(() => expect(within(screen.getByTestId('coupon-toggle-p1')).getByText('Activate')).toBeTruthy());
    await act(async () => answer([500, { code: 'INTERNAL' }]));
    expect(await screen.findByText('« EARLY » did not change: try again.')).toBeTruthy();
    expect(within(screen.getByTestId('coupon-toggle-p1')).getByText('Deactivate')).toBeTruthy();
  });

  it('a success says so; a double click toggles once', async () => {
    const b = orgBackend().on('GET', '/competitions/c9/coupons', [200, coupons]).on('POST', '/competitions/c9/coupons/p1/deactivate', [200, {}]);
    const screen = await renderScreen(open('coupons'), b);
    await screen.findByTestId('coupon-toggle-p1');
    await act(async () => {
      fireEvent.press(screen.getByTestId('coupon-toggle-p1'));
      fireEvent.press(screen.getByTestId('coupon-toggle-p1'));
    });
    expect(await screen.findByText('Deactivated.')).toBeTruthy();
    expect(b.calls('POST', '/competitions/c9/coupons/p1/deactivate')).toHaveLength(1);
  });
});
