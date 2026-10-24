import { useEffect, useState, type ReactElement } from 'react';

import type { ApiClient } from '../../src/core/api/client';
import { useApi } from '../../src/core/services';
import { hasPass, myTickets, passCode, passValue } from '../../src/features/competitions/logic-pass';
import { PassScreen } from '../../src/features/competitions/pass';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

function Seeded({ seed, children }: { seed: (api: ApiClient) => Promise<unknown>; children: ReactElement }) {
  const api = useApi();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void seed(api).then(() => setReady(true));
  }, [api, seed]);
  return ready ? children : null;
}

describe('pass logic', () => {
  it('reads a short code from the registration and knows who has a pass', () => {
    expect(passCode('01a10804-f4aa-7e0b-8f73-42fa5631aaf9')).toBe('5631-AAF9');
    expect(passValue('c1', 'r1')).toBe('fitness-league:checkin:c1:r1');
    expect(hasPass({ format: 'ONSITE', myRegistration: { registrationStatus: 'CONFIRMED' } })).toBe(true);
    expect(hasPass({ format: 'ONLINE', myRegistration: { registrationStatus: 'CONFIRMED' } })).toBe(false);
    expect(hasPass({ format: 'ONSITE', myRegistration: { registrationStatus: 'CANCELLED' } })).toBe(false);
    const orders = [{ userId: 'u1', status: 'PAID', code: 'AAAA-BBBB' }, { userId: 'u1', status: 'USED', code: 'CCCC-DDDD' }, { userId: 'u2', status: 'PAID', code: 'EEEE-FFFF' }];
    expect(myTickets(orders, 'u1').map((o) => o.code)).toEqual(['AAAA-BBBB']);
  });
});

describe('my pass (Circle21 presence QR)', () => {
  const event = { id: 'c1', title: 'Sousse Throwdown', format: 'ONSITE', city: 'Sousse', eventStart: '2026-12-12T08:00:00Z', categories: [{ id: 'k1', name: 'RX Men' }], myRegistration: { id: 'reg-12345678', categoryId: 'k1', registrationStatus: 'CONFIRMED' } };
  const me = { id: 'u1', username: 'sami', profile: { fullName: 'Sami Ben Ali' } };

  it('shows the presence code and my tickets', async () => {
    const seed = async (api: ApiClient) => {
      const type = await api.post<{ id: string }>('/competitions/c1/ticket-types', { name: 'Day pass', price: 10000, limit: null });
      await api.post('/competitions/c1/ticket-orders', { id: 'o1', itemId: type.id, quantity: 2, status: 'PAID', userId: 'u1', code: 'AAAA-BBBB' });
    };
    const backend = new FakeBackend().on('GET', '/competitions/c1', [200, event]).on('GET', '/me', [200, me]);
    const screen = await renderScreen(() => <Seeded seed={seed}><PassScreen id="c1" /></Seeded>, backend);
    expect(await screen.findByTestId('pass-athlete-code')).toHaveTextContent('1234-5678');
    expect(screen.getByText('Please show this QR code to the event host to confirm your presence.')).toBeTruthy();
    expect(await screen.findByTestId('pass-ticket-o1-code')).toHaveTextContent('AAAA-BBBB');
    expect(screen.getByText('Day pass × 2')).toBeTruthy();
  });

  it('explains when there is nothing to show', async () => {
    const backend = new FakeBackend().on('GET', '/competitions/c1', [200, { ...event, format: 'ONLINE' }]).on('GET', '/me', [200, me]);
    const screen = await renderScreen(() => <PassScreen id="c1" />, backend);
    expect(await screen.findByText('No pass for this event: register on site or reserve a ticket.')).toBeTruthy();
  });
});
