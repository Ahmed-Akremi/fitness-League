import { fireEvent, waitFor } from 'expo-router/testing-library';

import { FeedScreen } from '../../src/features/feed/screen';
import { FriendsScreen, PublicProfileScreen, SearchScreen } from '../../src/features/social/screens';
import { FakeBackend } from '../fake-api';
import { page, renderScreen } from '../harness';

const sami = { id: 'u9', username: 'sami', fullName: 'Sami Ben Ali', level: 4 };

describe('friends', () => {
  it('lists friends and accepts an incoming request', async () => {
    const backend = new FakeBackend()
      .on('GET', '/friends', [200, [{ id: 'u2', username: 'karim', fullName: 'Karim', level: 2 }]])
      .on('GET', '/friends/requests', (req) => [200, req.query.get('direction') === 'in' ? [sami] : []])
      .on('POST', '/friends/requests/u9/accept', [200, {}]);
    const screen = await renderScreen(FriendsScreen, backend);
    expect(await screen.findByText('Karim')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('tab-requests'));
    expect(await screen.findByText('Sami Ben Ali')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Accept'));
    await waitFor(() => expect(backend.calls('POST', '/friends/requests/u9/accept')).toHaveLength(1));
  });
});

describe('public profile', () => {
  it('shows the athlete and sends a friend request', async () => {
    const backend = new FakeBackend()
      .on('GET', '/me', [200, { id: 'u1', username: 'ahmed', profile: {} }])
      .on('GET', '/users/sami', [200, { ...sami, division: 'GOLD', seasonLp: 420, followers: 7, friendship: 'NONE' }])
      .on('POST', '/friends/requests', [201, {}]);
    const screen = await renderScreen(() => <PublicProfileScreen username="sami" />, backend);
    expect(await screen.findByText('420')).toBeTruthy();
    expect(screen.getByText('GOLD')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('profile-add-friend'));
    await waitFor(() => expect(backend.calls('POST', '/friends/requests')[0]?.body).toEqual({ userId: 'u9' }));
  });
});

describe('search', () => {
  it('waits for 2 characters then lists athletes', async () => {
    const backend = new FakeBackend().on('GET', '/search/athletes', [200, page([sami])]);
    const screen = await renderScreen(SearchScreen, backend);
    await fireEvent.changeText(screen.getByTestId('search-input'), 's');
    expect(screen.getByText('Name or username (2 letters min.)')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('search-input'), 'sa');
    expect(await screen.findByText('Sami Ben Ali')).toBeTruthy();
    expect(backend.calls('GET', '/search/athletes').map((r) => r.query.get('q'))).toEqual(['sa']);
  });
});

describe('feed', () => {
  const activity = {
    id: 'a1',
    type: 'PR',
    createdAt: '2026-09-30T08:00:00Z',
    user: { id: 'u9', username: 'sami', fullName: 'Sami Ben Ali' },
    details: { exercise: { en: 'Back squat' }, value: 140 },
    reactions: { LIKE: 1, FIRE: 0, STRONG: 0 },
    myReaction: null,
    comments: 0,
    isMine: false,
  };

  it("shows friends' activity, reacts and reports", async () => {
    const backend = new FakeBackend()
      .on('GET', '/feed', [200, page([activity])])
      .on('PUT', '/activities/a1/reactions', [200, { reactions: { LIKE: 1, FIRE: 1, STRONG: 0 }, myReaction: 'FIRE' }])
      .on('POST', '/reports', [201, {}]);
    const screen = await renderScreen(FeedScreen, backend);
    expect(await screen.findByText('new record on Back squat: 140')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('react-a1-FIRE'));
    expect(await screen.findByText('🔥 1')).toBeTruthy();
    expect(backend.calls('PUT', '/activities/a1/reactions')[0].body).toEqual({ type: 'FIRE' });

    await fireEvent.press(screen.getByLabelText('Report'));
    await fireEvent.press(await screen.findByText('Report'));
    await fireEvent.press(await screen.findByTestId('reason-CHEATING'));
    await fireEvent.press(screen.getByTestId('report-send'));
    await waitFor(() => expect(backend.calls('POST', '/reports')[0]?.body).toEqual({ targetType: 'USER', targetId: 'u9', reason: 'CHEATING' }));
  });

  it('invites to find athletes when the feed is empty', async () => {
    const screen = await renderScreen(FeedScreen, new FakeBackend().on('GET', '/feed', [200, page([])]));
    expect(await screen.findByText('Find athletes')).toBeTruthy();
  });
});
