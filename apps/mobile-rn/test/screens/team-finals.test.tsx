import { fireEvent, waitFor } from 'expo-router/testing-library';
import { useEffect, useState, type ReactElement } from 'react';
import { Text } from 'react-native';

import type { ApiClient } from '../../src/core/api/client';
import { useApi } from '../../src/core/services';
import { FinalsInvitationCard } from '../../src/features/competitions/finals';
import { RegisterScreen } from '../../src/features/competitions/screens';
import { TeamScreen } from '../../src/features/competitions/team';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

/** Saves local data first, as the organizer's Roster did. */
function Seeded({ seed, children }: { seed: (api: ApiClient) => Promise<unknown>; children: ReactElement }) {
  const api = useApi();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void seed(api).then(() => setReady(true));
  }, [api, seed]);
  return ready ? children : null;
}

const teamEvent = (k: object) => ({
  id: 'c1',
  title: 'Sousse Throwdown',
  currency: 'TND',
  eventStart: inDays(30),
  categories: [{ id: 'k1', name: 'RX Pairs', active: true, type: 'TEAM', teamMale: 1, teamFemale: 1, ...k }],
  myRegistration: { id: 'r1', categoryId: 'k1', registrationStatus: 'CONFIRMED', teamName: 'Box Bandits', teamMembers: ['mate@x.tn'] },
});
const me = { id: 'u1', username: 'sami', email: 'sami@x.tn', profile: { fullName: 'Sami Ben Ali' } };

describe('my team (Circle21 « Team »)', () => {
  it('changes the name and a member within the deadlines, with the fee and « one member stays »', async () => {
    const c = teamEvent({ memberChangeUntil: inDays(5), memberChangePrice: 10000 });
    const backend = new FakeBackend().on('GET', '/competitions/c1', [200, c]).on('GET', '/me', [200, me]);
    const screen = await renderScreen(() => <TeamScreen id="c1" />, backend);
    expect(await screen.findByText(/Team members can be added or changed until/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('team-member-0'), 'sami@x.tn');
    expect(screen.getByText('That’s your email address: you’re already the captain.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('team-member-0'), 'new@x.tn');
    expect(screen.getByText(/Changing a member costs a fee: TND 10/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('team-name'), 'Box Bandits 2');
    await fireEvent.press(screen.getByTestId('team-save'));
    expect(await screen.findByText('Team saved.')).toBeTruthy();
    await waitFor(async () => expect(await screen.services.api.get('/competitions/c1')).toMatchObject({ myRegistration: { teamName: 'Box Bandits 2', teamMembers: ['new@x.tn'] } }));
  });

  it('locks what can no longer change', async () => {
    const c = teamEvent({ teamNameChangeUntil: inDays(-2), memberChangeUntil: inDays(-1) });
    const backend = new FakeBackend().on('GET', '/competitions/c1', [200, c]).on('GET', '/me', [200, me]);
    const screen = await renderScreen(() => <TeamScreen id="c1" />, backend);
    expect(await screen.findByText('Team details can’t be changed anymore.')).toBeTruthy();
    expect(screen.getByText(/The deadline for adding or changing team members expired/)).toBeTruthy();
    expect(screen.queryByTestId('team-save')).toBeNull();
  });
});

describe('finals invitation (Circle21 « Special invitation »)', () => {
  const final = { id: 'c1', title: 'Grand Final', inviteOnly: true, settings: { invitedEmails: [] }, categories: [{ id: 'k1', name: 'RX', active: true, price: 0 }], myRegistration: null, status: 'REGISTRATION_OPEN' };
  const seed = (api: ApiClient) => api.post('/competitions/c1/finalist-invitations', { id: 'q1:u1', userId: 'u1', name: 'Sami', rank: 3, categoryName: 'RX Men', status: 'INVITED' });

  it('accepts the invitation, then opens the registration', async () => {
    const backend = new FakeBackend().on('GET', '/me', [200, me]);
    const screen = await renderScreen(() => <Seeded seed={seed}><FinalsInvitationCard c={final} /></Seeded>, backend, { routes: { 'competitions/[id]/register': () => <Text>Register page</Text> } });
    expect(await screen.findByText('You finished #3 in RX Men: you’re in the finals!')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('finals-accept'));
    expect(await screen.findByText('Register page')).toBeTruthy();
    await expect(screen.services.api.get('/competitions/c1/finalist-invitations')).resolves.toEqual([expect.objectContaining({ status: 'ACCEPTED' })]);
  });

  it('lets an invited finalist into an invite-only registration; others see why they cannot', async () => {
    const backend = new FakeBackend().on('GET', '/competitions/c1', [200, final]).on('GET', '/me', [200, me]);
    const invited = await renderScreen(() => <Seeded seed={seed}><RegisterScreen id="c1" /></Seeded>, backend);
    expect(await invited.findByTestId('cat-k1')).toBeTruthy();
    invited.unmount();
    const other = await renderScreen(() => <RegisterScreen id="c1" />, new FakeBackend().on('GET', '/competitions/c1', [200, final]).on('GET', '/me', [200, { ...me, id: 'u9' }]));
    expect(await other.findByText('Invited athletes only')).toBeTruthy();
    expect(other.getByText('Make sure you’re signed in with the email where you received the invitation.')).toBeTruthy();
  });
});
