import { fireEvent, waitFor } from 'expo-router/testing-library';

import { formatMoney } from '../../src/features/competitions/api';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';
import { setWide } from '../wide-web';

jest.mock('../../src/features/competitions/organizer/web', () => ({
  ...jest.requireActual('../../src/features/competitions/organizer/web'),
  useWideWeb: () => require('../wide-web').useWide(),
}));

const open = () => <ManageScreen id="c9" />;
const staff = [
  { id: 's1', role: 'ORGANIZER', userId: 'u-me', user: { username: 'ahmed_rx' } },
  { id: 's2', role: 'HEAD_JUDGE', userId: 'u-2', user: { username: 'hj' } },
  { id: 's3', role: 'JUDGE', userId: 'u-3', user: { username: 'j' } },
];
const zeros = { participants: 0, paidRegistrations: 0, freeRegistrations: 0, pendingPayments: 0, revenue: 0, pendingSubmissions: 0, pendingJudging: 0, approvedSubmissions: 0, rejectedSubmissions: 0 };
const backend = () => orgBackend().on('GET', '/competitions/c9/staff', [200, staff]);

describe('overview on a computer', () => {
  beforeEach(() => setWide(true));

  it('two rows of figures: the dashboard’s, and the judges of the team; the state card stays above', async () => {
    const screen = await renderScreen(open, backend());
    expect((await screen.findByTestId('ov-kpi-participants-value')).props.children).toBe('5');
    expect(screen.getByTestId('ov-kpi-paid-value').props.children).toBe('1');
    expect(screen.getByTestId('ov-kpi-to-collect-value').props.children).toBe('2');
    expect(screen.getByTestId('ov-kpi-revenue-value').props.children).toBe(formatMoney(35000, 'TND', 'en'));
    expect(screen.getByText(/^Today, /)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('ov-kpi-judges-value').props.children).toBe('2'));
    expect(screen.getByTestId('ov-kpi-to-judge-value').props.children).toBe('0');
    expect(screen.getByTestId('org-state')).toBeTruthy();
    expect(screen.queryByText('Figures')).toBeNull();
  });

  it('registrations per day: one bar per day from the first to the last, the cancelled one left out', async () => {
    // r4 on 19 Oct, r2 on 20 Oct, r1 and r3 on 21 Oct; Omar's registration of 22 Oct was cancelled.
    const screen = await renderScreen(open, backend());
    expect(await screen.findByText('4 registrations')).toBeTruthy();
    expect(screen.getByTestId('bar-2026-10-19').props.accessibilityLabel).toMatch(/: 1$/);
    expect(screen.getByTestId('bar-2026-10-20').props.accessibilityLabel).toMatch(/: 1$/);
    expect(screen.getByTestId('bar-2026-10-21').props.accessibilityLabel).toMatch(/: 2$/);
    expect(screen.queryByTestId('bar-2026-10-22')).toBeNull();
  });

  it('a category opens the participants of that category; « See all » opens every one', async () => {
    const screen = await renderScreen(open, backend());
    await fireEvent.press(await screen.findByTestId('ov-cat-k2'));
    expect(await screen.findByTestId('reg-r2')).toBeTruthy();
    expect(screen.getByTestId('reg-r4')).toBeTruthy();
    expect(screen.queryByTestId('reg-r1')).toBeNull();
    expect(screen.getByTestId('org-menu-participants').props.accessibilityState?.selected).toBe(true);
    await fireEvent.press(screen.getByTestId('org-menu-dashboard'));
    await fireEvent.press(await screen.findByTestId('ov-cat-all'));
    expect(await screen.findByTestId('reg-r1')).toBeTruthy();
    expect(screen.getByTestId('reg-r2')).toBeTruthy();
  });

  it('gender in percentages that add up to 100, or in numbers', async () => {
    // Women: r2, r4 (RX Women). Men: r1, r3 (RX Men); r5 is cancelled.
    const screen = await renderScreen(open, backend());
    expect((await screen.findByTestId('ov-gender-women')).props.children).toBe('50%');
    expect(screen.getByTestId('ov-gender-men').props.children).toBe('50%');
    expect(screen.getByTestId('ov-gender-mixed').props.children).toBe('0%');
    await fireEvent.press(screen.getByTestId('ov-gender-as-numbers'));
    expect(screen.getByTestId('ov-gender-women').props.children).toBe('2');
    expect(screen.getByTestId('ov-gender-mixed').props.children).toBe('0');
    expect(screen.getByTestId('ov-gender-as-numbers').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('scores: a ring of to judge / validated / refused with its legend', async () => {
    const screen = await renderScreen(open, backend().on('GET', '/competitions/c9/dashboard', [200, { ...zeros, participants: 5, pendingJudging: 3, approvedSubmissions: 5, rejectedSubmissions: 1 }]));
    expect((await screen.findByLabelText('Scores to judge 3, Validated 5, Rejected 1')).props.accessibilityRole).toBe('image');
    expect(screen.getByText('9')).toBeTruthy();
  });

  it('an event without data: each card says so instead of drawing empty charts', async () => {
    const screen = await renderScreen(open, orgBackend().on('GET', '/competitions/c9/dashboard', [200, zeros]).on('GET', '/competitions/c9/registrations', [200, []]).on('GET', '/competitions/c9/staff', [200, []]));
    for (const id of ['ov-per-day', 'ov-categories', 'ov-scores', 'ov-gender']) expect((await screen.findByTestId(`${id}-empty`)).props.children).toBe('No data yet');
    expect(screen.queryByText('NaN%')).toBeNull();
  });

  it('the phone keeps its figures and its breakdown', async () => {
    setWide(false);
    const screen = await renderScreen(open, backend());
    expect(await screen.findByText('Figures')).toBeTruthy();
    expect(await screen.findByTestId('day-2026-10-21')).toBeTruthy();
    expect(screen.queryByTestId('ov-kpi-participants')).toBeNull();
  });
});
