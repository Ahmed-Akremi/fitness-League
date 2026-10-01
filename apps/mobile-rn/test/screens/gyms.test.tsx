import { fireEvent, waitFor } from 'expo-router/testing-library';

import { GymWarView } from '../../src/features/gym-wars/screens';
import { CreateWodScreen, WodScreen } from '../../src/features/gym-wods/screens';
import { CreateGymScreen, GymProfileScreen, GymsScreen } from '../../src/features/gyms/screens';
import { FakeBackend } from '../fake-api';
import { page, renderScreen, sports } from '../harness';

const gym = {
  id: 'g1',
  name: 'Iron Box',
  verified: true,
  city: { en: 'Sousse' },
  membersCount: 0,
  sports: [{ code: 'CROSSFIT', name: { en: 'CrossFit' } }],
  myMembership: { status: 'NONE' },
  canManage: false,
  topAthletes: [{ username: 'sami', fullName: 'Sami', lp: 900 }],
};

const ref = (backend: FakeBackend) =>
  backend
    .on('GET', '/ref/sports', [200, [...sports, { id: 'sp-cf', code: 'CROSSFIT', category: 'FUNCTIONAL', name: { en: 'CrossFit' } }]])
    .on('GET', '/ref/governorates', [200, [{ id: 'gov1', name: { en: 'Sousse' } }]])
    .on('GET', '/ref/cities', [200, [{ id: 'city1', name: { en: 'Sousse Médina' } }]]);

describe('gym directory', () => {
  it('lists gyms (0 members, not 1) and searches by name', async () => {
    const backend = ref(new FakeBackend()).on('GET', '/gyms', (req) => [200, page(req.query.get('q') === 'zzz' ? [] : [gym])]);
    const screen = await renderScreen(GymsScreen, backend);
    expect(await screen.findByText('Iron Box')).toBeTruthy();
    expect(screen.getByText('0 members')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('gym-search'), 'zzz');
    await waitFor(() => expect(backend.calls('GET', '/gyms').some((r) => r.query.get('q') === 'zzz')).toBe(true));
  });
});

describe('gym profile', () => {
  it('shows the gym and joins it', async () => {
    const backend = new FakeBackend()
      .on('GET', '/gyms/g1', [200, gym])
      .on('GET', '/gyms/g1/wars', [200, { record: { wins: 0, losses: 0, draws: 0 }, rating: 1000, data: [], enrolled: true }])
      .on('POST', '/gyms/g1/membership', [201, {}]);
    const screen = await renderScreen(() => <GymProfileScreen id="g1" />, backend);
    expect(await screen.findByText('Sami')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('gym-join'));
    await waitFor(() => expect(backend.calls('POST', '/gyms/g1/membership')).toHaveLength(1));
  });
});

describe('gym submission', () => {
  async function fill(screen: Awaited<ReturnType<typeof renderScreen>>) {
    await fireEvent.press(screen.getByTestId('gym-photo'));
    await fireEvent.changeText(screen.getByTestId('gym-name'), 'Iron Box');
    await fireEvent.press(screen.getByTestId('gym-governorate'));
    await fireEvent.press(await screen.findByTestId('gym-governorate-gov1'));
    await fireEvent.press(screen.getByTestId('gym-city'));
    await fireEvent.press(await screen.findByTestId('gym-city-city1'));
    await fireEvent.changeText(screen.getByTestId('gym-proof'), 'Owner since 2019, see RNE 123');
  }

  it('keeps submit off until valid, then creates the gym and uploads the photo', async () => {
    const backend = ref(new FakeBackend()).on('POST', '/gyms', [201, { id: 'g9' }]).on('PUT', '/gyms/g9/logo', [200, {}]);
    const pick = async () => ({ file: { uri: 'file:///logo.png', name: 'logo.png', type: 'image/png' } });
    const screen = await renderScreen(() => <CreateGymScreen pick={pick} />, backend);
    expect(screen.getByTestId('gym-submit').props.accessibilityState.disabled).toBe(true);
    await fill(screen);
    await fireEvent.press(screen.getByTestId('gym-submit'));
    expect(await screen.findByText(/waiting for approval/)).toBeTruthy();
    expect(backend.calls('POST', '/gyms')[0].body).toEqual({ name: 'Iron Box', governorateId: 'gov1', cityId: 'city1', proofOfOwnership: 'Owner since 2019, see RNE 123' });
    expect(backend.calls('PUT', '/gyms/g9/logo')).toHaveLength(1);
  });

  it('a failed photo upload keeps the created gym and retries only the photo', async () => {
    let attempts = 0;
    const backend = ref(new FakeBackend())
      .on('POST', '/gyms', [201, { id: 'g9' }])
      .on('PUT', '/gyms/g9/logo', () => (++attempts === 1 ? [415, { code: 'UNSUPPORTED' }] : [200, {}]));
    const pick = async () => ({ file: { uri: 'file:///logo.gif', name: 'logo.gif', type: 'image/gif' } });
    const screen = await renderScreen(() => <CreateGymScreen pick={pick} />, backend);
    await fill(screen);
    await fireEvent.press(screen.getByTestId('gym-submit'));
    await fireEvent.press(await screen.findByTestId('gym-photo-retry'));
    await waitFor(() => expect(screen.queryByTestId('gym-photo-retry')).toBeNull());
    expect(backend.calls('POST', '/gyms')).toHaveLength(1);
    expect(backend.calls('PUT', '/gyms/g9/logo')).toHaveLength(2);
  });
});

describe('gym WODs', () => {
  const wod = { id: 'w1', title: 'Fran', description: '21-15-9', scoreType: 'FOR_TIME', timeCapS: 600, status: 'PUBLISHED', isOpen: true, endsAt: '2099-01-01T00:00:00Z', myScore: null };
  const wodBackend = (score = (): [number, unknown] => [200, {}]) =>
    new FakeBackend()
      .on('GET', '/me', [200, { id: 'u1', username: 'ahmed', profile: {} }])
      .on('GET', '/gyms/g1', [200, { ...gym, myMembership: { status: 'APPROVED', role: 'MEMBER' } }])
      .on('GET', '/gyms/g1/wods/w1', [200, wod])
      .on('GET', '/gyms/g1/wods/w1/leaderboard', [200, page([{ rank: 1, scoreId: 's1', value: 290, athlete: { id: 'u2', fullName: 'Karim' } }])])
      .on('PUT', '/gyms/g1/wods/w1/score', score);

  it('shows the board and submits a time', async () => {
    const backend = wodBackend();
    const screen = await renderScreen(() => <WodScreen gymId="g1" wodId="w1" />, backend);
    expect(await screen.findByText('4:50')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('wod-score'));
    await fireEvent.changeText(await screen.findByTestId('wod-time'), '4:58');
    await fireEvent.press(screen.getByTestId('wod-score-save'));
    await waitFor(() => expect(backend.calls('PUT', '/gyms/g1/wods/w1/score')).toHaveLength(1));
    expect(backend.calls('PUT', '/gyms/g1/wods/w1/score')[0].body).toMatchObject({ division: 'RX', timeS: 298 });
  });

  it('retrying a failed score submission reuses the same clientId', async () => {
    let attempts = 0;
    const backend = wodBackend(() => (++attempts === 1 ? [500, { code: 'INTERNAL' }] : [200, {}]));
    const screen = await renderScreen(() => <WodScreen gymId="g1" wodId="w1" />, backend);
    await fireEvent.press(await screen.findByTestId('wod-score'));
    await fireEvent.changeText(await screen.findByTestId('wod-time'), '4:58');
    await fireEvent.press(screen.getByTestId('wod-score-save'));
    await waitFor(() => expect(attempts).toBe(1));
    await fireEvent.press(await screen.findByTestId('wod-score-save'));
    await waitFor(() => expect(attempts).toBe(2));
    const [first, second] = backend.calls('PUT', '/gyms/g1/wods/w1/score').map((r) => r.body.clientId);
    expect(second).toBe(first);
  });

  it('members cannot invalidate (no long-press action)', async () => {
    const screen = await renderScreen(() => <WodScreen gymId="g1" wodId="w1" />, wodBackend());
    const row = await screen.findByLabelText('Rank 1, Karim, 4:50');
    expect(row.props.onLongPress).toBeUndefined();
  });

  it('MAX_LOAD never sends a cap', async () => {
    const backend = ref(new FakeBackend()).on('POST', '/gyms/g1/wods', [201, { id: 'w2' }]);
    const screen = await renderScreen(() => <CreateWodScreen gymId="g1" />, backend);
    await fireEvent.changeText(screen.getByTestId('wod-title'), 'Max clean');
    await fireEvent.changeText(screen.getByTestId('wod-description'), '1RM clean in 15 min');
    await fireEvent.press(screen.getByTestId('tab-MAX_LOAD'));
    await fireEvent.press(screen.getByTestId('wod-save'));
    await waitFor(() => expect(backend.calls('POST', '/gyms/g1/wods')).toHaveLength(1));
    const body = backend.calls('POST', '/gyms/g1/wods')[0].body;
    expect(body).toMatchObject({ title: 'Max clean', scoreType: 'MAX_LOAD' });
    expect(body).not.toHaveProperty('timeCapS');
  });
});

describe('gym war', () => {
  it('shows both gyms, my gym first, with the live breakdown', async () => {
    const war = {
      id: 'war1',
      status: 'ACTIVE',
      endsAt: '2099-01-01T00:00:00Z',
      gyms: [
        { gymId: 'g2', name: 'Rival Gym', city: { en: 'Tunis' }, score: 40.2, isMine: false, breakdown: { topK: 30 }, activeMembers: 5, eligibleMembers: 9 },
        { gymId: 'g1', name: 'Iron Box', city: { en: 'Sousse' }, score: 55.5, isMine: true, breakdown: { topK: 42 }, activeMembers: 7, eligibleMembers: 10 },
      ],
    };
    const screen = await renderScreen(() => <GymWarView war={war} />, new FakeBackend());
    expect(screen.getByText('55.5')).toBeTruthy();
    expect(screen.getByText('7/10')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    const names = screen.getAllByText(/Iron Box|Rival Gym/).map((n) => n.props.children);
    expect(names[0]).toBe('Iron Box');
  });
});
