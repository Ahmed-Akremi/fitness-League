import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useT } from '../../../core/prefs';
import { useApi, useLive } from '../../../core/services';
import { displayText, ThemeScope, useTheme } from '../../../core/theme';
import { formatDuration } from '../../../core/utils/format';
import { Txt } from '../../../core/widgets/kit';
import { useCompetition, useCompLeaderboard, useHeats } from '../api';
import { formatClock } from '../judge/logic';
import { eventStyleOf } from '../organizer/logic';
import { personName } from '../organizer/logic-b';
import { flowOf, type Flow, type RaceResult } from '../organizer/logic-hybrid';
import { overallRanking, resultsSettingsOf, tableOf, visibleRows, type ResultsSettings } from '../organizer/logic-results';
import { timerSeconds, timerView, type TimerState } from '../organizer/logic-timer';
import { applyRaceEvent, keepNewer, raceRows, rotation, scheduleNow, type LaneLive } from './logic';

/**
 * Organisation update, phase 9: full-screen, read-only displays for the TV, the projector and the stream
 * (`/display/<competitionId>/<kind>`, options in the query). Each loads a snapshot, then follows the live bus; the
 * snapshot is read again every 30 s. `overlay=1` gives a transparent background for a green-screen overlay.
 */

export type DisplayKind = 'timer' | 'heat' | 'lane' | 'race' | 'leaderboard' | 'schedule' | 'call';
export const DISPLAY_KINDS: DisplayKind[] = ['timer', 'heat', 'lane', 'race', 'leaderboard', 'schedule', 'call'];

/** The display's colours: always the dark palette (`ThemeScope` in `DisplayScreen`), whatever the device shows. */
function useD() {
  const { colors } = useTheme();
  return { bg: colors.background, panel: colors.surface, text: colors.text, muted: colors.outline, accent: colors.primary, good: colors.success, bad: colors.error };
}
const SNAPSHOT_MS = 30_000;

type Params = Record<string, string | string[] | undefined>;
const param = (p: Params, k: string) => (typeof p[k] === 'string' && p[k] ? (p[k] as string) : undefined);

export function DisplayScreen({ id, kind, params }: { id: string; kind: string; params: Params }) {
  return (
    <ThemeScope scheme="dark">
      <DisplayBody id={id} kind={kind} params={params} />
    </ThemeScope>
  );
}

function DisplayBody({ id, kind, params }: { id: string; kind: string; params: Params }) {
  const t = useT();
  const D = useD();
  const overlay = param(params, 'overlay') === '1';
  return (
    <View testID="display-root" style={{ flex: 1, backgroundColor: overlay ? 'transparent' : D.bg, padding: 32, gap: 24 }}>
      <Stack.Screen options={{ headerShown: false }} />
      {kind === 'timer' ? (
        <TimerDisplay id={id} channel={param(params, 'loc') ?? id} />
      ) : kind === 'heat' ? (
        <HeatDisplay id={id} heatId={param(params, 'heat')} />
      ) : kind === 'lane' ? (
        <HeatDisplay id={id} heatId={param(params, 'heat')} lane={Number(param(params, 'lane')) || 1} />
      ) : kind === 'race' ? (
        <RaceDisplay id={id} waveId={param(params, 'wave')} />
      ) : kind === 'leaderboard' ? (
        <LeaderboardDisplay id={id} rotateSec={Number(param(params, 'rotate')) || 15} categoryId={param(params, 'category')} />
      ) : kind === 'schedule' ? (
        <ScheduleDisplay id={id} />
      ) : kind === 'call' ? (
        <CallDisplay id={id} />
      ) : (
        <Center>
          <Txt style={displayText(40)} color={D.muted}>{t('displayUnknown')}</Txt>
        </Center>
      )}
    </View>
  );
}

function Center({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>{children}</View>;
}

function Title({ children }: { children: string }) {
  const D = useD();
  return <Txt style={displayText(48)} color={D.text}>{children}</Txt>;
}

/** A list the local layer keeps (`core/api/org-local.ts`), read again every 30 s: the display's snapshot. */
function useSnapshot(id: string, path: string) {
  const api = useApi();
  return useQuery({ queryKey: ['competitions', id, 'local', path], queryFn: () => api.get<Json[]>(`/competitions/${id}/${path}`), refetchInterval: SNAPSHOT_MS });
}

/** Re-renders every `ms` (clocks, rotation). */
function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/** Ticks counted since the screen opened (the rotation of the leaderboard). */
function useTicks(ms: number) {
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTicks((n) => n + 1), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return ticks;
}

/** Listens to some events of a channel while mounted. */
function useChannel(channel: string | null, events: string[], on: (event: string, payload: Json) => void) {
  const live = useLive();
  const handler = useRef(on);
  handler.current = on;
  const names = events.join(',');
  useEffect(() => {
    if (!channel) return;
    const offs = names.split(',').map((e) => live.subscribe(channel, e, (p) => handler.current(e, (p ?? {}) as Json)));
    return () => offs.forEach((off) => off());
  }, [live, channel, names]);
}

/** The newest of the saved state and the last update heard. */
const newest = <T extends { seq?: number }>(...xs: (T | null | undefined)[]): T | null => xs.filter((x): x is T => !!x).sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))[0] ?? null;

// ───────────── Timer ─────────────

function TimerDisplay({ id, channel }: { id: string; channel: string }) {
  const t = useT();
  const D = useD();
  const timers = useSnapshot(id, 'timers');
  const [heard, setHeard] = useState<(TimerState & { seq?: number }) | null>(null);
  useChannel(`timer.${channel}`, ['timer_start', 'timer_pause', 'timer_stop', 'timer_config'], (_, p) => setHeard((h) => newest(h, p as TimerState & { seq?: number })));
  const now = useNow(200);
  const state = newest(heard, timers.data?.find((x) => x.id === channel) as (TimerState & { seq?: number }) | undefined);
  if (!timers.data && !heard) return null;
  if (!state) {
    return (
      <Center>
        <Txt testID="display-clock" style={displayText(220)} color={D.muted}>0:00</Txt>
      </Center>
    );
  }
  const v = timerView(state, now);
  const info = [t(`timerStatus${v.status}`), v.round != null ? t('timerRound', { round: v.round }) : null, v.phase ? t(`timerPhase${v.phase}`) : null].filter(Boolean).join(' · ');
  return (
    <Center>
      <Txt testID="display-clock" accessibilityRole="timer" style={displayText(220)} color={v.phase === 'REST' ? D.muted : D.text}>{formatDuration(timerSeconds(v, state.config.type))}</Txt>
      <Txt testID="display-status" style={displayText(40)} color={v.status === 'DONE' ? D.accent : D.muted}>{info}</Txt>
    </Center>
  );
}

// ───────────── Heat and single lane ─────────────

function laneValue(x: LaneLive | undefined): string {
  if (!x) return '—';
  const timeS = x.raw?.timeS ?? x.timeS;
  if (typeof timeS === 'number' && timeS > 0) return formatDuration(timeS);
  return String(x.raw?.reps ?? x.reps ?? 0);
}

function HeatDisplay({ id, heatId, lane }: { id: string; heatId?: string; lane?: number }) {
  const t = useT();
  const D = useD();
  const heats = useHeats(id, SNAPSHOT_MS);
  const now = useNow(5_000);
  const heat: Json | undefined = heatId ? heats.data?.find((h) => h.id === heatId) : scheduleNow(heats.data ?? [], now).active[0];
  const [lanes, setLanes] = useState<Record<number, LaneLive>>({});
  useEffect(() => setLanes({}), [heat?.id]);
  useChannel(heat ? `heat.${heat.id}` : null, ['score_update', 'done'], (e, p) => setLanes((l) => keepNewer(l, (e === 'done' ? { ...p, done: true } : p) as LaneLive)));
  if (!heat) {
    return (
      <Center>
        <Txt style={displayText(56)} color={D.muted}>{t('displayNoHeat')}</Txt>
      </Center>
    );
  }
  const rows: Json[] = [...(heat.lanes ?? [])].sort((a, b) => a.lane - b.lane);
  if (lane != null) {
    const l = rows.find((x) => x.lane === lane);
    const x = lanes[lane];
    return (
      <Center>
        <Txt style={displayText(48)} color={D.muted}>{t('displayLane', { lane })}</Txt>
        <Txt style={displayText(96)} color={D.text}>{l ? personName(l) : '—'}</Txt>
        <Txt testID={`display-lane-${lane}-value`} style={displayText(200)} color={x?.done ? D.good : D.accent}>{laneValue(x)}</Txt>
        {x?.done ? <Txt style={displayText(40)} color={D.good}>{t('displayDone')}</Txt> : null}
      </Center>
    );
  }
  return (
    <>
      <View style={{ gap: 4 }}>
        <Title>{heat.name}</Title>
        {heat.workout?.name ? <Txt style={displayText(32)} color={D.muted}>{heat.workout.name}</Txt> : null}
      </View>
      <View style={{ gap: 12 }}>
        {rows.map((l) => {
          const x = lanes[l.lane];
          return (
            <View key={l.lane} testID={`display-lane-${l.lane}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 24, padding: 16, borderRadius: 16, backgroundColor: D.panel }}>
              <Txt style={[displayText(40), { width: 64 }]} color={D.muted}>{String(l.lane)}</Txt>
              <Txt style={[displayText(40), { flex: 1 }]} color={D.text}>{personName(l)}</Txt>
              <Txt testID={`display-lane-${l.lane}-value`} style={displayText(48)} color={x?.done ? D.good : D.accent}>{laneValue(x)}</Txt>
            </View>
          );
        })}
      </View>
    </>
  );
}

// ───────────── Hybrid race ─────────────

/** Results of the waves shown: the saved ones with the judges' updates replayed on top (`seq` skips duplicates). */
function useRaceResults(id: string, waveIds: string[]) {
  const results = useSnapshot(id, 'race-results');
  const [events, setEvents] = useState<{ waveId: string; event: string; payload: Json }[]>([]);
  const live = useLive();
  const keys = waveIds.join(',');
  useEffect(() => {
    const offs = keys
      .split(',')
      .filter(Boolean)
      .flatMap((waveId) => ['split', 'clear', 'penalty', 'done', 'dnf'].map((event) => live.subscribe(`wave.${waveId}`, event, (p) => setEvents((xs) => [...xs, { waveId, event, payload: (p ?? {}) as Json }].slice(-500)))));
    return () => offs.forEach((off) => off());
  }, [live, keys]);
  // Memoised: the race view re-renders twice a second for its clock.
  return useMemo(() => events.reduce((rs, e) => applyRaceEvent(rs, e.waveId, e.event, e.payload), (results.data ?? []) as RaceResult[]), [events, results.data]);
}

function RaceDisplay({ id, waveId }: { id: string; waveId?: string }) {
  const t = useT();
  const D = useD();
  const comp = useCompetition(id);
  const waves = useSnapshot(id, 'waves');
  // A wave started from the Waves page: read the waves again at once.
  useChannel(`event.${id}`, ['wave_started', 'wave_stopped'], () => void waves.refetch());
  const wave: Json | undefined = waveId ? waves.data?.find((w) => w.id === waveId) : (waves.data ?? []).filter((w) => w.liveStart).sort((a, b) => Date.parse(b.liveStart) - Date.parse(a.liveStart))[0];
  const results = useRaceResults(id, wave ? [wave.id] : []);
  const now = useNow(500);
  const flow: Flow | null = comp.data ? flowOf(comp.data) : null;
  if (!flow || !wave) {
    return (
      <Center>
        <Txt style={displayText(56)} color={D.muted}>{t('displayNoWave')}</Txt>
      </Center>
    );
  }
  const rows = raceRows(flow, results.filter((r) => r.waveId === wave.id), wave.athletes ?? []);
  const clock = wave.liveStart ? Math.max(0, now - Date.parse(wave.liveStart)) : 0;
  const total = flow.stages.length;
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 24 }}>
        <View style={{ flex: 1 }}>
          <Title>{wave.name}</Title>
        </View>
        <Txt style={displayText(64)} color={D.accent}>{formatClock(clock)}</Txt>
      </View>
      <View style={{ gap: 12 }}>
        {rows.map((r) => (
          <View key={r.registrationId} testID={`display-race-${r.registrationId}`} style={{ gap: 8, padding: 16, borderRadius: 16, backgroundColor: D.panel }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 24 }}>
              <Txt style={[displayText(40), { width: 64 }]} color={D.muted}>{r.rank != null ? String(r.rank) : '–'}</Txt>
              <Txt style={[displayText(40), { flex: 1 }]} color={D.text}>{r.name}</Txt>
              <Txt style={displayText(32)} color={D.muted}>{t('displayStages', { done: r.stagesDone, total })}</Txt>
              <Txt style={[displayText(40), { minWidth: 200, textAlign: 'right' }]} color={r.status === 'FINISHED' ? D.good : r.status === 'DNF' ? D.bad : D.accent}>
                {r.status === 'FINISHED' && r.totalMs != null ? formatClock(r.totalMs) : r.status === 'DNF' ? t('displayDnf') : r.status === 'WAITING' ? t('displayWaiting') : r.lastMs != null ? formatClock(r.lastMs) : ''}
              </Txt>
              <Txt style={[displayText(28), { minWidth: 120, textAlign: 'right' }]} color={D.muted}>{r.gapMs ? `+${formatClock(r.gapMs)}` : ''}</Txt>
            </View>
            {/* Progress through the stages (runs included). */}
            <View style={{ height: 8, borderRadius: 4, backgroundColor: D.bg, overflow: 'hidden' }}>
              <View style={{ width: `${Math.round((r.stagesDone / Math.max(1, total)) * 100)}%`, height: 8, backgroundColor: r.status === 'DNF' ? D.bad : D.accent }} />
            </View>
          </View>
        ))}
      </View>
    </>
  );
}

// ───────────── Leaderboard ─────────────

function LeaderboardDisplay({ id, rotateSec, categoryId }: { id: string; rotateSec: number; categoryId?: string }) {
  const t = useT();
  const D = useD();
  const comp = useCompetition(id);
  const seconds = useTicks(1_000);
  const cats: Json[] = (comp.data?.categories ?? []).filter((k: Json) => k.active !== false);
  const cat = categoryId ? cats.find((k) => k.id === categoryId) : cats[rotation(cats.length, rotateSec, 0, seconds * 1000)];
  const freezes = useSnapshot(id, 'board-freezes');
  const hybrid = comp.data ? eventStyleOf(comp.data) === 'HYBRID_RACE' : false;
  // Phase 10: the organizer's choices for the screens (hidden, random order, frozen standings, points table).
  const s = comp.data ? resultsSettingsOf(comp.data) : null;
  const frozen = s?.frozenAt && cat ? freezes.data?.find((f) => f.id === cat.id) : null;
  if (s?.visibility === 'HIDDEN') {
    return (
      <Center>
        <Txt style={displayText(56)} color={D.muted}>{t('displayHidden')}</Txt>
      </Center>
    );
  }
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 24 }}>
        <View style={{ flex: 1 }}>
          <Title>{cat?.name ?? comp.data?.title ?? ''}</Title>
        </View>
        {frozen ? <Txt style={displayText(32)} color={D.accent}>{t('displayFrozen')}</Txt> : null}
      </View>
      {frozen ? (
        <ShownRows rows={(frozen.rows ?? []) as BoardLine[]} s={s!} seed={cat?.id ?? ''} />
      ) : comp.data && s ? (
        hybrid ? (
          <HybridBoard id={id} c={comp.data} categoryId={cat?.id} s={s} />
        ) : (
          <PointsBoard id={id} categoryId={cat?.id} s={s} />
        )
      ) : null}
      {!cat && comp.data ? <Txt color={D.muted}>{t('displayBoardEmpty')}</Txt> : null}
    </>
  );
}

type BoardLine = { key: string; rank: number | null; name: string; value: string };

/** Ranked, or the same names in random order without ranks nor scores (prompt §5, visibility). */
function ShownRows({ rows, s, seed }: { rows: BoardLine[]; s: ResultsSettings; seed: string }) {
  const t = useT();
  const D = useD();
  const shown = visibleRows(rows.slice(0, 10), s.visibility, seed);
  if (shown.length === 0) return <Txt style={displayText(40)} color={D.muted}>{t('displayBoardEmpty')}</Txt>;
  return (
    <View style={{ gap: 12 }}>
      {shown.map((r) => (
        <BoardRow key={r.key} rank={r.rank} name={r.name} value={s.visibility === 'RANDOM' ? '' : r.value} />
      ))}
    </View>
  );
}

function BoardRow({ rank, name, value }: { rank: number | null; name: string; value: string }) {
  const D = useD();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 24, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 16, backgroundColor: D.panel }}>
      <Txt style={[displayText(40), { width: 64 }]} color={rank === 1 ? D.accent : D.muted}>{rank != null ? String(rank) : '–'}</Txt>
      <Txt style={[displayText(40), { flex: 1 }]} color={D.text}>{name}</Txt>
      <Txt style={displayText(40)} color={D.accent}>{value}</Txt>
    </View>
  );
}

function PointsBoard({ id, categoryId, s }: { id: string; categoryId?: string; s: ResultsSettings }) {
  const t = useT();
  const board = useCompLeaderboard(id, categoryId, undefined, SNAPSHOT_MS);
  if (!board.data) return null;
  const table = tableOf(s);
  const rows: Json[] = table ? overallRanking(board.data.rows ?? [], board.data.workouts ?? [], table) : (board.data.rows ?? []).map((r: Json) => ({ ...r, localRank: r.rank, localTotal: r.totalPoints }));
  const lines = rows.map((r) => ({ key: r.athlete.id, rank: r.localRank, name: r.athlete.fullName || r.athlete.username || '—', value: t('orgBoardPoints', { points: r.localTotal }) }));
  return <ShownRows rows={lines} s={s} seed={categoryId ?? ''} />;
}

/** A hybrid event ranks by race time: every wave of the division together. */
function HybridBoard({ id, c, categoryId, s }: { id: string; c: Json; categoryId?: string; s: ResultsSettings }) {
  const t = useT();
  const waves = useSnapshot(id, 'waves');
  const mine = (waves.data ?? []).filter((w) => w.categoryId === categoryId);
  const results = useRaceResults(id, mine.map((w) => w.id));
  const flow = flowOf(c);
  if (!flow) return null;
  const rows = raceRows(flow, results.filter((r) => mine.some((w) => w.id === r.waveId)), mine.flatMap((w) => w.athletes ?? [])).filter((r) => r.status !== 'WAITING');
  const lines = rows.map((r) => ({ key: r.registrationId, rank: r.rank, name: r.name, value: r.status === 'FINISHED' && r.totalMs != null ? formatClock(r.totalMs) : r.status === 'DNF' ? t('displayDnf') : t('displayStages', { done: r.stagesDone, total: flow.stages.length }) }));
  return <ShownRows rows={lines} s={s} seed={categoryId ?? ''} />;
}

// ───────────── Schedule ─────────────

function ScheduleDisplay({ id }: { id: string }) {
  const t = useT();
  const D = useD();
  const heats = useHeats(id, SNAPSHOT_MS);
  const waves = useSnapshot(id, 'waves');
  const now = useNow(10_000);
  const s = scheduleNow(heats.data ?? [], now);
  const allWaves = [...(waves.data ?? [])].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const onFloor = [...s.active.map((h) => h.name as string), ...allWaves.filter((w) => w.liveStart).map((w) => w.name as string)];
  const next = [...s.next.map((h) => ({ name: h.name as string, at: h.startsAt as string })), ...allWaves.filter((w) => !w.liveStart && Date.parse(w.startsAt) > now).map((w) => ({ name: w.name as string, at: w.startsAt as string }))]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(0, 4);
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <>
      <Title>{t('displayOnFloor')}</Title>
      {onFloor.length ? onFloor.map((n) => <Txt key={n} style={displayText(56)} color={D.accent}>{n}</Txt>) : <Txt style={displayText(40)} color={D.muted}>{t('displayNoHeat')}</Txt>}
      <Title>{t('displayUpcoming')}</Title>
      {next.length ? (
        next.map((x) => (
          <View key={`${x.name}-${x.at}`} style={{ flexDirection: 'row', gap: 24 }}>
            <Txt style={[displayText(40), { width: 160 }]} color={D.muted}>{time(x.at)}</Txt>
            <Txt style={displayText(40)} color={D.text}>{x.name}</Txt>
          </View>
        ))
      ) : (
        <Txt style={displayText(40)} color={D.muted}>{t('displayNothingPlanned')}</Txt>
      )}
    </>
  );
}

// ───────────── Call screen ─────────────

type Call = { kind: 'WARM_UP' | 'CORRAL' | null; label: string; seq?: number };

function CallDisplay({ id }: { id: string }) {
  const t = useT();
  const D = useD();
  const calls = useSnapshot(id, 'calls');
  const [heard, setHeard] = useState<Call | null>(null);
  useChannel(`event.${id}`, ['call_warm_up', 'call_corral', 'call_clear'], (e, p) =>
    setHeard((h) => newest(h, { kind: e === 'call_warm_up' ? 'WARM_UP' : e === 'call_corral' ? 'CORRAL' : null, label: p.label ?? '', seq: p.seq })),
  );
  const call = newest(heard, calls.data?.find((x) => x.id === 'current') as Call | undefined);
  if (!call?.kind) {
    return (
      <Center>
        <Txt style={displayText(56)} color={D.muted}>{t('displayCallNone')}</Txt>
      </Center>
    );
  }
  return (
    <Center>
      <Txt style={displayText(72)} color={D.accent}>{call.kind === 'WARM_UP' ? t('displayCallWarmUp') : t('displayCallCorral')}</Txt>
      <Txt style={displayText(140)} color={D.text}>{call.label}</Txt>
    </Center>
  );
}
