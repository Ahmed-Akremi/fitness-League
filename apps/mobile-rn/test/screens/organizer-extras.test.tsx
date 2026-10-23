import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, waitFor } from 'expo-router/testing-library';
import { useEffect, useState, type ReactElement } from 'react';

import type { ApiClient } from '../../src/core/api/client';
import { useApi } from '../../src/core/services';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { PublicShopScreen } from '../../src/features/competitions/organizer/shop';
import { renderScreen } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid', getRandomBytes: (n: number) => new Uint8Array(Array.from({ length: n }, (_, i) => i * 7)) }));

beforeEach(async () => {
  await AsyncStorage.clear();
});

function Seeded({ seed, children }: { seed: (api: ApiClient) => Promise<unknown>; children: ReactElement }) {
  const api = useApi();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void seed(api).then(() => setReady(true));
  }, [api, seed]);
  return ready ? children : null;
}

const backend = () => orgBackend(event).on('GET', '/competitions/c9/staff', [200, []]);

describe('messages (phase 11)', () => {
  it('sends to a segment now and lists it in the outbox, names only', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="messages" />, backend());
    await fireEvent.press(await screen.findByTestId('msg-seg-UNPAID'));
    expect(await screen.findByText('2 recipients')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('msg-subject'), 'Payment reminder');
    await fireEvent.changeText(screen.getByTestId('msg-body'), 'Please pay before Friday.');
    await fireEvent.press(screen.getByTestId('msg-send'));
    expect(await screen.findByText('Payment reminder')).toBeTruthy();
    const [m] = await screen.services.api.get<{ recipients: object[]; segment: object }[]>('/competitions/c9/messages');
    expect(m.segment).toEqual({ kind: 'UNPAID', categoryId: null });
    expect(m.recipients).toEqual([{ id: 'r1', name: 'Sami Ben Ali' }, { id: 'r4', name: 'Yasmine Jaziri' }]);
    expect(screen.getByText('Sent')).toBeTruthy();
  });

  it('cancels a message planned for later', async () => {
    let id = '';
    const seed = async (api: ApiClient) => {
      const m = await api.post<{ id: string }>('/competitions/c9/messages', { subject: 'Heats are out', body: 'See the timetable.', segment: { kind: 'ALL_ATHLETES', categoryId: null }, channels: ['EMAIL'], recipients: [{ id: 'r1', name: 'Sami Ben Ali' }], sendAt: new Date(Date.now() + 3_600_000).toISOString(), cancelled: false });
      id = m.id;
    };
    const screen = await renderScreen(() => <Seeded seed={seed}><ManageScreen id="c9" initialTab="messages" /></Seeded>, backend());
    expect(await screen.findByText('Scheduled')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`msg-cancel-${id}`));
    expect(await screen.findByText('Cancelled')).toBeTruthy();
  });
});

describe('tickets and shop (phase 11)', () => {
  it('the organizer adds a ticket type and checks a ticket in at the door', async () => {
    const seed = async (api: ApiClient) => {
      const t = await api.post<{ id: string }>('/competitions/c9/ticket-types', { name: 'VIP', price: 30000, limit: 20, salesEnd: null });
      await api.post('/competitions/c9/ticket-orders', { itemId: t.id, quantity: 2, status: 'PAID', userId: 'u-x', name: 'Rim', code: 'ABCD-EFGH' });
    };
    const screen = await renderScreen(() => <Seeded seed={seed}><ManageScreen id="c9" initialTab="tickets" /></Seeded>, backend());
    await fireEvent.changeText(await screen.findByTestId('tk-name'), 'General');
    await fireEvent.changeText(screen.getByTestId('tk-price'), '15');
    await fireEvent.changeText(screen.getByTestId('tk-limit'), '100');
    await fireEvent.press(screen.getByTestId('tk-add'));
    await waitFor(() => expect(screen.getAllByTestId(/^tk-type-/)).toHaveLength(2));
    const types = await screen.services.api.get<{ name: string; price: number }[]>('/competitions/c9/ticket-types');
    expect(types.find((x) => x.name === 'General')?.price).toBe(15000);

    await fireEvent.changeText(screen.getByTestId('tk-check'), 'abcd-efgh');
    await fireEvent.press(screen.getByTestId('tk-check-go'));
    expect(await screen.findByText('Valid: VIP × 2 · Rim')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('tk-check-go'));
    expect(await screen.findByText('Already used')).toBeTruthy();
  });

  it('a spectator reserves tickets and a T-shirt in its size', async () => {
    let ticketId = '';
    let productId = '';
    const seed = async (api: ApiClient) => {
      ticketId = (await api.post<{ id: string }>('/competitions/c9/ticket-types', { name: 'General', price: 15000, limit: 100, salesEnd: null })).id;
      productId = (await api.post<{ id: string }>('/competitions/c9/shop-products', { name: 'Event T-shirt', price: 40000, limit: 10, sizes: ['S', 'M', 'L'] })).id;
    };
    const screen = await renderScreen(() => <Seeded seed={seed}><PublicShopScreen id="c9" /></Seeded>, backend());
    await screen.findAllByTestId(/^shop-item-/);
    await fireEvent.changeText(screen.getByTestId(`shop-qty-${ticketId}`), '2');
    await fireEvent.press(screen.getByTestId(`shop-buy-${ticketId}`));
    expect(await screen.findByTestId(`shop-code-${ticketId}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`shop-size-${productId}-M`));
    await fireEvent.press(screen.getByTestId(`shop-buy-${productId}`));
    await waitFor(async () => expect(await screen.services.api.get('/competitions/c9/shop-orders')).toEqual([expect.objectContaining({ itemId: productId, size: 'M', quantity: 1, status: 'RESERVED' })]));
    expect(await screen.services.api.get('/competitions/c9/ticket-orders')).toEqual([expect.objectContaining({ itemId: ticketId, quantity: 2, status: 'RESERVED', code: expect.stringMatching(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/) })]);
  });

  it('the organizer marks a shop order paid, then picked up', async () => {
    let orderId = '';
    const seed = async (api: ApiClient) => {
      const p = await api.post<{ id: string }>('/competitions/c9/shop-products', { name: 'Event T-shirt', price: 40000, limit: 10, sizes: ['M'] });
      orderId = (await api.post<{ id: string }>('/competitions/c9/shop-orders', { itemId: p.id, quantity: 1, size: 'M', status: 'RESERVED', userId: 'u-x', name: 'Rim' })).id;
    };
    const screen = await renderScreen(() => <Seeded seed={seed}><ManageScreen id="c9" initialTab="shop" /></Seeded>, backend());
    await screen.findByTestId(/^sh-order-/);
    await fireEvent.press(screen.getByTestId(`sh-paid-${orderId}`));
    expect(await screen.findByTestId(`sh-picked-${orderId}`)).toBeTruthy();
    expect(screen.getByTestId('sh-revenue')).toHaveTextContent(/40/);
    await fireEvent.press(screen.getByTestId(`sh-picked-${orderId}`));
    await waitFor(async () => expect(await screen.services.api.get('/competitions/c9/shop-orders')).toEqual([expect.objectContaining({ status: 'PICKED_UP' })]));
  });
});
