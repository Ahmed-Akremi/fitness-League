import { act, fireEvent, waitFor } from 'expo-router/testing-library';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';

const coupons = [
  { id: 'p1', code: 'EARLY', type: 'PERCENTAGE', value: 20, categoryId: null, maxUses: 50, usedCount: 12, expiresAt: '2026-11-01T22:00:00.000Z', active: true },
  { id: 'p2', code: 'FREE2026', type: 'FREE', value: 0, categoryId: 'k2', maxUses: null, usedCount: 3, expiresAt: null, active: false },
  { id: 'p3', code: 'TEN', type: 'FIXED_AMOUNT', value: 10000, categoryId: null, maxUses: 10, usedCount: 0, expiresAt: null, active: true },
];
const promo = () => orgBackend().on('GET', '/competitions/c9/coupons', [200, coupons]);
const open = () => <ManageScreen id="c9" initialTab="coupons" />;

describe('organizer space: promo codes', () => {
  it('lists the codes with their discount, category, uses and state; the most used on top', async () => {
    const screen = await renderScreen(open, promo());
    expect(await screen.findByText('Most used')).toBeTruthy();
    // EARLY and FREE2026 are in the top list and in the full list; TEN was never used.
    expect(screen.getAllByText('EARLY')).toHaveLength(2);
    expect(screen.getAllByText('FREE2026')).toHaveLength(2);
    expect(screen.getAllByText('TEN')).toHaveLength(1);
    expect(screen.getByText(/^-20 % · 12\/50 uses · until /)).toBeTruthy();
    expect(screen.getByText('Free · RX Women · 3/∞ uses · Inactive')).toBeTruthy();
  });

  it('creates one code with a percentage', async () => {
    const backend = promo().on('POST', '/competitions/c9/coupons', [201, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('coupon-new'));
    await fireEvent.changeText(screen.getByTestId('coupon-code'), 'summer20');
    await fireEvent.changeText(screen.getByTestId('coupon-value'), '20');
    await fireEvent.press(screen.getByTestId('coupon-save'));
    expect(await screen.findByText('Codes created: 1')).toBeTruthy();
    expect(backend.calls('POST', '/competitions/c9/coupons').map((r) => r.body)).toEqual([{ code: 'SUMMER20', type: 'PERCENTAGE', value: 20 }]);
  });

  it('sends an amount in millimes', async () => {
    const backend = promo().on('POST', '/competitions/c9/coupons', [201, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('coupon-new'));
    await fireEvent.changeText(screen.getByTestId('coupon-code'), 'ten5');
    await fireEvent.press(screen.getByTestId('coupon-type-FIXED_AMOUNT'));
    await fireEvent.changeText(screen.getByTestId('coupon-value'), '12,5');
    await fireEvent.press(screen.getByTestId('coupon-save'));
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/coupons')).toHaveLength(1));
    expect(backend.calls('POST', '/competitions/c9/coupons')[0].body).toEqual({ code: 'TEN5', type: 'FIXED_AMOUNT', value: 12500 });
  });

  it('a batch skips a code already taken and names it; a double tap starts one batch', async () => {
    const backend = promo().on('POST', '/competitions/c9/coupons', (req) => (req.body.code === 'VIP-2' ? [422, { code: 'VALIDATION_FAILED', status: 422, errors: [{ field: 'code', code: 'TAKEN' }] }] : [201, {}]));
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('coupon-new'));
    await fireEvent.changeText(screen.getByTestId('coupon-code'), 'vip');
    await fireEvent.press(screen.getByTestId('coupon-type-FREE'));
    await fireEvent.changeText(screen.getByTestId('coupon-qty'), '3');
    expect(screen.getByText('Creates VIP-1 … VIP-3')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('coupon-save'));
      fireEvent.press(screen.getByTestId('coupon-save'));
    });
    expect(await screen.findByText('Codes created: 2 · Already taken, skipped: VIP-2')).toBeTruthy();
    expect(backend.calls('POST', '/competitions/c9/coupons').map((r) => r.body.code)).toEqual(['VIP-1', 'VIP-2', 'VIP-3']);
  });

  it('deactivates a code', async () => {
    const backend = promo().on('POST', '/competitions/c9/coupons/p1/deactivate', [200, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('coupon-toggle-p1'));
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/coupons/p1/deactivate')).toHaveLength(1));
  });
});
