import { StyleSheet } from 'react-native';

import { config } from '../../src/core/config';
import { palettes } from '../../src/core/theme';
import { HomeScreen } from '../../src/features/home/screen';
import { FakeBackend } from '../fake-api';
import { page, renderScreen } from '../harness';

const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

describe('identity (owner, Q4 and Q5)', () => {
  it('Elite is violet: lime now means « action » only (HIG Color: one meaning per colour)', () => {
    expect(palettes.dark(config.accent).tier.ELITE).toBe('#C084FC');
    expect(palettes.light(config.accent).tier.ELITE).toBe('#7E3FBF');
  });

  const home = (lp: object) =>
    new FakeBackend()
      .on('GET', '/me', [200, { id: 'u1', username: 'a', emailVerified: true, profile: { fullName: 'Ahmed', onboardingCompleted: true }, stats: { level: 3, xpIntoLevel: 50, xpForNextLevel: 100 }, streak: {} }])
      .on('GET', '/me/lp', [200, lp])
      .on('GET', '/goals', [200, []])
      .on('GET', '/notifications', [200, { ...page([]), unread: 0 }]);

  it('the home card fills its bar with the division colour and says how far the next division is', async () => {
    const screen = await renderScreen(HomeScreen, home({ lp: 1240, division: 'GOLD', nextDivision: 'PLATINUM', lpToNextDivision: 160 }));
    expect(await screen.findByText('160 LP to Platinum')).toBeTruthy();
    const fill = screen.getByTestId('home-xp-fill');
    expect(flat(fill).backgroundColor).toBe(palettes.dark(config.accent).tier.GOLD);
  });

  it('without a next division (Elite) or an older server, nothing is added', async () => {
    const screen = await renderScreen(HomeScreen, home({ lp: 9000, division: 'ELITE', nextDivision: null, lpToNextDivision: null }));
    expect(await screen.findByText('9000')).toBeTruthy();
    expect(screen.queryByText(/LP to/)).toBeNull();
  });

  it('« Log workout » sits in Home’s top bar next to the bell; the Shortcuts row stays, its records tile in one word', async () => {
    const screen = await renderScreen(HomeScreen, home({ lp: 10, division: 'BRONZE' }));
    const plus = await screen.findByTestId('home-log-workout');
    expect(plus.props.accessibilityLabel).toBe('Log workout');
    expect(screen.queryByText('Log workout')).toBeNull();
    expect(screen.getByText('Shortcuts')).toBeTruthy();
    expect(screen.getByText('Records')).toBeTruthy();
    expect(screen.queryByText('Personal records')).toBeNull();
  });
});
