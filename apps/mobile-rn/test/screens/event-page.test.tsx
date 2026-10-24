import { fireEvent } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { CompetitionScreen } from '../../src/features/competitions/screens';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

const event = {
  id: 'c1',
  title: 'Sousse Summer Throwdown',
  description: 'Two days on the beach.',
  status: 'REGISTRATION_OPEN',
  format: 'ONSITE',
  city: 'Sousse',
  location: 'Bodynade, Sousse',
  countryCode: 'TN',
  currency: 'TND',
  registrationPrice: 40000,
  participants: 42,
  eventStart: inDays(30),
  eventEnd: inDays(31),
  deadlines: { registrationStart: inDays(-5), registrationEnd: inDays(5.5) },
  organizer: { fullName: 'Bodynade Events' },
  contactEmail: 'hello@bodynade.tn',
  rulebookUrl: 'https://bodynade.tn/rules.pdf',
  categories: [
    { id: 'rxm', name: 'RX Men', gender: 'MALE', minAge: 18, maxAge: 35, active: true, price: 40000 },
    { id: 'pairs', name: 'RX Pairs', gender: 'MIXED', active: true, price: 70000, type: 'TEAM' },
  ],
  workouts: [{ id: 'w1', number: 1, name: 'Fran', description: '21-15-9 thrusters / pull-ups', scoreType: 'TIME', timeCapS: 600, maximumPoints: 100 }],
  prizes: [],
  myRoles: [],
  myRegistration: null,
};

describe('event page (athlete side)', () => {
  it('shows the cover facts, who can join and the organizer, with « Register now » pinned', async () => {
    const backend = new FakeBackend().on('GET', '/competitions/c1', [200, event]).on('GET', '/competitions/c1/heats', [200, []]);
    const screen = await renderScreen(() => <CompetitionScreen id="c1" />, backend, { routes: { 'competitions/[id]/register': () => <Text>Register page</Text> } });
    expect(await screen.findByTestId('fact-athletes')).toHaveTextContent(/42/);
    expect(screen.getByTestId('fact-fees')).toHaveTextContent(/TND 40/);
    expect(screen.getByTestId('fact-registration')).toHaveTextContent(/5/);
    expect(screen.getByText('Who can join?')).toBeTruthy();
    expect(screen.getByText('Individuals')).toBeTruthy();
    expect(screen.getByText('Teams')).toBeTruthy();
    expect(screen.getByText('Men · 18–35')).toBeTruthy();
    expect(screen.getByText('Bodynade Events')).toBeTruthy();
    expect(screen.getByTestId('comp-contact-email')).toBeTruthy();
    expect(screen.getByTestId('comp-rulebook')).toBeTruthy();
    expect(screen.getByTestId('comp-directions')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('comp-register'));
    expect(await screen.findByText('Register page')).toBeTruthy();
  });

  it('shows the early-bird saving, and the workout with its format', async () => {
    const early = { ...event, categories: [{ ...event.categories[0], earlyPrice: 30000, earlyUntil: inDays(3) }] };
    const backend = new FakeBackend().on('GET', '/competitions/c1', [200, early]).on('GET', '/competitions/c1/heats', [200, []]);
    const screen = await renderScreen(() => <CompetitionScreen id="c1" />, backend);
    expect(await screen.findByTestId('fact-early')).toHaveTextContent(/−25%/);
    expect(screen.getByTestId('fact-fees')).toHaveTextContent(/TND 30/);
    await fireEvent.press(screen.getByTestId('comp-go-wods'));
    expect(await screen.findByText('For time · fastest is better · Time cap 10 min')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('comp-tab-schedule'));
    expect(await screen.findByText('The heat schedule hasn’t been announced yet.')).toBeTruthy();
  });

  it('hides « Register now » once registered or when registration is closed', async () => {
    const closed = { ...event, status: 'ACTIVE' };
    const backend = new FakeBackend().on('GET', '/competitions/c1', [200, closed]).on('GET', '/competitions/c1/heats', [200, []]);
    const screen = await renderScreen(() => <CompetitionScreen id="c1" />, backend);
    expect(await screen.findByTestId('fact-registration')).toHaveTextContent(/Closed/);
    expect(screen.queryByTestId('comp-register')).toBeNull();
  });
});
