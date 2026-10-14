import { Text } from 'react-native';
import { fireEvent, waitFor } from 'expo-router/testing-library';

import { CompetitionsScreen } from '../../src/features/competitions/screens';
import { CreateEventScreen } from '../../src/features/competitions/organizer/create';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

const manageRoute = { 'competitions/[id]/manage': () => <Text>Manage page</Text> };

describe('create an event', () => {
  it('opens from the competitions page', async () => {
    const backend = new FakeBackend().on('GET', '/competitions', [200, []]);
    const screen = await renderScreen(CompetitionsScreen, backend, { routes: { 'competitions/new': () => <Text>Create page</Text> } });
    await fireEvent.press(await screen.findByTestId('comp-create'));
    expect(await screen.findByText('Create page')).toBeTruthy();
  });

  it('creates a draft with a valid address name and opens its organizer space', async () => {
    const backend = new FakeBackend().on('POST', '/competitions', [201, { id: 'new1', status: 'DRAFT' }]);
    const screen = await renderScreen(CreateEventScreen, backend, { routes: manageRoute });
    await fireEvent.changeText(screen.getByTestId('org-title'), 'Sousse Summer Throwdown');
    await fireEvent.changeText(screen.getByTestId('org-description'), 'Two days on site.');
    // On site by default: city and venue are needed.
    expect(screen.getByTestId('org-create').props.accessibilityState?.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('org-city'), 'Sousse');
    await fireEvent.changeText(screen.getByTestId('org-place'), 'Bodynade');
    await fireEvent.changeText(screen.getByTestId('org-price'), '40');
    await fireEvent.press(screen.getByTestId('org-create'));
    expect(await screen.findByText('Manage page')).toBeTruthy();
    const body = backend.calls('POST', '/competitions')[0].body;
    expect(body).toMatchObject({ title: 'Sousse Summer Throwdown', format: 'ONSITE', countryCode: 'TN', city: 'Sousse', location: 'Bodynade', registrationPrice: 40000, currency: 'TND' });
    expect(body.slug).toMatch(/^sousse-summer-throwdown-[a-z0-9]{4}$/);
  });

  it('retries once with another address name when it is taken, and sends one request per tap', async () => {
    let calls = 0;
    const backend = new FakeBackend().on('POST', '/competitions', () => (++calls === 1 ? [422, { code: 'VALIDATION_FAILED', status: 422, errors: [{ field: 'slug', code: 'TAKEN' }] }] : [201, { id: 'new2' }]));
    const screen = await renderScreen(CreateEventScreen, backend, { routes: manageRoute });
    await fireEvent.changeText(screen.getByTestId('org-title'), 'بطولة سوسة');
    await fireEvent.changeText(screen.getByTestId('org-description'), 'Online qualifier.');
    await fireEvent.press(screen.getByTestId('org-format-ONLINE'));
    const create = screen.getByTestId('org-create');
    fireEvent.press(create);
    fireEvent.press(create);
    expect(await screen.findByText('Manage page')).toBeTruthy();
    const sent = backend.calls('POST', '/competitions');
    expect(sent).toHaveLength(2);
    expect(sent[0].body.slug).toMatch(/^event-[a-z0-9]{4}$/);
    expect(sent[1].body.slug).toMatch(/^event-[a-z0-9]{4}$/);
  });
});
