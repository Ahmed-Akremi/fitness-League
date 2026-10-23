import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { nextSeq } from '../../../core/live-bus';
import { useT } from '../../../core/prefs';
import { useApi, useLive } from '../../../core/services';
import { displayText, space, useTheme } from '../../../core/theme';
import { formatDuration } from '../../../core/utils/format';
import { SectionHeader, SkeletonList } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Card, Chip, Screen, TextField, Txt } from '../../../core/widgets/kit';
import { useHeats } from '../api';
import { LocalBadge } from './local-badge';
import { defaultTimer, TIMER_TYPES, timerPause, timerResume, timerSeconds, timerStart, timerView, type TimerConfig, type TimerState, type TimerType } from './logic-timer';
import { OrgPageHeader } from './page';
import { useLocalList } from './roster';

const num = (s: string) => Number(s.trim().replace(',', '.'));
const int = (s: string, fallback: number) => (Number.isInteger(num(s)) && num(s) > 0 ? num(s) : fallback);
const idle = (config: TimerConfig): TimerState => ({ config, startTimestamp: null, pausedAt: null, pausedMs: 0 });

/**
 * Phase 8: live control. The timer of the whole event or of one location (`timer.<id>` on the live bus, its state kept
 * on the device so a display opened later starts from it), and the feed of what the judges send.
 */
export function LiveTab({ c }: { c: Json }) {
  const t = useT();
  const { colors } = useTheme();
  const locations = useLocalList(c.id, 'locations');
  const timers = useLocalList(c.id, 'timers');
  const [where, setWhere] = useState<string>(c.id);
  return (
    <>
      <OrgPageHeader tab="live" />
      <Screen>
        <View style={{ alignSelf: 'flex-start' }}>
          <LocalBadge />
        </View>
        <SectionHeader title={t('liveTimer')} />
        <Txt variant="label" color={colors.outline}>{t('liveWhere')}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Chip testID="live-loc-all" label={t('liveWholeEvent')} selected={where === c.id} onPress={() => setWhere(c.id)} />
          {(locations.data ?? []).map((l) => (
            <Chip key={l.id} testID={`live-loc-${l.id}`} label={l.name} selected={where === l.id} onPress={() => setWhere(l.id)} />
          ))}
        </View>
        {/* Keyed by the place: each timer starts from its own saved state. */}
        {timers.data ? <TimerPanel key={where} c={c} channelId={where} saved={timers.data.find((x) => x.id === where) as TimerState | undefined} /> : <SkeletonList count={1} height={160} />}
        <LiveFeed c={c} />
      </Screen>
    </>
  );
}

function TimerPanel({ c, channelId, saved }: { c: Json; channelId: string; saved?: TimerState }) {
  const t = useT();
  const api = useApi();
  const live = useLive();
  const qc = useQueryClient();
  const { colors } = useTheme();
  const init = saved?.config ?? defaultTimer();
  const [type, setType] = useState<TimerType>(init.type);
  const [cap, setCap] = useState(init.capSec ? String(init.capSec / 60) : '');
  const [interval, setInterval_] = useState(String(init.intervalSec));
  const [rounds, setRounds] = useState(String(init.rounds));
  const [work, setWork] = useState(String(init.workSec));
  const [rest, setRest] = useState(String(init.restSec));
  const [state, setState] = useState<TimerState>(() => saved ?? idle(init));
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<unknown>(null);
  const v = timerView(state, now);

  useEffect(() => {
    if (v.status !== 'RUNNING') return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [v.status]);

  const config = (): TimerConfig => ({ type, capSec: cap.trim() && num(cap) > 0 ? Math.round(num(cap) * 60) : null, intervalSec: int(interval, 60), rounds: int(rounds, 1), workSec: int(work, 20), restSec: int(rest, 10) });

  /** Every screen gets the whole state (start time, pauses): a display just replaces its own. */
  async function apply(next: TimerState, event: string) {
    setState(next);
    setNow(Date.now());
    setError(null);
    live.publish(`timer.${channelId}`, event, { ...next, seq: nextSeq(), serverTs: Date.now() });
    try {
      await api.post(`/competitions/${c.id}/timers`, { id: channelId, ...next });
      await qc.invalidateQueries({ queryKey: ['competitions', c.id, 'local', 'timers'] });
    } catch (e) {
      setError(e);
    }
  }

  const iso = () => new Date().toISOString();
  const shownType = state.startTimestamp ? state.config.type : type;
  const info = [t(`timerStatus${v.status}`), v.round != null ? t('timerRound', { round: v.round }) : null, v.phase ? t(`timerPhase${v.phase}`) : null].filter(Boolean).join(' · ');

  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ alignItems: 'center', gap: 2 }}>
        <Txt testID="timer-clock" accessibilityRole="timer" style={displayText(64)}>{formatDuration(timerSeconds(state.startTimestamp ? v : timerView(idle(config()), now), shownType))}</Txt>
        <Txt testID="timer-status" color={v.status === 'DONE' ? colors.primary : colors.outline}>{info}</Txt>
      </View>
      {!state.startTimestamp ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {TIMER_TYPES.map((k) => (
              <Chip key={k} testID={`timer-type-${k}`} label={t(`timerType${k}`)} selected={type === k} onPress={() => setType(k)} />
            ))}
          </View>
          {type === 'FOR_TIME' || type === 'AMRAP' || type === 'COUNTDOWN' ? <TextField testID="timer-cap" label={t('timerCap')} value={cap} onChangeText={setCap} keyboardType="decimal-pad" /> : null}
          {type === 'EMOM' ? <TextField testID="timer-interval" label={t('timerInterval')} value={interval} onChangeText={setInterval_} keyboardType="number-pad" /> : null}
          {type === 'TABATA' ? (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <TextField testID="timer-work" style={{ flex: 1 }} label={t('timerWork')} value={work} onChangeText={setWork} keyboardType="number-pad" />
              <TextField testID="timer-rest" style={{ flex: 1 }} label={t('timerRest')} value={rest} onChangeText={setRest} keyboardType="number-pad" />
            </View>
          ) : null}
          {type === 'EMOM' || type === 'TABATA' ? <TextField testID="timer-rounds" label={t('timerRounds')} value={rounds} onChangeText={setRounds} keyboardType="number-pad" /> : null}
        </>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {!state.startTimestamp ? <Button testID="timer-start" icon="play-arrow" label={t('timerStart')} disabled={(type === 'AMRAP' || type === 'COUNTDOWN') && config().capSec == null} onPress={() => void apply(timerStart(config(), iso()), 'timer_start')} /> : null}
        {state.startTimestamp && !state.pausedAt && v.status === 'RUNNING' ? <Button testID="timer-pause" kind="tonal" icon="pause" label={t('timerPause')} onPress={() => void apply(timerPause(state, iso()), 'timer_pause')} /> : null}
        {state.pausedAt ? <Button testID="timer-resume" icon="play-arrow" label={t('timerResume')} onPress={() => void apply(timerResume(state, iso()), 'timer_start')} /> : null}
        {state.startTimestamp ? <Button testID="timer-stop" kind="outlined" icon="stop" label={t('timerStop')} onPress={() => void apply(idle(state.config), 'timer_stop')} /> : null}
      </View>
      <ErrorText error={error} />
    </Card>
  );
}

/** What the judges send, newest first; heats and waves are listened to one channel each. */
function LiveFeed({ c }: { c: Json }) {
  const t = useT();
  const live = useLive();
  const { colors } = useTheme();
  const heats = useHeats(c.id);
  const waves = useLocalList(c.id, 'waves');
  const [items, setItems] = useState<{ key: number; text: string }[]>([]);
  // A ref: the listeners stay subscribed while the screen renders again.
  const tr = useRef(t);
  tr.current = t;

  useEffect(() => {
    const push = (text: string) => setItems((xs) => [{ key: nextSeq(), text }, ...xs].slice(0, 30));
    const offs: (() => void)[] = [];
    for (const h of heats.data ?? []) {
      offs.push(
        live.subscribe(`heat.${h.id}`, 'score_update', (p: any) => {
          const t = tr.current;
          push(t('liveFeedScore', { heat: h.name, lane: p.lane, reps: p.reps }));
        }),
        live.subscribe(`heat.${h.id}`, 'done', (p: any) => {
          const t = tr.current;
          push(t('liveFeedDone', { heat: h.name, lane: p.lane }));
        }),
      );
    }
    for (const w of waves.data ?? []) {
      const nameOf = (p: any) => (w.athletes ?? []).find((a: Json) => a.registrationId === p.registrationId)?.name ?? '—';
      offs.push(
        live.subscribe(`wave.${w.id}`, 'split', (p: any) => {
          const t = tr.current;
          push(t('liveFeedSplit', { wave: w.name, name: nameOf(p), stage: p.stageIndex + 1 }));
        }),
        live.subscribe(`wave.${w.id}`, 'done', (p: any) => {
          const t = tr.current;
          push(t('liveFeedFinish', { wave: w.name, name: nameOf(p) }));
        }),
        live.subscribe(`wave.${w.id}`, 'dnf', (p: any) => {
          const t = tr.current;
          push(t('liveFeedDnf', { wave: w.name, name: nameOf(p) }));
        }),
      );
    }
    return () => offs.forEach((off) => off());
  }, [live, heats.data, waves.data]);

  return (
    <>
      <SectionHeader title={t('liveFeed')} />
      <Txt variant="small" color={colors.outline}>{t('liveFeedHint')}</Txt>
      <Card testID="live-feed" style={{ gap: space.xs }}>
        {items.length === 0 ? <Txt color={colors.outline}>{t('liveFeedEmpty')}</Txt> : items.map((x) => <Txt key={x.key}>{x.text}</Txt>)}
      </Card>
    </>
  );
}
