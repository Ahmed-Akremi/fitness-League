import { fireEvent } from 'expo-router/testing-library';
import { Dimensions, StyleSheet } from 'react-native';

import { displayText, fonts } from '../../src/core/theme';
import { Chip, Txt } from '../../src/core/widgets/kit';
import { Select } from '../../src/core/widgets/pickers';
import { HomeScreen } from '../../src/features/home/screen';
import { LogWorkoutScreen } from '../../src/features/workouts/log-workout';
import { FakeBackend } from '../fake-api';
import { page, renderScreen, sports } from '../harness';

const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

describe('Dynamic Type (HIG Typography)', () => {
  it('body text is 17 pt, small 15, title 19', async () => {
    const screen = await renderScreen(
      () => (
        <>
          <Txt testID="body">body</Txt>
          <Txt testID="small" variant="small">small</Txt>
          <Txt testID="title" variant="title">title</Txt>
        </>
      ),
      new FakeBackend(),
    );
    expect([flat(screen.getByTestId('body')).fontSize, flat(screen.getByTestId('small')).fontSize, flat(screen.getByTestId('title')).fontSize]).toEqual([17, 15, 19]);
  });

  it('big display numbers grow up to 1.4×; other text scales without a cap', async () => {
    const screen = await renderScreen(
      () => (
        <>
          <Txt testID="lp" style={displayText(56)}>1234</Txt>
          <Txt testID="semi" style={{ fontFamily: fonts.displaySemi }}>12</Txt>
          <Txt testID="headline" variant="headline">Title</Txt>
          <Txt testID="own" style={displayText(40)} maxFontSizeMultiplier={2}>9</Txt>
          <Txt testID="body">body</Txt>
        </>
      ),
      new FakeBackend(),
    );
    const cap = (id: string) => screen.getByTestId(id).props.maxFontSizeMultiplier;
    expect([cap('lp'), cap('semi'), cap('headline'), cap('own'), cap('body')]).toEqual([1.4, 1.4, 1.4, 2, undefined]);
    expect(screen.getByTestId('body').props.allowFontScaling).not.toBe(false);
  });

  // React Native's jest setup reports a text scale of 2: each case sets the one it needs.
  const base = Dimensions.get('window');
  const textScale = (fontScale: number) => Dimensions.set({ window: { ...base, fontScale }, screen: { ...base, fontScale } });
  afterAll(() => Dimensions.set({ window: base, screen: base }));

  describe('at the largest text sizes', () => {
    beforeAll(() => textScale(2));

    it('the three Home tiles stack and their labels may wrap', async () => {
      const backend = new FakeBackend()
        .on('GET', '/me', [200, { id: 'u1', username: 'a', emailVerified: true, profile: { fullName: 'Ahmed', onboardingCompleted: true, governorate: { id: 'g', name: { en: 'Sousse' } } }, stats: {}, streak: {} }])
        .on('GET', '/me/ranks', [200, { national: 12, governorate: 3 }])
        .on('GET', '/goals', [200, []])
        .on('GET', '/notifications', [200, { ...page([]), unread: 0 }]);
      const screen = await renderScreen(HomeScreen, backend);
      expect(flat(await screen.findByTestId('home-tiles')).flexDirection).toBe('column');
      expect(screen.getByText('Tunisia').props.numberOfLines).toBe(2);
    });
  });

  it('at the default size the Home tiles stay in a row', async () => {
    textScale(1);
    const backend = new FakeBackend()
      .on('GET', '/me', [200, { id: 'u1', username: 'a', emailVerified: true, profile: { fullName: 'Ahmed', onboardingCompleted: true }, stats: {}, streak: {} }])
      .on('GET', '/goals', [200, []])
      .on('GET', '/notifications', [200, { ...page([]), unread: 0 }]);
    const screen = await renderScreen(HomeScreen, backend);
    expect(flat(await screen.findByTestId('home-tiles')).flexDirection).toBe('row');
  });

  it('the workout duration field has no fixed width', async () => {
    const backend = new FakeBackend().on('GET', '/ref/sports', [200, sports]).on('GET', '/me', [200, {}]);
    const screen = await renderScreen(LogWorkoutScreen, backend);
    const field = (await screen.findByTestId('log-duration')).parent!.parent!;
    expect(flat(field)).toMatchObject({ flex: 1, minWidth: 96 });
    expect(flat(field).width).toBeUndefined();
  });
});

describe('touch targets reach 44 pt', () => {
  it('chips keep their 32 pt look and add 6 pt above and below', async () => {
    const screen = await renderScreen(() => <Chip testID="chip" label="3" onPress={() => {}} />, new FakeBackend());
    expect(screen.getByTestId('chip').props.hitSlop).toEqual({ top: 6, bottom: 6 });
  });

  it('the picker’s close button', async () => {
    const screen = await renderScreen(() => <Select testID="pick" label="Sport" value={null} options={[{ value: 'a', label: 'A' }]} onChange={() => {}} />, new FakeBackend());
    await fireEvent.press(screen.getByTestId('pick'));
    expect(screen.getByLabelText('Cancel').props.hitSlop).toBe(11);
  });
});
