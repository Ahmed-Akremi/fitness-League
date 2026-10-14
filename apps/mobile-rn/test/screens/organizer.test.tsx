import { Text } from 'react-native';
import { router } from 'expo-router';
import { act, fireEvent, waitFor } from 'expo-router/testing-library';

import { CompetitionScreen, CompetitionsScreen } from '../../src/features/competitions/screens';
import { CreateEventScreen } from '../../src/features/competitions/organizer/create';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { pickImage } from '../../src/core/utils/pick-image';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

jest.mock('../../src/core/utils/pick-image', () => ({ pickImage: jest.fn() }));
const pick = pickImage as jest.Mock;

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
    // Two taps before the first answer arrives, in one act scope.
    await act(async () => {
      fireEvent.press(create);
      fireEvent.press(create);
    });
    expect(await screen.findByText('Manage page')).toBeTruthy();
    const sent = backend.calls('POST', '/competitions');
    expect(sent).toHaveLength(2);
    expect(sent[0].body.slug).toMatch(/^event-[a-z0-9]{4}$/);
    expect(sent[1].body.slug).toMatch(/^event-[a-z0-9]{4}$/);
  });
});

const draft = {
  id: 'c9',
  title: 'Sousse Summer Throwdown',
  description: 'Two days on site.',
  status: 'DRAFT',
  format: 'ONSITE',
  city: 'Sousse',
  location: 'Bodynade',
  countryCode: 'TN',
  currency: 'TND',
  registrationPrice: 40000,
  maxParticipants: null,
  coverUrl: null,
  deadlines: { registrationStart: '2026-10-20T08:00:00.000Z', registrationEnd: '2026-12-01T22:00:00.000Z' },
  registrationEnd: '2026-12-01T22:00:00.000Z',
  eventStart: '2026-12-12T08:00:00.000Z',
  eventEnd: '2026-12-13T18:00:00.000Z',
  categories: [],
  workouts: [],
  prizes: [],
  myRoles: ['ORGANIZER'],
  myRegistration: null,
  publicationRequestedAt: null,
  publicationNote: null,
};
const complete = {
  ...draft,
  coverUrl: 'https://cdn.test/cover.webp',
  categories: [{ id: 'k1', name: 'RX Mixed', gender: 'MIXED', active: true, sortOrder: 0 }],
  workouts: [{ id: 'w1', number: 1, name: 'WOD 1', scoreType: 'REPS' }],
};
const figures = { participants: 12, paidRegistrations: 8, freeRegistrations: 1, pendingPayments: 3, revenue: 320000, pendingSubmissions: 0, pendingJudging: 2, approvedSubmissions: 5, rejectedSubmissions: 0 };
const organizerBackend = (c: object) => new FakeBackend().on('GET', '/competitions/c9', [200, c]).on('GET', '/competitions/c9/dashboard', [200, figures]);

describe('organizer space', () => {
  it('is reserved to the organizers', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" />, organizerBackend({ ...draft, myRoles: [] }));
    expect(await screen.findByText('Only the organizers of this event can open this page.')).toBeTruthy();
    expect(screen.queryByTestId('org-request')).toBeNull();
  });

  it('lists what the draft misses and keeps the request button off', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" />, organizerBackend(draft));
    expect(await screen.findByText('Draft: only you can see it.')).toBeTruthy();
    for (const item of ['COVER', 'CATEGORY', 'WOD']) expect(screen.getByTestId(`check-${item}`)).toBeTruthy();
    expect(screen.getAllByText('To do: tap to fix')).toHaveLength(3);
    expect(screen.getByTestId('org-request').props.accessibilityState?.disabled).toBe(true);
    expect(await screen.findByText('12')).toBeTruthy();
  });

  it('asks for publication once, even on a double tap', async () => {
    let state: object = complete;
    const backend = organizerBackend(complete)
      .on('GET', '/competitions/c9', () => [200, state])
      .on('POST', '/competitions/c9/publication-request', () => {
        state = { ...complete, publicationRequestedAt: '2026-10-14T10:00:00.000Z' };
        return [200, state];
      });
    const screen = await renderScreen(() => <ManageScreen id="c9" />, backend);
    const request = await screen.findByTestId('org-request');
    await act(async () => {
      fireEvent.press(request);
      fireEvent.press(request);
    });
    expect(await screen.findByText('Publication requested: the Fitness League team will publish it or send it back with a note.')).toBeTruthy();
    expect(backend.calls('POST', '/competitions/c9/publication-request')).toHaveLength(1);
  });

  it("shows the team's note when the draft is sent back", async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" />, organizerBackend({ ...complete, publicationNote: 'The banner is blurred.' }));
    expect(await screen.findByText('Sent back by the team. Fix this, then ask again:')).toBeTruthy();
    expect(screen.getByTestId('org-note').props.children).toBe('The banner is blurred.');
    expect(screen.getByTestId('org-request').props.accessibilityState?.disabled).toBe(false);
  });

  it('once published: no checklist, a share button', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" />, organizerBackend({ ...complete, status: 'REGISTRATION_OPEN' }));
    expect(await screen.findByTestId('org-share')).toBeTruthy();
    expect(screen.queryByTestId('org-request')).toBeNull();
  });

  // Navigation itself is checked through router.push: rendering the organizer space on top of a live competition page leaked act scopes into the next tests.
  it('the competition page offers « Manage » to its organizer', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => undefined);
    const page = await renderScreen(() => <CompetitionScreen id="c9" />, organizerBackend(complete));
    await fireEvent.press(await page.findByTestId('comp-manage'));
    expect(push).toHaveBeenCalledWith('/competitions/c9/manage');
    push.mockRestore();
  });

  it('… but not to an athlete', async () => {
    const athlete = await renderScreen(() => <CompetitionScreen id="c9" />, organizerBackend({ ...complete, status: 'REGISTRATION_OPEN', myRoles: [] }));
    await athlete.findByText('Sousse Summer Throwdown');
    expect(athlete.queryByTestId('comp-manage')).toBeNull();
  });
});

describe('organizer space: general', () => {
  beforeEach(() => pick.mockReset());

  it('the checklist leads to the tab that fixes the item', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" />, organizerBackend(draft));
    await fireEvent.press(await screen.findByTestId('check-COVER'));
    expect(await screen.findByTestId('org-banner-pick')).toBeTruthy();
  });

  it('saves the edited info', async () => {
    const backend = organizerBackend(draft).on('PUT', '/competitions/c9', [200, draft]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="general" />, backend);
    await fireEvent.changeText(await screen.findByTestId('org-title'), 'Sousse Summer Throwdown 2026');
    await fireEvent.changeText(screen.getByTestId('org-price'), '45,5');
    await fireEvent.press(screen.getByTestId('org-save'));
    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9')).toHaveLength(1));
    expect(backend.calls('PUT', '/competitions/c9')[0].body).toMatchObject({ title: 'Sousse Summer Throwdown 2026', registrationPrice: 45500, city: 'Sousse', location: 'Bodynade', format: 'ONSITE' });
  });

  it('refuses a banner over 5 MB without sending it, uploads a valid one', async () => {
    const backend = organizerBackend(draft).on('PUT', '/competitions/c9/cover', [200, { coverUrl: 'https://cdn.test/new.webp' }]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="general" />, backend);
    pick.mockResolvedValueOnce({ tooLarge: true });
    await fireEvent.press(await screen.findByTestId('org-banner-pick'));
    expect(await screen.findByText('This image is larger than 5 MB.')).toBeTruthy();
    expect(backend.calls('PUT', '/competitions/c9/cover')).toHaveLength(0);
    pick.mockResolvedValueOnce({ file: { uri: 'file:///banner.jpg', name: 'banner.jpg', type: 'image/jpeg' } });
    await fireEvent.press(screen.getByTestId('org-banner-pick'));
    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9/cover')).toHaveLength(1));
  });

  it('deletes the draft after confirmation', async () => {
    const backend = organizerBackend(draft).on('DELETE', '/competitions/c9', [200, {}]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="general" />, backend, { routes: { 'competitions/index': () => <Text>Competitions list</Text> } });
    await fireEvent.press(await screen.findByTestId('org-delete'));
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(await screen.findByText('Competitions list')).toBeTruthy();
    expect(backend.calls('DELETE', '/competitions/c9')).toHaveLength(1);
  });

  it('once published: next steps instead of deletion', async () => {
    const backend = organizerBackend({ ...complete, status: 'REGISTRATION_OPEN' }).on('PATCH', '/competitions/c9/status', [200, {}]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="general" />, backend);
    await fireEvent.press(await screen.findByText('Close registration'));
    await waitFor(() => expect(backend.calls('PATCH', '/competitions/c9/status')[0]?.body).toEqual({ status: 'REGISTRATION_CLOSED' }));
    expect(screen.queryByTestId('org-delete')).toBeNull();
  });
});
