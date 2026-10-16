import { Share } from 'react-native';
import { act, fireEvent, waitFor } from 'expo-router/testing-library';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend, regs } from '../organizer-fixtures';

const open = () => <ManageScreen id="c9" initialTab="participants" />;

describe('organizer space: participants', () => {
  let share: jest.SpyInstance;
  beforeEach(() => {
    share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  });
  afterEach(() => jest.restoreAllMocks());

  it('lists every registration; the search ignores accents and case', async () => {
    const screen = await renderScreen(open, orgBackend());
    expect(await screen.findByText('Sami Ben Ali')).toBeTruthy();
    expect(screen.getByText('All (5)')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('reg-search'), 'KEFI');
    expect(screen.getByText('Hédi Kéfi')).toBeTruthy();
    expect(screen.queryByText('Sami Ben Ali')).toBeNull();
  });

  it('filters by payment and by category', async () => {
    const screen = await renderScreen(open, orgBackend());
    await fireEvent.press(await screen.findByTestId('reg-pay-PAID'));
    expect(screen.getByText('Amira Trabelsi')).toBeTruthy();
    expect(screen.queryByText('Sami Ben Ali')).toBeNull();
    await fireEvent.press(screen.getByTestId('reg-pay-ALL'));
    await fireEvent.press(screen.getByTestId('reg-cat-k2'));
    expect(screen.getByText('Yasmine Jaziri')).toBeTruthy();
    expect(screen.queryByText('Hédi Kéfi')).toBeNull();
  });

  it('« To collect »: pending payments of registrations still standing, oldest first', async () => {
    const screen = await renderScreen(open, orgBackend());
    await fireEvent.press(await screen.findByText('To collect (2)'));
    expect(screen.getAllByTestId(/^reg-r\d$/).map((e) => e.props.testID)).toEqual(['reg-r4', 'reg-r1']);
  });

  it('marks paid once after confirmation, even on a double tap, then shares the receipt', async () => {
    const backend = orgBackend().on('POST', '/competitions/c9/registrations/r1/mark-paid', [200, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('reg-paid-r1'));
    expect(screen.getByText(/^Did Sami Ben Ali pay /)).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('dialog-confirm'));
      fireEvent.press(screen.getByTestId('dialog-confirm'));
    });
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/registrations/r1/mark-paid')).toHaveLength(1));
    expect(await screen.findByText('Receipt')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0].message).toMatch(/^Fitness League receipt\nSousse Summer Throwdown\nSami Ben Ali · RX Men\n/);
  });

  it('a registration already settled elsewhere: says so and reloads the list', async () => {
    const backend = orgBackend().on('POST', '/competitions/c9/registrations/r1/mark-paid', [409, { code: 'CONFLICT', status: 409, detail: 'Nothing to pay' }]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('reg-paid-r1'));
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(await screen.findByText('This registration was already settled. The list is up to date.')).toBeTruthy();
    expect(screen.queryByText('Receipt')).toBeNull();
    await waitFor(() => expect(backend.calls('GET', '/competitions/c9/registrations').length).toBeGreaterThanOrEqual(2));
  });

  it('shares the list shown as CSV', async () => {
    const screen = await renderScreen(open, orgBackend());
    await fireEvent.press(await screen.findByTestId('reg-csv'));
    const csv: string = share.mock.calls[0][0].message;
    expect(csv.split('\n')[0]).toBe('name,username,category,registration,payment,amount,currency,registered_at');
    expect(csv.split('\n')).toHaveLength(regs.length + 1);
  });

  it('finds one athlete among 300', async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ ...regs[0], id: `m${i}`, user: { username: `athlete${i}`, profile: { fullName: `Athlète ${i}` } } }));
    const screen = await renderScreen(open, orgBackend().on('GET', '/competitions/c9/registrations', [200, many]));
    await fireEvent.changeText(await screen.findByTestId('reg-search'), 'athlete 287');
    expect(await screen.findByText('Athlète 287')).toBeTruthy();
    expect(screen.getByTestId('reg-list')).toBeTruthy();
  });
});
