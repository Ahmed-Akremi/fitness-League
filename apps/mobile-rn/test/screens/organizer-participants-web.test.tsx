import { act, fireEvent, waitFor, within } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend, regs } from '../organizer-fixtures';
import { setWide } from '../wide-web';

jest.mock('../../src/features/competitions/organizer/web', () => ({
  ...jest.requireActual('../../src/features/competitions/organizer/web'),
  useWideWeb: () => require('../wide-web').useWide(),
}));

const open = () => <ManageScreen id="c9" initialTab="participants" />;
const heats = [
  { id: 'h1', number: 1, name: 'RX Women · Heat 1', startsAt: '2026-12-12T09:00:00.000Z', durationMin: 12, laneCount: 4, workout: null, category: { id: 'k2', name: 'RX Women' }, lanes: [{ lane: 2, registrationId: 'r2', athlete: { id: 'u-r2', fullName: 'Amira Trabelsi', username: 'amira' } }] },
];
const backend = () => orgBackend().on('GET', '/competitions/c9/heats', [200, heats]);
/** Registrations after r1 was marked paid. */
const r1Paid = () => regs.map((r) => (r.id === 'r1' ? { ...r, paymentStatus: 'PAID', registrationStatus: 'CONFIRMED' } : r));

async function selectAllToCollect(screen: Awaited<ReturnType<typeof renderScreen>>) {
  await fireEvent.press(await screen.findByTestId('tab-collect'));
  await fireEvent.press(screen.getByTestId('reg-table-check-all'));
  await fireEvent.press(screen.getByTestId('reg-batch'));
}

describe('participants on a computer', () => {
  beforeEach(() => setWide(true));

  it('a table: header strip, bold uppercase names, filters, search and export in the header row', async () => {
    const screen = await renderScreen(open, backend());
    expect(await screen.findByTestId('reg-table-head')).toBeTruthy();
    expect(StyleSheet.flatten(within(screen.getByTestId('reg-r1')).getByText('Sami Ben Ali').props.style)).toMatchObject({ textTransform: 'uppercase', fontWeight: '700' });
    const header = screen.getByTestId('org-page-header');
    expect(within(header).getByTestId('reg-search')).toBeTruthy();
    expect(within(header).getByTestId('reg-csv').props.accessibilityLabel).toBe('Export (CSV)');
    await fireEvent.press(within(header).getByTestId('reg-pay'));
    await fireEvent.press(screen.getByTestId('reg-pay-PAID'));
    expect(screen.getByTestId('reg-r2')).toBeTruthy();
    expect(screen.queryByTestId('reg-r1')).toBeNull();
    // Checkboxes only in « To collect ».
    expect(screen.queryByTestId('reg-table-check-all')).toBeNull();
  });

  it('the row menu opens the record or asks to mark paid', async () => {
    const screen = await renderScreen(open, backend());
    await fireEvent.press(await screen.findByTestId('reg-table-menu-r1'));
    await fireEvent.press(screen.getByTestId('reg-paid-r1'));
    expect(screen.getByText(/^Did Sami Ben Ali pay /)).toBeTruthy();
  });

  it('a click on a row opens the light side panel: payment, heats and lanes; Esc closes it', async () => {
    const screen = await renderScreen(open, backend());
    await fireEvent.press(await screen.findByTestId('reg-r2'));
    const panel = await screen.findByTestId('reg-panel');
    expect(within(panel).getByText('Amira Trabelsi')).toBeTruthy();
    expect(within(panel).getByTestId('reg-panel-heat-h1')).toBeTruthy();
    expect(within(panel).getByText(/Lane 2$/)).toBeTruthy();
    expect(within(within(panel).getByTestId('reg-panel-status')).getByText('Paid')).toBeTruthy();
    expect(within(panel).getByTestId('reg-panel-receipt')).toBeTruthy();
    expect(screen.queryByTestId('reg-panel-pay')).toBeNull();
    await act(async () => screen.getByTestId('reg-panel-modal').props.onRequestClose());
    expect(screen.queryByTestId('reg-panel')).toBeNull();
  });

  it('an athlete without a heat: the panel says so', async () => {
    const screen = await renderScreen(open, backend());
    await fireEvent.press(await screen.findByTestId('reg-r1'));
    expect(await within(await screen.findByTestId('reg-panel')).findByText('Not in a heat yet')).toBeTruthy();
  });

  it('« Mark paid » from the panel: confirmation, one request even on a double click, the receipt; the panel shows the new state', async () => {
    let paid = false;
    const b = backend()
      .on('GET', '/competitions/c9/registrations', () => [200, paid ? r1Paid() : regs])
      .on('POST', '/competitions/c9/registrations/r1/mark-paid', () => {
        paid = true;
        return [200, {}];
      });
    const screen = await renderScreen(open, b);
    await fireEvent.press(await screen.findByTestId('reg-r1'));
    await fireEvent.press(await screen.findByTestId('reg-panel-pay'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('dialog-confirm'));
      fireEvent.press(screen.getByTestId('dialog-confirm'));
    });
    expect(await screen.findByText(/^Fitness League receipt/)).toBeTruthy();
    expect(b.calls('POST', '/competitions/c9/registrations/r1/mark-paid')).toHaveLength(1);
    await waitFor(() => expect(within(screen.getByTestId('reg-panel-status')).getByText('Paid')).toBeTruthy());
    expect(screen.queryByTestId('reg-panel-pay')).toBeNull();
  });

  it('paid elsewhere meanwhile (409): the panel says so and shows the real state', async () => {
    let settled = false;
    const b = backend()
      .on('GET', '/competitions/c9/registrations', () => [200, settled ? r1Paid() : regs])
      .on('POST', '/competitions/c9/registrations/r1/mark-paid', () => {
        settled = true;
        return [409, { code: 'CONFLICT' }];
      });
    const screen = await renderScreen(open, b);
    await fireEvent.press(await screen.findByTestId('reg-r1'));
    await fireEvent.press(await screen.findByTestId('reg-panel-pay'));
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(await within(screen.getByTestId('reg-panel')).findByText('This registration was already settled. The list is up to date.')).toBeTruthy();
    await waitFor(() => expect(within(screen.getByTestId('reg-panel-status')).getByText('Paid')).toBeTruthy());
    expect(screen.queryByTestId('reg-panel-pay')).toBeNull();
  });

  it('batch: select in « To collect », one request at a time, a 409 counted « already settled », the rest go on', async () => {
    const b = backend().on('POST', '/competitions/c9/registrations/r4/mark-paid', [409, { code: 'CONFLICT' }]).on('POST', '/competitions/c9/registrations/r1/mark-paid', [200, {}]);
    const screen = await renderScreen(open, b);
    await fireEvent.press(await screen.findByTestId('tab-collect'));
    expect(screen.getByTestId('reg-batch').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId('reg-table-check-all'));
    expect(within(screen.getByTestId('reg-batch')).getByText('Mark paid (2)')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('reg-batch'));
    expect(screen.getByText('Mark 2 registrations as paid?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(await screen.findByText('1 marked paid · 1 already settled')).toBeTruthy();
    // Oldest first, one after the other.
    expect(b.requests.filter((r) => r.method === 'POST').map((r) => r.path)).toEqual(['/competitions/c9/registrations/r4/mark-paid', '/competitions/c9/registrations/r1/mark-paid']);
  });

  it('two quick clicks start one batch', async () => {
    const b = backend().on('POST', '/competitions/c9/registrations/r4/mark-paid', [200, {}]).on('POST', '/competitions/c9/registrations/r1/mark-paid', [200, {}]);
    const screen = await renderScreen(open, b);
    await fireEvent.press(await screen.findByTestId('tab-collect'));
    await fireEvent.press(screen.getByTestId('reg-table-check-all'));
    await fireEvent.press(screen.getByTestId('reg-batch'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('dialog-confirm'));
      fireEvent.press(screen.getByTestId('dialog-confirm'));
    });
    expect(await screen.findByText('2 marked paid · none already settled')).toBeTruthy();
    expect(b.calls('POST', '/competitions/c9/registrations/r4/mark-paid')).toHaveLength(1);
    expect(b.calls('POST', '/competitions/c9/registrations/r1/mark-paid')).toHaveLength(1);
  });

  it('an error stops the batch; the ones left stay selected for a retry', async () => {
    const b = backend().on('POST', '/competitions/c9/registrations/r4/mark-paid', [500, { code: 'INTERNAL' }]).on('POST', '/competitions/c9/registrations/r1/mark-paid', [200, {}]);
    const screen = await renderScreen(open, b);
    await selectAllToCollect(screen);
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(await screen.findByText('2 registrations left: try again.')).toBeTruthy();
    expect(screen.getByText('None marked paid · none already settled')).toBeTruthy();
    expect(b.calls('POST', '/competitions/c9/registrations/r1/mark-paid')).toHaveLength(0);
    expect(within(screen.getByTestId('reg-batch')).getByText('Mark paid (2)')).toBeTruthy();
    expect(screen.getByTestId('reg-table-check-r4').props.accessibilityState).toMatchObject({ checked: true });
  });

  it('the network drops during a batch: the table and the summary stay, the error shows above them', async () => {
    const b = backend();
    b.on('POST', '/competitions/c9/registrations/r4/mark-paid', () => {
      // The first payment goes through, then the venue's Wi-Fi drops: the second one and the reload fail.
      b.offline = true;
      return [200, {}];
    });
    const screen = await renderScreen(open, b);
    await selectAllToCollect(screen);
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(await screen.findByText('1 marked paid · none already settled')).toBeTruthy();
    expect(screen.getByText('1 registration left: try again.')).toBeTruthy();
    expect(screen.getByTestId('reg-table')).toBeTruthy();
  });

  it('the phone keeps its list and its inline « Mark paid »', async () => {
    setWide(false);
    const screen = await renderScreen(open, backend());
    expect(await screen.findByTestId('reg-r1')).toBeTruthy();
    expect(screen.queryByTestId('reg-table')).toBeNull();
    expect(screen.getByTestId('reg-paid-r1')).toBeTruthy();
  });
});
