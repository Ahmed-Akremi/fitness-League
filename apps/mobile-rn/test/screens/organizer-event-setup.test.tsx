import { fireEvent, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { CreateEventScreen } from '../../src/features/competitions/organizer/create';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { ORG_MENU } from '../../src/features/competitions/organizer/web';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';

// Bytes 0,1,0,0 → 65 536 → code « 065536 ».
jest.mock('expo-crypto', () => ({ ...jest.requireActual('expo-crypto'), getRandomBytes: () => new Uint8Array([0, 1, 0, 0]) }));

const manageRoute = { 'competitions/[id]/manage': () => <Text>Manage page</Text> };

async function fillBasics(screen: Awaited<ReturnType<typeof renderScreen>>) {
  await fireEvent.changeText(screen.getByTestId('org-title'), 'Sousse Hybrid Race');
  await fireEvent.changeText(screen.getByTestId('org-description'), 'Eight stations, eight runs.');
  await fireEvent.changeText(screen.getByTestId('org-city'), 'Sousse');
  await fireEvent.changeText(screen.getByTestId('org-place'), 'Bodynade');
}

const createBackend = () =>
  new FakeBackend()
    .on('GET', '/competitions', [200, []])
    .on('POST', '/competitions', [201, { id: 'new1', status: 'DRAFT' }])
    .on('GET', '/competitions/new1', [200, { id: 'new1', status: 'DRAFT' }]);

describe('create an event: type and setup (phase 2)', () => {
  it('creates a hybrid race with the HYROX-style template, kept on the device', async () => {
    const backend = createBackend();
    const screen = await renderScreen(CreateEventScreen, backend, { routes: manageRoute });
    await fillBasics(screen);
    await fireEvent.press(screen.getByTestId('org-style-HYBRID_RACE'));
    // A hybrid race needs its template.
    expect(screen.getByTestId('org-create').props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('org-template-HYROX_STYLE'));
    await fireEvent.press(screen.getByTestId('org-create'));

    expect(await screen.findByText('Manage page')).toBeTruthy();
    const sent = backend.calls('POST', '/competitions')[0].body;
    expect(sent).not.toHaveProperty('eventStyle');
    expect(sent).not.toHaveProperty('hybridTemplate');
    await expect(screen.services.api.get('/competitions/new1')).resolves.toMatchObject({
      eventStyle: 'HYBRID_RACE',
      hybridTemplate: 'HYROX_STYLE',
      visibility: 'PUBLIC',
      participantTypes: ['INDIVIDUAL'],
      label: 'NONE',
      inviteOnly: false,
    });
  });

  it('protects registration with a 6-digit code, for teams, as a final, invite-only', async () => {
    const backend = createBackend();
    const screen = await renderScreen(CreateEventScreen, backend, { routes: manageRoute });
    await fillBasics(screen);
    await fireEvent.press(screen.getByTestId('org-visibility-PASSWORD'));
    expect(screen.getByText('Registration code: 065536')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('org-participants-TEAM'));
    await fireEvent.press(screen.getByTestId('org-participants-INDIVIDUAL'));
    await fireEvent.press(screen.getByTestId('org-label-FINAL'));
    await fireEvent(screen.getByTestId('org-invite-only'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('org-create'));

    expect(await screen.findByText('Manage page')).toBeTruthy();
    await expect(screen.services.api.get('/competitions/new1')).resolves.toMatchObject({
      eventStyle: 'FUNCTIONAL_FITNESS',
      visibility: 'PASSWORD',
      accessCode: '065536',
      participantTypes: ['TEAM'],
      label: 'FINAL',
      inviteOnly: true,
    });
  });

  it('copies the categories and WODs of a previous event, dates moved to the new one', async () => {
    let n = 0;
    const source = {
      ...event,
      id: 'old1',
      title: 'Spring Open',
      eventStart: '2026-05-10T08:00:00.000Z',
      workouts: [{ id: 'w1', number: 1, name: 'WOD 1', description: 'AMRAP 12', scoreType: 'REPS', submissionStart: '2026-05-10T08:00:00.000Z', submissionDeadline: '2026-05-11T08:00:00.000Z', variants: [{ categoryId: 'k2', description: 'Scaled' }] }],
    };
    const backend = createBackend()
      .on('GET', '/competitions', [200, [{ id: 'old1', title: 'Spring Open', status: 'FINISHED', myRoles: ['ORGANIZER'] }]])
      .on('GET', '/competitions/old1', [200, source])
      .on('POST', '/competitions/new1/categories', () => [201, { id: `n${++n}` }])
      .on('POST', '/competitions/new1/wods', [201, { id: 'nw1' }]);
    const screen = await renderScreen(CreateEventScreen, backend, { routes: manageRoute });
    await fireEvent.press(await screen.findByTestId('org-copy-old1'));
    // The source fills the form: its description, city and venue.
    await waitFor(() => expect(screen.getByTestId('org-description').props.value).toBe('Two days on site.'));
    expect(screen.getByTestId('org-city').props.value).toBe('Sousse');
    await fireEvent.changeText(screen.getByTestId('org-title'), 'Summer Open');
    await fireEvent.press(screen.getByTestId('org-create'));

    expect(await screen.findByText('Manage page')).toBeTruthy();
    expect(backend.calls('POST', '/competitions/new1/categories').map((c) => c.body.name)).toEqual(['RX Men', 'RX Women']);
    const wod = backend.calls('POST', '/competitions/new1/wods')[0].body;
    expect(wod.name).toBe('WOD 1');
    expect(wod.variants).toEqual([{ categoryId: 'n2', description: 'Scaled' }]);
    const shift = new Date(backend.calls('POST', '/competitions')[0].body.eventStart).getTime() - new Date('2026-05-10T08:00:00.000Z').getTime();
    expect(new Date(wod.submissionStart).getTime()).toBe(new Date('2026-05-10T08:00:00.000Z').getTime() + shift);
  });
});

describe('General: type, contact and links (phase 2)', () => {
  const draft = { ...event, status: 'DRAFT', workouts: [] };

  it('saves the contact and links on the device, and the checklist stops asking for a contact', async () => {
    const backend = orgBackend(draft).on('PUT', '/competitions/c9', [200, draft]);
    const screen = await renderScreen(() => <ManageScreen id="c9" />, backend);
    expect(await screen.findByTestId('check-CONTACT')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('check-CONTACT'));
    await fireEvent.changeText(await screen.findByTestId('org-contact-email'), 'hello@box.tn');
    await fireEvent.changeText(screen.getByTestId('org-instagram'), '@box.tn');
    await fireEvent.press(screen.getByTestId('org-save'));

    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9')).toHaveLength(1));
    expect(backend.calls('PUT', '/competitions/c9')[0].body).not.toHaveProperty('contactEmail');
    await expect(screen.services.api.get('/competitions/c9')).resolves.toMatchObject({ contactEmail: 'hello@box.tn', instagram: 'box.tn' });
  });

  it('refuses a wrong contact email before saving', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="general" />, orgBackend(draft));
    await fireEvent.changeText(await screen.findByTestId('org-contact-email'), 'hello@');
    expect(screen.getByText('Enter a valid email.')).toBeTruthy();
    expect(screen.getByTestId('org-save').props.accessibilityState?.disabled).toBe(true);
  });

  it('switches a draft without WODs to a hybrid race', async () => {
    const backend = orgBackend(draft).on('PUT', '/competitions/c9', [200, draft]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="general" />, backend);
    await fireEvent.press(await screen.findByTestId('org-style-HYBRID_RACE'));
    await fireEvent.press(screen.getByTestId('org-template-CUSTOM'));
    await fireEvent.press(screen.getByTestId('org-save'));
    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9')).toHaveLength(1));
    await expect(screen.services.api.get('/competitions/c9')).resolves.toMatchObject({ eventStyle: 'HYBRID_RACE', hybridTemplate: 'CUSTOM' });
  });

  it('locks the type once the event has a WOD', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="general" />, orgBackend(event));
    expect(await screen.findByText('The event type can’t change once the event has a WOD.')).toBeTruthy();
    expect(screen.getByTestId('org-style-HYBRID_RACE').props.accessibilityState?.disabled).toBe(true);
  });
});

describe('Settings page (phase 2)', () => {
  it('sits under General in the computer menu', () => {
    expect(ORG_MENU.find((s) => s.key === 'general')?.tabs).toContain('settings');
  });

  it('saves the settings on the device only', async () => {
    const backend = orgBackend(event);
    const screen = await renderScreen(() => <ManageScreen id="c9" />, backend);
    await fireEvent.press(await screen.findByTestId('org-tab-settings'));
    expect(screen.getByTestId('local-badge')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('org-set-max-teams'), '30');
    await fireEvent(screen.getByTestId('org-set-appeals'), 'valueChange', true);
    await fireEvent.changeText(await screen.findByTestId('org-set-appeal-price'), '15');
    await fireEvent.press(screen.getByTestId('org-settings-save'));

    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(backend.calls('PUT', '/competitions/c9')).toHaveLength(0);
    await expect(screen.services.api.get('/competitions/c9')).resolves.toMatchObject({ settings: { maxTeams: 30, appeals: { enabled: true, price: 15000 } } });
  });

  it('shows the emails it cannot read and keeps Save off', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="settings" />, orgBackend(event));
    await fireEvent(await screen.findByTestId('org-set-email-list'), 'valueChange', true);
    await fireEvent.changeText(await screen.findByTestId('org-set-emails'), 'a@x.tn\nnot-an-email');
    expect(screen.getByText('Not valid: not-an-email')).toBeTruthy();
    expect(screen.getByTestId('org-settings-save').props.accessibilityState?.disabled).toBe(true);
  });
});

describe('publication in both modes (phase 2)', () => {
  const ready = { ...event, status: 'DRAFT', contactEmail: 'hello@box.tn' };

  it.each(['FUNCTIONAL_FITNESS', 'HYBRID_RACE'])('a complete %s draft can be sent for publication', async (eventStyle) => {
    const c = { ...ready, eventStyle, hybridTemplate: eventStyle === 'HYBRID_RACE' ? 'HYROX_STYLE' : null };
    const backend = orgBackend(c).on('POST', '/competitions/c9/publication-request', [200, { ...c, publicationRequestedAt: '2026-10-22T10:00:00.000Z' }]);
    const screen = await renderScreen(() => <ManageScreen id="c9" />, backend);
    const request = await screen.findByTestId('org-request');
    expect(request.props.accessibilityState?.disabled).toBe(false);
    await fireEvent.press(request);
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/publication-request')).toHaveLength(1));
  });
});
