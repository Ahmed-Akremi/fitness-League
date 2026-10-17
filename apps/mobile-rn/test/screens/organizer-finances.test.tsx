import { act, fireEvent, within } from 'expo-router/testing-library';

import { formatMoney } from '../../src/features/competitions/api';
import * as exportModule from '../../src/features/competitions/organizer/export';
import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend, regs } from '../organizer-fixtures';
import { setWide } from '../wide-web';

jest.mock('../../src/features/competitions/organizer/web', () => ({
  ...jest.requireActual('../../src/features/competitions/organizer/web'),
  useWideWeb: () => require('../wide-web').useWide(),
}));

const open = (tab?: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;
const priced = (r: object, originalPrice: number, discount: number) => ({ ...r, originalPrice, discount });
// Same money as the Task 1 unit test: gross 185 000, discounts 45 000, collected 35 000, to collect 75 000, 1 free, refunded 30 000.
const rows = [
  priced(regs[0], 40000, 0),
  priced(regs[1], 40000, 5000),
  priced(regs[2], 40000, 40000),
  priced(regs[3], 35000, 0),
  priced(regs[4], 40000, 0),
  { ...priced(regs[1], 30000, 0), id: 'r6', paymentStatus: 'REFUNDED', registrationStatus: 'REFUNDED', finalPrice: 30000, registeredAt: '2026-10-23T09:00:00.000Z' },
];
const backend = () => orgBackend().on('GET', '/competitions/c9/registrations', [200, rows]);
const money = (n: number) => formatMoney(n, 'TND', 'en');
const shownRows = (screen: Awaited<ReturnType<typeof renderScreen>>) => screen.getAllByTestId(/^fin-row-/).map((el) => el.props.testID);

describe('finances on a computer', () => {
  beforeEach(() => setWide(true));
  afterEach(() => jest.restoreAllMocks());

  it('the six figures and the manual-payment note', async () => {
    const screen = await renderScreen(open('finances'), backend());
    expect((await screen.findByTestId('fin-gross-value')).props.children).toBe(money(185000));
    expect(screen.getByTestId('fin-discounts-value').props.children).toBe(money(45000));
    expect(screen.getByTestId('fin-collected-value').props.children).toBe(money(35000));
    expect(screen.getByTestId('fin-to-collect-value').props.children).toBe(money(75000));
    expect(screen.getByTestId('fin-free-value').props.children).toBe('1');
    expect(screen.getByTestId('fin-refunded-value').props.children).toBe(money(30000));
    expect(screen.getByText('Manual payment, no online fees')).toBeTruthy();
  });

  it('transactions: newest first, the cancelled registration left out, the discount shown', async () => {
    const screen = await renderScreen(open('finances'), backend());
    expect(await screen.findByTestId('fin-row-r6')).toBeTruthy();
    expect(shownRows(screen)).toEqual(['fin-row-r6', 'fin-row-r3', 'fin-row-r1', 'fin-row-r2', 'fin-row-r4']);
    expect(within(screen.getByTestId('fin-row-r2')).getByText(`− ${money(5000)}`)).toBeTruthy();
    expect(within(screen.getByTestId('fin-header')).getByText('Transactions')).toBeTruthy();
  });

  it('search without accents, then one payment status', async () => {
    const screen = await renderScreen(open('finances'), backend());
    await fireEvent.changeText(await screen.findByTestId('fin-search'), 'kefi');
    expect(shownRows(screen)).toEqual(['fin-row-r3']);
    await fireEvent.changeText(screen.getByTestId('fin-search'), '');
    await fireEvent.press(screen.getByTestId('fin-pay'));
    await fireEvent.press(screen.getByTestId('fin-pay-PENDING'));
    expect(shownRows(screen)).toEqual(['fin-row-r1', 'fin-row-r4']);
  });

  it('« Export » downloads the transactions shown', async () => {
    const download = jest.spyOn(exportModule, 'exportCsv').mockImplementation(() => {});
    const screen = await renderScreen(open('finances'), backend());
    await fireEvent.changeText(await screen.findByTestId('fin-search'), 'amira');
    await fireEvent.press(screen.getByTestId('fin-export'));
    expect(download.mock.calls[0][0]).toBe('event-transactions.csv');
    const lines = (download.mock.calls[0][1] as string).split('\n');
    expect(lines[0]).toBe('registered_at,name,username,category,price,discount,amount,currency,payment');
    // r2 and the refunded r6 are both Amira's.
    expect(lines).toHaveLength(3);
  });

  it('no payment yet: says so, nothing to export', async () => {
    const screen = await renderScreen(open('finances'), orgBackend().on('GET', '/competitions/c9/registrations', [200, []]));
    expect(await screen.findByText('No payment')).toBeTruthy();
    expect(screen.getByTestId('fin-export').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('a computer menu entry under « Dashboard », next to the overview', async () => {
    const screen = await renderScreen(open(), backend());
    await fireEvent.press(await screen.findByTestId('org-menu-finances'));
    expect(await screen.findByTestId('fin-table')).toBeTruthy();
    expect(within(screen.getByTestId('org-page-header')).getByText('Finances')).toBeTruthy();
    expect(within(screen.getByTestId('org-menu')).getByText('Dashboard')).toBeTruthy();
    expect(screen.getByTestId('org-menu-finances').props.accessibilityState?.selected).toBe(true);
  });

  it('a reload that fails keeps the figures and the table, and says why', async () => {
    const b = backend();
    const screen = await renderScreen(open(), b);
    await fireEvent.press(await screen.findByTestId('org-menu-finances'));
    expect(await screen.findByTestId('fin-table')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('org-menu-dashboard'));
    b.offline = true;
    await fireEvent.press(screen.getByTestId('org-menu-finances'));
    expect((await screen.findAllByText(/No connection/)).length).toBeGreaterThan(0);
    expect(screen.getByTestId('fin-table')).toBeTruthy();
    expect(screen.getByTestId('fin-gross-value')).toBeTruthy();
  });

  it('a narrow window shows the dashboard instead of Finances, and Finances again once wide', async () => {
    const screen = await renderScreen(open('finances'), backend());
    expect(await screen.findByTestId('fin-table')).toBeTruthy();
    await act(async () => setWide(false));
    expect(await screen.findByTestId('org-state')).toBeTruthy();
    expect(screen.getByTestId('org-tab-dashboard').props.accessibilityState?.selected).toBe(true);
    expect(screen.queryByTestId('fin-table')).toBeNull();
    expect(screen.queryByTestId('org-tab-finances')).toBeNull();
    await act(async () => setWide(true));
    expect(await screen.findByTestId('fin-table')).toBeTruthy();
  });
});
