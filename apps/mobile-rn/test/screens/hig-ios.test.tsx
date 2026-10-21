import { Slot } from 'expo-router';
import { fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Fab, Icon, IconButton, Menu, Txt, useHeader } from '../../src/core/widgets/kit';
import { Select } from '../../src/core/widgets/pickers';
import { TABS } from '../../src/features/shell/tabs';
import { LeagueScreen } from '../../src/features/league/screen';
import { TrainScreen } from '../../src/features/workouts/screens';
import { FakeBackend } from '../fake-api';
import { page, renderScreen } from '../harness';

const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
/** In the navigation bar, not floating over the content. */
const inBar = (el: { props: { style?: unknown } }) => flat(el).position !== 'absolute';

// The jest platform is iOS; Android cases switch Platform.OS for one test.
const onAndroid = () => jest.replaceProperty(Platform, 'OS', 'android');
afterEach(() => jest.restoreAllMocks());

describe('tab bar (HIG Tab bars)', () => {
  it('keeps the five tabs, their order, labels and URLs, with filled SF Symbols', () => {
    expect(TABS.map((t) => [t.name, t.label, t.sf])).toEqual([
      ['index', 'navHome', 'house.fill'],
      ['train', 'navTrain', 'dumbbell.fill'],
      ['league', 'navLeague', 'trophy.fill'],
      ['goals', 'navChallenges', 'flag.fill'],
      ['profile', 'navProfile', 'person.fill'],
    ]);
  });
});

describe('SF Symbols (HIG Branding: familiar components)', () => {
  it('iOS draws the SF Symbol for a mapped icon and keeps Material for the others', async () => {
    const screen = await renderScreen(
      () => (
        <>
          <View testID="home">
            <Icon name="home" />
          </View>
          <View testID="chevron">
            <Icon name="chevron-right" color="#123456" size={18} />
          </View>
          <View testID="unmapped">
            <Icon name="gavel" />
          </View>
        </>
      ),
      new FakeBackend(),
    );
    const drawn = (id: string) => screen.getByTestId(id).children[0] as unknown as { type: string; props: Record<string, unknown> };
    expect([drawn('home').type, drawn('home').props.name]).toEqual(['ViewManagerAdapter_SymbolModule', 'house']);
    // chevron.forward follows the reading direction (it points left in Arabic).
    expect(drawn('chevron').props).toMatchObject({ name: 'chevron.forward', size: 18, tintColor: '#123456' });
    expect(drawn('unmapped').type).toBe('Text');
  });

  it('Android keeps Material icons', async () => {
    onAndroid();
    const screen = await renderScreen(
      () => (
        <View testID="home">
          <Icon name="home" />
        </View>
      ),
      new FakeBackend(),
    );
    expect((screen.getByTestId('home').children[0] as unknown as { type: string }).type).toBe('Text');
  });
});

describe('floating buttons become a « + » in the navigation bar on iOS', () => {
  it('a Fab is a header button with the same testID and its label', async () => {
    const onPress = jest.fn();
    const screen = await renderScreen(() => <Fab testID="goals-new" icon="flag" label="New goal" onPress={onPress} />, new FakeBackend(), { stack: true });
    const button = await screen.findByTestId('goals-new');
    expect(button.props.accessibilityLabel).toBe('New goal');
    expect(inBar(button)).toBe(true);
    expect(screen.queryByText('New goal')).toBeNull();
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalled();
  });

  it('Android keeps the floating button', async () => {
    onAndroid();
    const screen = await renderScreen(() => <Fab testID="goals-new" icon="flag" label="New goal" onPress={() => {}} />, new FakeBackend(), { stack: true });
    expect(await screen.findByText('New goal')).toBeTruthy();
  });

  it('Train logs a workout from the navigation bar', async () => {
    const backend = new FakeBackend().on('GET', '/workouts', [200, page([])]).on('GET', '/ref/sports', [200, []]);
    const screen = await renderScreen(TrainScreen, backend, { stack: true, routes: { 'workouts/new': () => <View testID="log-page" /> } });
    const plus = await screen.findByTestId('train-log');
    expect(plus.props.accessibilityLabel).toBe('Log workout');
    expect(inBar(plus)).toBe(true);
    expect(screen.getAllByTestId('train-log')).toHaveLength(1);
    await fireEvent.press(plus);
    expect(await screen.findByTestId('log-page')).toBeTruthy();
  });

  it('League: « jump to my rank » sits in the navigation bar and acts on the visible ranking; the leagues tab shows « + »', async () => {
    const row = { rank: 4, athlete: { id: 'u1', username: 'me', fullName: 'Me' }, gym: null, governorate: null, lp: 10, level: 1, division: 'BRONZE', movement: 0 };
    const backend = new FakeBackend()
      .on('GET', '/me', [200, { id: 'u1', profile: {} }])
      .on('GET', '/leaderboards/national', [200, page([row])])
      .on('GET', '/leaderboards/national/me', [200, page([row])])
      .on('GET', '/leaderboards/friends', [200, page([row])])
      .on('GET', '/leaderboards/friends/me', [200, page([row])])
      .on('GET', '/leagues', [200, { mine: [], public: [] }]);
    const screen = await renderScreen(LeagueScreen, backend, { stack: true });
    expect(inBar(await screen.findByTestId('jump-national'))).toBe(true);
    await fireEvent.press(screen.getByTestId('jump-national'));
    await waitFor(() => expect(backend.calls('GET', '/leaderboards/national/me')).toHaveLength(1));
    expect(screen.getByTestId('jump-national').props.accessibilityLabel).toBe('Jump to my rank');

    await fireEvent.press(screen.getByTestId('tab-friends'));
    await fireEvent.press(await screen.findByTestId('jump-friends'));
    await waitFor(() => expect(backend.calls('GET', '/leaderboards/friends/me')).toHaveLength(1));
    expect(backend.calls('GET', '/leaderboards/national/me')).toHaveLength(1);

    await fireEvent.press(screen.getByTestId('tab-leagues'));
    expect(inBar(await screen.findByTestId('league-new'))).toBe(true);
    expect(screen.queryByTestId('jump-friends')).toBeNull();
  });
});

describe('native menus on iOS (@expo/ui)', () => {
  it('the overflow menu is a native pull-down menu', async () => {
    const onPress = jest.fn();
    const screen = await renderScreen(() => <Menu testID="more" label="Actions" items={[{ label: 'Report', testID: 'report', onPress }]} />, new FakeBackend());
    expect(screen.getByTestId('more')).toBeTruthy();
    const item = screen.getByTestId('report');
    expect(item.props.label).toBe('Report');
    await fireEvent(item, 'buttonPress');
    expect(onPress).toHaveBeenCalled();
  });

  it('a short list opens a native pop-up menu; a long one keeps its list', async () => {
    const onChange = jest.fn();
    const days = [1, 2, 3, 4, 5, 6].map((d) => ({ value: String(d), label: String(d) }));
    const screen = await renderScreen(
      () => (
        <>
          <Select menu testID="days" label="Days" value="3" options={days} onChange={onChange} />
          <Select testID="city" label="City" value={null} options={days} onChange={() => {}} />
        </>
      ),
      new FakeBackend(),
    );
    const picker = screen.getByTestId('days');
    expect(picker.props.selection).toBe('3');
    await fireEvent(picker, 'selectionChange', { nativeEvent: { selection: '4' } });
    expect(onChange).toHaveBeenCalledWith('4');
    expect(screen.getByText('Days')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('city'));
    expect(screen.getByTestId('city-6')).toBeTruthy();
  });

  it('Android keeps the bottom-sheet menu', async () => {
    onAndroid();
    const onPress = jest.fn();
    const screen = await renderScreen(() => <Menu testID="more" label="Actions" items={[{ label: 'Report', testID: 'report', onPress }]} />, new FakeBackend());
    await fireEvent.press(screen.getByTestId('more'));
    await fireEvent.press(await screen.findByTestId('report'));
    expect(onPress).toHaveBeenCalled();
  });
});

describe('tab layouts', () => {
  // Explicit file names: jest resolves `_layout` to `_layout.ios` on its iOS platform.
  const load = (file: string) => jest.requireActual(`../../src/app/(tabs)/${file}`).default as () => React.JSX.Element;
  function Probe() {
    useHeader({ headerRight: () => <IconButton testID="probe-right" icon="settings" label="Settings" onPress={() => {}} /> });
    return <Txt>probe page</Txt>;
  }
  const boot = (tabs: string, folder: string) =>
    renderRouter(
      {
        _layout: () => (
          <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 400, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
            <Slot />
          </SafeAreaProvider>
        ),
        '(tabs)/_layout': load(tabs),
        '(tabs)/index': () => <Txt>home page</Txt>,
        '(tabs)/profile/_layout': load(folder),
        '(tabs)/profile/index': Probe,
      },
      { initialUrl: '/profile' },
    );

  it('Android and the web: a tab folder keeps the tab’s own header, and its screen still sets it', async () => {
    const screen = await boot('_layout.tsx', 'profile/_layout.tsx');
    expect(await screen.findByText('probe page')).toBeTruthy();
    expect(screen.getByTestId('probe-right')).toBeTruthy();
    expect(screen.getAllByText('Profile').length).toBeGreaterThan(0);
  });

  it('iOS: native tabs, and each tab has its own navigation bar', async () => {
    const screen = await boot('_layout.ios.tsx', 'profile/_layout.ios.tsx');
    expect(await screen.findByText('probe page')).toBeTruthy();
    expect(screen.getByTestId('probe-right')).toBeTruthy();
  });
});
