import { Share } from 'react-native';
import { fireEvent } from 'expo-router/testing-library';

import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';

const open = (tab: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;
const heats = [{ id: 'h1', number: 1, name: 'RX Men · Heat 1', startsAt: '2026-12-12T10:00:00.000Z', durationMin: 12, laneCount: 2, workout: { id: 'w1', name: 'WOD 1', number: 1 }, category: { id: 'k1', name: 'RX Men' }, lanes: [] }];
const coupons = [{ id: 'p1', code: 'EARLY', type: 'PERCENTAGE', value: 20, categoryId: null, maxUses: 50, usedCount: 12, expiresAt: null, active: true }];
const staff = [{ id: 's1', userId: 'u-me', role: 'ORGANIZER', user: { username: 'ahmed_rx', profile: { fullName: 'Ahmed Ben Salah' } } }];
const board = (rows: object[]) => ({ status: 'REGISTRATION_OPEN', provisional: true, rows });

describe('organizer space: one export everywhere', () => {
  let share: jest.SpyInstance;
  beforeEach(() => {
    share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  });
  afterEach(() => jest.restoreAllMocks());

  const sent = () => ({ title: share.mock.calls[0][0].title as string, head: (share.mock.calls[0][0].message as string).split('\n')[0] });

  it('participants', async () => {
    const screen = await renderScreen(open('participants'), orgBackend());
    await fireEvent.press(await screen.findByTestId('reg-csv'));
    expect(sent()).toEqual({ title: 'event-participants.csv', head: 'name,username,category,registration,payment,amount,currency,registered_at' });
  });

  it('heats, as a lane sheet', async () => {
    const screen = await renderScreen(open('planning'), orgBackend().on('GET', '/competitions/c9/heats', [200, heats]));
    await fireEvent.press(await screen.findByTestId('heat-export'));
    expect(sent()).toEqual({ title: 'event-heats.csv', head: 'heat,starts_at,wod,category,lane,athlete,username' });
    expect((share.mock.calls[0][0].message as string).split('\n')).toHaveLength(3);
  });

  it('promo codes', async () => {
    const screen = await renderScreen(open('coupons'), orgBackend().on('GET', '/competitions/c9/coupons', [200, coupons]));
    await fireEvent.press(await screen.findByTestId('coupon-export'));
    expect(sent()).toEqual({ title: 'event-coupons.csv', head: 'code,type,value,category,used,max_uses,expires_at,active' });
  });

  it('team', async () => {
    const screen = await renderScreen(open('team'), orgBackend().on('GET', '/competitions/c9/staff', [200, staff]));
    await fireEvent.press(await screen.findByTestId('team-export'));
    expect(sent()).toEqual({ title: 'event-team.csv', head: 'role,name,username' });
  });

  it('leaderboard of the category shown', async () => {
    const rows = [{ rank: 1, athlete: { id: 'u-r3', fullName: 'Hédi Kéfi', username: 'hedi' }, totalPoints: 180, pending: 0 }];
    const screen = await renderScreen(open('leaderboard'), orgBackend().on('GET', '/competitions/c9/leaderboard', [200, board(rows)]));
    await fireEvent.press(await screen.findByTestId('board-export'));
    expect(sent()).toEqual({ title: 'event-leaderboard.csv', head: 'category,rank,name,username,points,pending' });
    expect((share.mock.calls[0][0].message as string).split('\n')[1]).toBe('RX Men,1,Hédi Kéfi,hedi,180,0');
  });

  it('nothing to export: the button is off', async () => {
    const screen = await renderScreen(open('leaderboard'), orgBackend().on('GET', '/competitions/c9/leaderboard', [200, board([])]));
    expect((await screen.findByTestId('board-export')).props.accessibilityState?.disabled).toBe(true);
  });

  it('in French the columns are split by « ; » (French Excel)', async () => {
    const screen = await renderScreen(open('participants'), orgBackend(), { locale: 'fr' });
    await fireEvent.press(await screen.findByTestId('reg-csv'));
    expect(sent().head).toBe('name;username;category;registration;payment;amount;currency;registered_at');
  });
});
