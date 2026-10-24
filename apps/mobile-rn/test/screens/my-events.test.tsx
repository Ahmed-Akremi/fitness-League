import { fireEvent } from 'expo-router/testing-library';

import { MyEventsScreen } from '../../src/features/competitions/my-events';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const ev = (id: string, extra: object) => ({ id, title: `Event ${id}`, status: 'REGISTRATION_OPEN', format: 'ONSITE', city: 'Sousse', eventStart: inDays(20), eventEnd: inDays(21), categories: [{ id: 'k1', name: 'RX Men', active: true }], workouts: [], myRoles: [], myRegistration: null, ...extra });

const paying = ev('pay', { title: 'Sousse Summer Throwdown', deadlines: { registrationEnd: inDays(2.5) }, myRegistration: { categoryId: 'k1', registrationStatus: 'PENDING', paymentStatus: 'PENDING', teamName: 'Box Bandits' } });
const online = ev('online', { title: 'Online Qualifier', format: 'ONLINE', workouts: [{ id: 'w1' }, { id: 'w2' }], deadlines: { registrationEnd: inDays(-1), scoreSubmissionDeadline: inDays(5.5) }, myRegistration: { categoryId: 'k1', registrationStatus: 'CONFIRMED', paymentStatus: 'PAID' } });
const past = ev('past', { title: 'Spring Games', eventStart: inDays(-40), eventEnd: inDays(-39), myRegistration: { categoryId: 'k1', registrationStatus: 'CONFIRMED', paymentStatus: 'PAID' } });
const organised = ev('org', { title: 'My Draft Event', status: 'DRAFT', myRoles: ['ORGANIZER'] });
const judged = ev('judge', { title: 'Hammamet Open', myRoles: ['FLOOR_JUDGE'] });
const all = [paying, online, past, organised, judged];

const backend = () => {
  const b = new FakeBackend().on('GET', '/competitions', [200, all.map(({ id, title, eventStart }) => ({ id, title, eventStart }))]);
  for (const c of all) b.on('GET', `/competitions/${c.id}`, [200, c]);
  return b.on('GET', '/competitions/online/my-submissions', [200, [{ workout: { id: 'w1' }, status: 'SUBMITTED' }]]);
};

describe('my events (Circle21 « My Events »)', () => {
  it('lists my registrations with what is left to do, past events last', async () => {
    const screen = await renderScreen(MyEventsScreen, backend());
    expect(await screen.findByText('Sousse Summer Throwdown')).toBeTruthy();
    expect(screen.getByTestId('my-event-state-pay')).toHaveTextContent('Payment pending');
    expect(screen.getByTestId('my-event-actions-pay')).toHaveTextContent(/Complete payment.*2 days left/);
    expect(screen.getByText('Team: Box Bandits')).toBeTruthy();
    expect(await screen.findByText('Submit your scores · 1/2')).toBeTruthy();
    expect(screen.getByText('5 days left')).toBeTruthy();
    expect(screen.getByText('Past events')).toBeTruthy();
    expect(screen.getByText('Spring Games')).toBeTruthy();
    expect(screen.queryByText('My Draft Event')).toBeNull();
  });

  it('shows the events I organise and those I judge in their own tabs', async () => {
    const screen = await renderScreen(MyEventsScreen, backend());
    await fireEvent.press(await screen.findByText('As organiser (1)'));
    expect(screen.getByText('My Draft Event')).toBeTruthy();
    expect(screen.getByTestId('my-event-manage-org')).toBeTruthy();
    await fireEvent.press(screen.getByText('As staff (1)'));
    expect(screen.getByText('Floor judge')).toBeTruthy();
    expect(screen.getByTestId('my-event-judge-judge')).toBeTruthy();
  });

  it('explains an empty list and opens the events', async () => {
    const screen = await renderScreen(MyEventsScreen, new FakeBackend().on('GET', '/competitions', [200, []]));
    expect(await screen.findByText('You didn’t register to any event yet.')).toBeTruthy();
    expect(screen.getByText('Explore events')).toBeTruthy();
  });
});
