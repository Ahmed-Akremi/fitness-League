import { fireEvent } from 'expo-router/testing-library';

import { CompetitionsScreen } from '../../src/features/competitions/screens';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

const soon = new Date(Date.now() + 10 * 86_400_000).toISOString();
const later = new Date(Date.now() + 200 * 86_400_000).toISOString();
const ev = (id: string, extra: object) => ({ id, title: `Event ${id}`, status: 'REGISTRATION_OPEN', city: 'Tunis', countryCode: 'TN', format: 'ONSITE', eventStart: soon, eventEnd: soon, registrationEnd: new Date(Date.now() + 3.5 * 86_400_000).toISOString(), registrationPrice: 40000, currency: 'TND', participants: 12, ...extra });
const list = [ev('a', { title: 'Sousse Summer Throwdown', city: 'Sousse' }), ev('b', { title: 'Paris Hybrid Race', city: 'Paris', countryCode: 'FR', format: 'ONLINE', eventStyle: 'HYBRID_RACE', eventStart: later, eventEnd: later, status: 'UPCOMING' })];

describe('event list (athlete side)', () => {
  it('shows each event as a card with its date, place, price and deadline', async () => {
    const screen = await renderScreen(CompetitionsScreen, new FakeBackend().on('GET', '/competitions', [200, list]));
    expect(await screen.findByText('Sousse Summer Throwdown')).toBeTruthy();
    expect(screen.getByText('Closes in 3 days')).toBeTruthy();
    expect(screen.getByText('Hybrid race')).toBeTruthy();
    expect(screen.getAllByText('TND 40').length).toBeGreaterThan(0);
  });

  it('searches and filters on the device, and clears the filters', async () => {
    const screen = await renderScreen(CompetitionsScreen, new FakeBackend().on('GET', '/competitions', [200, list]));
    await fireEvent.changeText(await screen.findByTestId('comp-search'), 'sousse');
    expect(screen.queryByText('Paris Hybrid Race')).toBeNull();
    expect(screen.getByTestId('comp-count')).toHaveTextContent('1 event');
    await fireEvent.changeText(screen.getByTestId('comp-search'), '');

    await fireEvent.press(screen.getByTestId('comp-filters'));
    await fireEvent.press(screen.getByTestId('comp-type-HYBRID'));
    expect(screen.queryByText('Sousse Summer Throwdown')).toBeNull();
    expect(screen.getByText('Paris Hybrid Race')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('comp-when-MONTH'));
    expect(screen.getByText('No event matches your search.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('comp-filters-clear'));
    expect(screen.getByText('Sousse Summer Throwdown')).toBeTruthy();
    expect(screen.getByText('Paris Hybrid Race')).toBeTruthy();
    // Two countries in the list: their chips appear.
    expect(screen.getByTestId('comp-country-FR')).toBeTruthy();
  });
});
