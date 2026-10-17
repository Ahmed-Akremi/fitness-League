import { router, Stack } from 'expo-router';
import { act, fireEvent, renderRouter, waitFor, within } from 'expo-router/testing-library';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { setAuthStatus } from '../../src/core/auth/session';
import { setKeyboardModality, useFocusRing } from '../../src/core/focus';
import { usePrefs } from '../../src/core/prefs';
import { appStateFocus, ServicesProvider } from '../../src/core/services';
import { SkeletonList } from '../../src/core/widgets/common';
import { Checkbox, ToastHost, Txt } from '../../src/core/widgets/kit';
import { SidePanel } from '../../src/core/widgets/panel';
import { DataTable } from '../../src/core/widgets/table';
import { SearchField, SegmentedInline } from '../../src/core/widgets/web';
import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { boardFileName, toSlug } from '../../src/features/competitions/organizer/logic-web';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { FakeBackend } from '../fake-api';
import { fakeServices, renderScreen, testQueryClient } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';
import { setWide } from '../wide-web';

jest.mock('../../src/features/competitions/organizer/web', () => ({
  ...jest.requireActual('../../src/features/competitions/organizer/web'),
  useWideWeb: () => require('../wide-web').useWide(),
}));

const open = (tab: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;
const heats = [{ id: 'h1', number: 1, name: 'Heat 1', startsAt: '2026-12-12T10:00:00.000Z', durationMin: 12, laneCount: 4, workout: null, category: null, lanes: [] }];
const board = { status: 'REGISTRATION_OPEN', provisional: true, rows: [{ rank: 1, athlete: { id: 'u-r3', fullName: 'Hédi Kéfi', username: 'hedi' }, totalPoints: 180, pending: 0 }] };
const SERVER = 'Something went wrong on our side. Try again later.';
// renderRouter installs jest's fake timers: React Query's interval moves with jest.advanceTimersByTime.
const wait = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

describe('lot Web 3 review: a failed 30 s reload keeps the page', () => {
  it('Planning: the heat being edited keeps what was typed', async () => {
    setWide(false);
    let n = 0;
    const b = orgBackend().on('GET', '/competitions/c9/heats', () => (++n === 2 ? [500, { code: 'INTERNAL' }] : [200, heats]));
    const screen = await renderScreen(open('planning'), b);
    await fireEvent.press(await screen.findByLabelText('Edit the heat'));
    await fireEvent.changeText(screen.getByTestId('heat-name'), 'Final A');
    await wait(30_000);
    await waitFor(() => expect(n).toBe(2));
    expect(screen.getByTestId('heat-name').props.value).toBe('Final A');
    await wait(30_000);
    await waitFor(() => expect(n).toBe(3));
    expect(screen.getByTestId('heat-name').props.value).toBe('Final A');
  });

  it('Horaire du jour: the clock and « Retard » stay, the error shows above them', async () => {
    setWide(true);
    let n = 0;
    const b = orgBackend().on('GET', '/competitions/c9/heats', () => (++n === 2 ? [500, { code: 'INTERNAL' }] : [200, heats]));
    const screen = await renderScreen(open('timetable'), b);
    await screen.findByTestId('sched-clock');
    await wait(30_000);
    await waitFor(() => expect(n).toBe(2));
    expect(await screen.findByText(SERVER)).toBeTruthy();
    expect(screen.getByTestId('sched-clock')).toBeTruthy();
    expect(screen.getByTestId('delay')).toBeTruthy();
  });

  it('Classement: the rows and the search being typed stay', async () => {
    setWide(false);
    let n = 0;
    const b = orgBackend().on('GET', '/competitions/c9/leaderboard', () => (++n === 2 ? [500, { code: 'INTERNAL' }] : [200, board]));
    const screen = await renderScreen(open('leaderboard'), b);
    await fireEvent.changeText(await screen.findByTestId('board-search'), 'kef');
    await wait(30_000);
    await waitFor(() => expect(n).toBe(2));
    expect(await screen.findByText(SERVER)).toBeTruthy();
    expect(screen.getByTestId('board-search').props.value).toBe('kef');
    expect(screen.getByTestId('board-u-r3')).toBeTruthy();
  });
});

describe('lot Web 3 review: no reload under a page pushed on top', () => {
  it('« Aperçu » pushed on top of Horaire du jour stops its 30 s reload', async () => {
    setWide(true);
    usePrefs.setState({ locale: 'en', themeMode: 'dark' });
    setAuthStatus('signedIn');
    const b = orgBackend().on('GET', '/competitions/c9/heats', [200, heats]);
    const services = fakeServices(b);
    // A Stack, as the app's root: the harness's <Slot /> would unmount the covered page.
    const Layout = () => (
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 1440, height: 900 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <ServicesProvider services={services} queryClient={testQueryClient()}>
          <Stack />
          <ToastHost />
        </ServicesProvider>
      </SafeAreaProvider>
    );
    const screen = await renderRouter({ _layout: Layout, index: open('timetable'), 'competitions/[id]/index': () => <Text testID="preview">preview</Text> }, { initialUrl: '/' });
    await screen.findByTestId('sched-clock');
    await fireEvent.press(screen.getByTestId('org-top-preview'));
    await screen.findByTestId('preview');
    const calls = () => b.calls('GET', '/competitions/c9/heats').length;
    const before = calls();
    for (let k = 0; k < 3; k++) await wait(30_000);
    expect(calls()).toBe(before);
  });
});

describe('lot Web 3 review: promo-code toggles', () => {
  const coupons = [
    { id: 'p1', code: 'EARLY', type: 'PERCENTAGE', value: 20, categoryId: null, maxUses: 50, usedCount: 12, expiresAt: null, active: true },
    { id: 'p2', code: 'LATE', type: 'PERCENTAGE', value: 10, categoryId: null, maxUses: 50, usedCount: 0, expiresAt: null, active: true },
  ];

  it('two codes failing one after the other: each shows its real state and both are named', async () => {
    setWide(false);
    let a1!: (a: [number, unknown]) => void;
    let a2!: (a: [number, unknown]) => void;
    let gets = 0;
    const b = orgBackend()
      .on('GET', '/competitions/c9/coupons', () => (++gets === 1 ? [200, coupons] : new Promise<[number, unknown]>(() => {})))
      .on('POST', '/competitions/c9/coupons/p1/deactivate', () => new Promise<[number, unknown]>((r) => (a1 = r)))
      .on('POST', '/competitions/c9/coupons/p2/deactivate', () => new Promise<[number, unknown]>((r) => (a2 = r)));
    const screen = await renderScreen(open('coupons'), b);
    await screen.findByTestId('coupon-toggle-p1');
    await act(async () => {
      fireEvent.press(screen.getByTestId('coupon-toggle-p1'));
    });
    await waitFor(() => expect(within(screen.getByTestId('coupon-toggle-p1')).getByText('Activate')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByTestId('coupon-toggle-p2'));
    });
    await waitFor(() => expect(within(screen.getByTestId('coupon-toggle-p2')).getByText('Activate')).toBeTruthy());
    await act(async () => a1([500, { code: 'INTERNAL' }]));
    await act(async () => a2([500, { code: 'INTERNAL' }]));
    expect(within(screen.getByTestId('coupon-toggle-p1')).getByText('Deactivate')).toBeTruthy();
    expect(within(screen.getByTestId('coupon-toggle-p2')).getByText('Deactivate')).toBeTruthy();
    expect(screen.getByText('« EARLY » did not change: try again.')).toBeTruthy();
    expect(screen.getByText('« LATE » did not change: try again.')).toBeTruthy();
  });

  it('a failed toggle followed by a failed reload still says which code did not change', async () => {
    setWide(false);
    let gets = 0;
    const b = orgBackend()
      .on('GET', '/competitions/c9/coupons', () => (++gets === 1 ? [200, coupons] : [500, { code: 'INTERNAL' }]))
      .on('POST', '/competitions/c9/coupons/p1/deactivate', [500, { code: 'INTERNAL' }]);
    const screen = await renderScreen(open('coupons'), b);
    await fireEvent.press(await screen.findByTestId('coupon-toggle-p1'));
    expect(await screen.findByText('« EARLY » did not change: try again.')).toBeTruthy();
    await waitFor(() => expect(gets).toBe(2));
    expect(screen.getByText('« EARLY » did not change: try again.')).toBeTruthy();
    expect(screen.getByTestId('coupon-toggle-p1')).toBeTruthy();
  });
});

describe('lot Web 3 review: screen readers and keyboard on the web', () => {
  afterEach(() => setKeyboardModality(false));

  it('the inline switch: toggle buttons that say which one is on, in a named group', async () => {
    const screen = await renderScreen(() => <SegmentedInline testID="as" label="Show as:" value="a" options={[{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]} onChange={() => {}} />, new FakeBackend());
    expect(screen.getByTestId('as').props['aria-label']).toBe('Show as:');
    expect(screen.getByTestId('as-a').props.accessibilityRole).toBe('button');
    expect(screen.getByTestId('as-a').props['aria-pressed']).toBe(true);
    expect(screen.getByTestId('as-b').props['aria-pressed']).toBe(false);
  });

  // The phone Pressable folds aria-checked into accessibilityState here; the page's aria-checked is checked in the browser.
  it('checkboxes say their state and toggle with Space', async () => {
    const onToggle = jest.fn();
    const onChange = jest.fn();
    const screen = await renderScreen(
      () => (
        <>
          <DataTable testID="t" rows={[{ id: 'x' }]} keyOf={(r) => r.id} nameOf={() => 'X'} columns={[{ key: 'n', label: 'N', render: () => 'x' }]} selection={{ selected: new Set(['x']), onToggle, onToggleAll: () => {}, label: (n) => n, allLabel: 'All' }} />
          <Checkbox testID="cb" label="Remember" value={false} onChange={onChange} />
        </>
      ),
      new FakeBackend(),
    );
    expect(screen.getByTestId('t-check-x').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('cb').props.accessibilityState).toMatchObject({ checked: false });
    const space = { key: ' ', nativeEvent: { key: ' ' }, preventDefault: jest.fn() };
    await act(async () => screen.getByTestId('t-check-x').props.onKeyDown(space));
    await act(async () => screen.getByTestId('cb').props.onKeyDown(space));
    expect(onToggle).toHaveBeenCalledWith('x');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('the side panel is a modal dialog for the browser too', async () => {
    const screen = await renderScreen(
      () => (
        <SidePanel visible title="Sami" closeLabel="Close" onClose={() => {}}>
          <Txt>body</Txt>
        </SidePanel>
      ),
      new FakeBackend(),
    );
    expect(screen.getByTestId('side-panel').props['aria-modal']).toBe(true);
  });

  it('a skeleton without a name is not announced as a progress bar; with one it is', async () => {
    const screen = await renderScreen(
      () => (
        <>
          <SkeletonList count={1} />
          <SkeletonList count={1} label="Loading" />
        </>
      ),
      new FakeBackend(),
    );
    const [plain, named] = screen.getAllByTestId('skeleton');
    expect(plain.props.role).toBeUndefined();
    expect(named.props.role).toBe('progressbar');
  });

  it('the search box keeps its size when it gets the focus', async () => {
    const screen = await renderScreen(() => <SearchField testID="q" placeholder="Search" value="" onChangeText={() => {}} />, new FakeBackend());
    const box = () => flat(screen.getByTestId('q').parent!);
    expect(box()).toMatchObject({ borderWidth: 1 });
  });

  it('controls outside the computer layout do not re-render when the keyboard takes over', async () => {
    let renders = 0;
    function Probe() {
      useFocusRing();
      renders++;
      return <Txt>probe</Txt>;
    }
    await renderScreen(() => <Probe />, new FakeBackend());
    const before = renders;
    await act(async () => setKeyboardModality(true));
    expect(renders).toBe(before);
  });
});

describe('lot Web 3 review: other fixes', () => {
  beforeEach(() => setWide(true));
  afterEach(() => jest.restoreAllMocks());

  it('the phone app in the background stops the live reloads (React Query focus follows the app state)', () => {
    let emit!: (s: string) => void;
    const remove = jest.fn();
    const fakeAppState = { addEventListener: (_: string, fn: (s: string) => void) => ((emit = fn), { remove }) };
    const focused = jest.fn();
    const stop = appStateFocus(focused, fakeAppState as never);
    emit('background');
    emit('active');
    expect(focused.mock.calls).toEqual([[false], [true]]);
    stop?.();
    expect(remove).toHaveBeenCalled();
  });

  it('the Judges card keeps its count when a later reload of the team fails', async () => {
    const staff = [{ id: 's1', role: 'JUDGE', userId: 'u-3', user: { username: 'j' } }];
    let n = 0;
    const b = orgBackend().on('GET', '/competitions/c9/staff', () => (++n === 1 ? [200, staff] : [500, { code: 'INTERNAL' }]));
    const screen = await renderScreen(open('dashboard'), b);
    await waitFor(() => expect(screen.getByTestId('ov-kpi-judges-value').props.children).toBe('1'));
    await fireEvent.press(screen.getByTestId('org-menu-finances'));
    await screen.findByTestId('fin-table');
    await fireEvent.press(screen.getByTestId('org-menu-dashboard'));
    await waitFor(() => expect(n).toBe(2));
    // Let the failed reload of the team land (no retry in tests).
    await wait(1000);
    expect(screen.queryByText('Not available right now')).toBeNull();
    expect(screen.getByTestId('ov-kpi-judges-value').props.children).toBe('1');
    expect(screen.getByText('Judges and head judges')).toBeTruthy();
  });

  it('file names: Arabic categories get their position, special Latin letters are spelled out', () => {
    expect(boardFileName({}, 'رجال', 1)).toBe('event-leaderboard-2.csv');
    expect(boardFileName({}, 'RX Men', 0)).toBe('event-leaderboard-rx-men.csv');
    expect(toSlug('Straße Œuvre Øre Łódź Æsir')).toBe('strasse-oeuvre-ore-lodz-aesir');
  });

  it('deleting the event says so', async () => {
    jest.spyOn(router, 'replace').mockImplementation(() => {});
    const b = orgBackend({ ...event, status: 'DRAFT' }).on('DELETE', '/competitions/c9', [200, {}]);
    setWide(false);
    const screen = await renderScreen(open('general'), b);
    await fireEvent.press(await screen.findByTestId('org-delete'));
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    expect(await screen.findByText('Event deleted.')).toBeTruthy();
  });

  it('a new category starts with an empty leaderboard search', async () => {
    setWide(false);
    const screen = await renderScreen(open('leaderboard'), orgBackend().on('GET', '/competitions/c9/leaderboard', [200, board]));
    await fireEvent.changeText(await screen.findByTestId('board-search'), 'kef');
    await fireEvent.press(screen.getByTestId('board-cat-k2'));
    await waitFor(() => expect(screen.getByTestId('board-search').props.value).toBe(''));
  });

  it('« Mark paid (n) » waits while a single payment is on its way', async () => {
    let answer!: (a: [number, unknown]) => void;
    const b = orgBackend().on('GET', '/competitions/c9/heats', [200, []]).on('POST', '/competitions/c9/registrations/r1/mark-paid', () => new Promise<[number, unknown]>((r) => (answer = r)));
    const screen = await renderScreen(open('participants'), b);
    await fireEvent.press(await screen.findByTestId('reg-table-menu-r1'));
    await fireEvent.press(screen.getByTestId('reg-paid-r1'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('dialog-confirm'));
    });
    await fireEvent.press(screen.getByTestId('tab-collect'));
    await fireEvent.press(screen.getByTestId('reg-table-check-r4'));
    expect(screen.getByTestId('reg-batch').props.accessibilityState?.disabled).toBe(true);
    await act(async () => answer([200, {}]));
  });
});
