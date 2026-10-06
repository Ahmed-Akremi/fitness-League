import { fireEvent, waitFor } from 'expo-router/testing-library';

import { translate } from '../../src/core/i18n';
import { HomeScreen } from '../../src/features/home/screen';
import { notificationRoute, notificationText } from '../../src/features/notifications/api';
import { FakeBackend } from '../fake-api';
import { page, renderScreen } from '../harness';

const me = {
  id: 'u1',
  username: 'ahmed',
  emailVerified: true,
  profile: { fullName: 'Ahmed Akremi', onboardingCompleted: true, governorate: { id: 'g', name: { en: 'Sousse' } }, gym: null },
  stats: { level: 7, xpIntoLevel: 40, xpForNextLevel: 100, division: 'SILVER' },
  streak: { currentWeeks: 3 },
};

const news = { id: 'a1', body: 'Final this Saturday in Tunis', imageUrl: null, imageWidth: null, imageHeight: null, createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), likeCount: 3, likedByMe: false };

function home(backend = new FakeBackend()) {
  return backend
    .on('GET', '/me', [200, me])
    .on('GET', '/me/lp', [200, { lp: 1234, division: 'GOLD' }])
    .on('GET', '/me/ranks', [200, { national: 12, governorate: 3 }])
    .on('GET', '/me/weekly-scores/current', [200, { total: 71.6, trainingDays: 2, plannedDays: 3 }])
    .on('GET', '/goals', [200, []])
    .on('GET', '/notifications', [200, { ...page([]), unread: 0 }]);
}

describe('home news', () => {
  it('shows the admin news and toggles a like', async () => {
    let liked = false;
    const backend = home()
      .on('GET', '/announcements', [200, page([news])])
      .on('PUT', '/announcements/a1/like', () => {
        liked = true;
        return [200, { likeCount: 4, likedByMe: true }];
      })
      .on('DELETE', '/announcements/a1/like', () => {
        liked = false;
        return [200, { likeCount: 3, likedByMe: false }];
      });
    const screen = await renderScreen(HomeScreen, backend);

    expect(await screen.findByText('Final this Saturday in Tunis')).toBeTruthy();
    expect(screen.getByText('News')).toBeTruthy();
    expect(screen.getByText('2 hours ago')).toBeTruthy();
    expect(screen.getByTestId('news-like-a1-count').props.children).toBe('3');

    await fireEvent.press(screen.getByTestId('news-like-a1'));
    await waitFor(() => expect(screen.getByTestId('news-like-a1-count').props.children).toBe('4'));
    expect(backend.calls('PUT', '/announcements/a1/like')).toHaveLength(1);
    expect(liked).toBe(true);

    await fireEvent.press(screen.getByTestId('news-like-a1'));
    await waitFor(() => expect(screen.getByTestId('news-like-a1-count').props.children).toBe('3'));
    expect(backend.calls('DELETE', '/announcements/a1/like')).toHaveLength(1);
    // Athletes can only like: there is no comment field.
    expect(screen.queryByPlaceholderText(/comment/i)).toBeNull();
  });

  it('keeps the home screen usable when there is no news', async () => {
    const screen = await renderScreen(HomeScreen, home().on('GET', '/announcements', [200, page([])]));
    expect(await screen.findByText('1234')).toBeTruthy();
    expect(screen.queryByText('News')).toBeNull();
  });

  it('describes a news notification and opens the home screen', () => {
    const n = { type: 'ANNOUNCEMENT', payload: { announcementId: 'a1', excerpt: 'Final this Saturday' } };
    expect(notificationText((k, a) => translate('en', k, a), 'en', n)).toBe('News: Final this Saturday');
    expect(notificationText((k, a) => translate('fr', k, a), 'fr', n)).toBe('Nouvelle actualité : Final this Saturday');
    expect(notificationRoute(n)).toBe('/');
  });
});
