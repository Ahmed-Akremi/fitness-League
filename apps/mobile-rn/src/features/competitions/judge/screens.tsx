import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT, type T } from '../../../core/prefs';
import { nextSeq } from '../../../core/live-bus';
import { useApi, useLive } from '../../../core/services';
import { displayText, radius, space, useTheme } from '../../../core/theme';
import { formatDate, formatDuration } from '../../../core/utils/format';
import { newClientId } from '../../../core/utils/ids';
import { EmptyState, SkeletonList, StatusPill, TimeField } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Button, Card, Chip, Dialog, Expander, Icon, Screen, TextField, Txt, toast, type IconName } from '../../../core/widgets/kit';
import { useCompetition } from '../api';
import { eventStyleOf } from '../organizer/logic';
import { personName } from '../organizer/logic-b';
import { penaltiesOf, scorecardOf, type Scorecard } from '../organizer/logic-scorecard';
import { floorApi, flushPending, pendingScores, sendScore, useJudgeLanes, type PendingScore } from './api';
import { elapsedMs, formatClock, laneOrder, movementPoints, rawScore, scoringKind, tallyFromRaw, wholeSeconds, type Tally } from './logic';
import { scorecardCursor, tapBack, tapNext, tieBreakReps } from './logic-scorecard';

/** Pending scores of one competition, sent again on open, every 15 s and on « Réessayer » (ruling 6). */
function usePending(id: string, onSent: () => void) {
  const api = useApi();
  const [waiting, setWaiting] = useState<PendingScore[]>([]);
  // A ref: the caller's callback changes at every render, the 15 s timer must not restart with it.
  const sent = useRef(onSent);
  sent.current = onSent;
  const flush = useCallback(async () => {
    const before = (await pendingScores()).filter((p) => p.competitionId === id).length;
    const left = before ? await flushPending(api, id) : 0;
    setWaiting((await pendingScores()).filter((p) => p.competitionId === id));
    if (left < before) sent.current();
  }, [api, id]);
  useEffect(() => {
    void flush();
    const timer = setInterval(() => void flush(), 15_000);
    return () => clearInterval(timer);
  }, [flush]);
  return { waiting, flush };
}

const isWaiting = (waiting: PendingScore[], heatId: string, lane: number) => waiting.some((p) => p.heatId === heatId && p.lane === lane);

// ───────────── Invitation (competition page) ─────────────

/** On the competition page: the floor-judge invitation to answer, or the way into the judge space once accepted. */
export function FloorJudgeCard({ c }: { c: Json }) {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const invitation = c.myFloorJudge;
  if (!invitation) return null;

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['competitions'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (invitation.acceptedAt) {
    return (
      <Card testID="floor-judge" style={{ gap: space.sm, borderWidth: 1, borderColor: colors.primary }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Icon name="sports" color={colors.primary} />
          <Txt variant="title" style={{ flex: 1 }}>{t('floorAccepted')}</Txt>
        </View>
        <Txt color={colors.outline}>{t('floorJudgeBody')}</Txt>
        <Button testID="floor-open" icon="timer" label={t('floorOpenSpace')} onPress={() => router.push(`/competitions/${c.id}/judge`)} />
      </Card>
    );
  }
  return (
    <Card testID="floor-invitation" style={{ gap: space.sm, borderWidth: 1, borderColor: colors.primary }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Icon name="mail" color={colors.primary} />
        <Txt variant="title" style={{ flex: 1 }}>{t('floorInvitedTitle')}</Txt>
      </View>
      <Txt>{t('floorInvitedBody')}</Txt>
      <ErrorText error={error} />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button testID="floor-accept" label={t('floorAccept')} busy={busy} onPress={() => run(() => floorApi(api).accept(c.id))} />
        </View>
        <View style={{ flex: 1 }}>
          <Button testID="floor-decline" kind="outlined" label={t('floorDecline')} disabled={busy} onPress={() => setDeclining(true)} />
        </View>
      </View>
      <Dialog
        visible={declining}
        title={t('floorDecline')}
        message={t('floorDeclineConfirm')}
        confirmLabel={t('floorDecline')}
        cancelLabel={t('cancel')}
        destructive
        onConfirm={() => {
          setDeclining(false);
          void run(() => floorApi(api).decline(c.id));
        }}
        onCancel={() => setDeclining(false)}
      />
    </Card>
  );
}

// ───────────── Judge space: my lanes ─────────────

/** The judge's lanes, the heats to judge first; a lane opens its scoring screen. */
export function JudgeHomeScreen({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const lanes = useJudgeLanes(id, 15_000);
  const comp = useCompetition(id);
  const { waiting, flush } = usePending(id, () => void lanes.refetch());
  if (lanes.isError) return <ErrorView error={lanes.error} onRetry={() => lanes.refetch()} />;
  if (!lanes.data) return <SkeletonList count={4} height={96} />;
  const rows = laneOrder(lanes.data.lanes);
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: t('floorOpenSpace') }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => lanes.refetch()} tintColor={colors.primary} />}>
        <Txt variant="title">{lanes.data.competition.title}</Txt>
        {lanes.data.competition.locked ? <Txt color={colors.outline}>{t('floorLocked')}</Txt> : null}
        {comp.data && eventStyleOf(comp.data) === 'HYBRID_RACE' ? (
          <Card testID="judge-race" style={{ gap: space.sm, borderWidth: 1, borderColor: colors.primary }}>
            <Txt variant="title">{t('judgeRaceOpen')}</Txt>
            <Txt color={colors.outline}>{t('judgeRaceHint')}</Txt>
            <Button testID="judge-race-open" icon="directions-run" label={t('judgeRaceOpen')} onPress={() => router.push(`/competitions/${id}/judge/race`)} />
          </Card>
        ) : null}
        {waiting.length > 0 ? (
          <Card testID="floor-pending" style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.surfaceHigh }}>
            <Icon name="cloud-off" color={colors.error} />
            <Txt style={{ flex: 1 }}>{t('floorPendingBanner', { count: waiting.length })}</Txt>
            <Button kind="text" label={t('floorRetry')} onPress={() => void flush()} />
          </Card>
        ) : null}
        {rows.length === 0 ? (
          <EmptyState icon="sports" message={t('floorNoLanes')} />
        ) : (
          rows.map((l) => {
            const queued = isWaiting(waiting, l.heat.id, l.lane);
            return (
              <Card key={`${l.heat.id}-${l.lane}`} testID={`judge-lane-${l.heat.id}`} onPress={() => router.push(`/competitions/${id}/judge/${l.heat.id}`)} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <Txt variant="label" style={{ flex: 1 }}>{[l.heat.name, t('floorLane', { lane: l.lane })].join(' · ')}</Txt>
                  <StatusPill label={queued ? t('floorWaiting') : l.score ? t('floorSent') : t('floorToJudge')} color={queued ? colors.error : l.score ? colors.success : colors.primary} />
                </View>
                <Txt style={displayText(26)}>{personName(l)}</Txt>
                <Txt color={colors.outline}>{[l.workout?.name, l.category?.name, l.heat.startsAt ? formatDate(l.heat.startsAt, locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : null].filter(Boolean).join(' · ')}</Txt>
              </Card>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

// ───────────── Scoring screen ─────────────

/** The score as read aloud to the athlete before they confirm it. */
export function scoreSummary(t: T, scoreType: string, raw: Json, movements: { pointsPerRep: number }[] = []): string {
  switch (scoringKind(scoreType)) {
    case 'time':
      return raw.capped ? t('floorScoreCapped', { reps: raw.reps }) : formatDuration(raw.timeS);
    case 'reps':
      return t('floorScoreReps', { reps: raw.reps });
    case 'rounds':
      return t('floorScoreRounds', { rounds: raw.rounds, reps: raw.reps });
    case 'movements':
      return t('floorScorePoints', { points: movementPoints(movements, raw.movementReps) });
    default:
      return String(raw.value);
  }
}

/** One heat of the judge: the clock from the heat's common start, the counters of the WOD's score type, the athlete's confirmation. */
export function JudgeLaneScreen({ id, heatId }: { id: string; heatId: string }) {
  const t = useT();
  const { colors } = useTheme();
  const lanes = useJudgeLanes(id, 5_000);
  const lane: Json | undefined = lanes.data?.lanes.find((l: Json) => l.heat.id === heatId);
  if (lanes.isError) return <ErrorView error={lanes.error} onRetry={() => lanes.refetch()} />;
  if (!lanes.data) return <SkeletonList count={3} height={120} />;
  if (!lane) return <EmptyState icon="sports" message={t('floorNotYours')} />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: `${lane.heat.name} · ${t('floorLane', { lane: lane.lane })}` }} />
      {/* Keyed by the lane: a new heat starts from fresh counters. */}
      <LaneScoring key={`${heatId}-${lane.lane}`} id={id} lane={lane} offsetMs={lanes.data.offsetMs} locked={lanes.data.competition.locked} onChanged={() => lanes.refetch()} />
    </View>
  );
}

function LaneScoring({ id, lane, offsetMs, locked, onChanged }: { id: string; lane: Json; offsetMs: number; locked: boolean; onChanged: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const w: Json | null = lane.workout;
  const movements: { name: string; pointsPerRep: number }[] = w?.movements ?? [];
  const [tally, setTally] = useState<Tally>(() => tallyFromRaw(lane.score?.raw, movements.length));
  const [editing, setEditing] = useState(lane.score == null);
  const [queued, setQueued] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [now, setNow] = useState(Date.now());
  const sending = useRef(false);
  const live = useLive();
  const startedAt: string | null = lane.heat.startedAt;
  const kind = w ? scoringKind(w.scoreType) : 'value';
  // Phase 8: a WOD with a scorecard is counted movement by movement; its penalties get their own counters.
  const sc = w ? scorecardOf(w) : null;
  const bySc = sc != null && sc.sets.length > 0 && (kind === 'reps' || kind === 'time');
  const pen = w ? penaltiesOf(w) : null;
  const [extra, setExtra] = useState({ missedReps: 0, minor: 0, major: 0 });
  const capMs = w?.timeCapS ? w.timeCapS * 1000 : null;
  const elapsed = elapsedMs(startedAt, offsetMs, now);
  const finished = kind === 'time' && (tally.timeS != null || tally.capped);
  const ticking = startedAt != null && editing && !finished && (capMs == null || (elapsed ?? 0) < capMs + 1000);

  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [ticking]);

  // For Time: at the cap the athlete has not finished; the screen switches to counting reps. Once only: the judge
  // may switch back to type a time that finished on the buzzer.
  const autoCapped = useRef(false);
  useEffect(() => {
    if (autoCapped.current || kind !== 'time' || !editing || capMs == null || elapsed == null || elapsed < capMs || tally.timeS != null || tally.capped) return;
    autoCapped.current = true;
    setTally((x) => ({ ...x, capped: true }));
  }, [kind, editing, capMs, elapsed, tally.timeS, tally.capped]);
  // Remounts the time field when « FINI » fills it, never while the judge types in it.
  const [timeField, setTimeField] = useState(0);

  // The tie-break time is taken from the heat clock when the athlete ends the scorecard's tie-break set.
  const tieAt = bySc ? tieBreakReps(sc) : null;
  useEffect(() => {
    if (tieAt == null || !startedAt || tally.tieBreakS != null || tally.reps < tieAt) return;
    setTally((x) => ({ ...x, tieBreakS: wholeSeconds(elapsedMs(startedAt, offsetMs) ?? 0) }));
  }, [tieAt, startedAt, offsetMs, tally.reps, tally.tieBreakS]);

  // Every change is published on the heat's live channel (displays, organizer). Refs: the lanes are read again every
  // 5 s, which must not publish anything by itself.
  const liveCtx = useRef({ live, heatId: lane.heat.id, lane: lane.lane, workoutId: w?.id ?? null, offsetMs });
  liveCtx.current = { live, heatId: lane.heat.id, lane: lane.lane, workoutId: w?.id ?? null, offsetMs };
  const published = useRef(tally);
  useEffect(() => {
    if (published.current === tally) return;
    published.current = tally;
    const x = liveCtx.current;
    x.live.publish(`heat.${x.heatId}`, 'score_update', { lane: x.lane, workoutId: x.workoutId, reps: tally.reps, rounds: tally.rounds, timeS: tally.timeS, capped: tally.capped, tieBreakS: tally.tieBreakS, noReps: tally.noReps, seq: nextSeq(), serverTs: Date.now() + x.offsetMs });
  }, [tally]);

  if (!w) return <EmptyState icon="event-busy" message={t('floorNoWod')} />;
  const raw = rawScore(w.scoreType, tally);
  const set = (patch: Partial<Tally>) => setTally((x) => ({ ...x, ...patch }));

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await floorApi(api).start(id, lane.heat.id);
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (sending.current || !raw) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await sendScore(api, { competitionId: id, heatId: lane.heat.id, lane: lane.lane, body: { clientId: newClientId(), raw, athleteConfirmed: true } });
      if (extra.missedReps || extra.minor || extra.major) await api.post(`/competitions/${id}/lane-penalties`, { id: `${lane.heat.id}:${lane.lane}`, heatId: lane.heat.id, lane: lane.lane, workoutId: w!.id, ...extra });
      live.publish(`heat.${lane.heat.id}`, 'done', { lane: lane.lane, workoutId: w!.id, raw, seq: nextSeq(), serverTs: Date.now() + offsetMs });
      setQueued(r.queued);
      setEditing(false);
      toast(r.queued ? t('floorScoreQueued') : t('floorScoreSent'));
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: 2 }}>
        <Txt variant="label" color={colors.outline}>{[w.name, lane.category?.name].filter(Boolean).join(' · ')}</Txt>
        <Txt testID="judge-athlete" style={displayText(36)}>{personName(lane)}</Txt>
        {w.timeCapS ? <Txt color={colors.outline}>{t('floorCap', { time: formatDuration(w.timeCapS) })}</Txt> : null}
      </View>
      <Expander icon="description" title={t('floorWod')}>
        <Txt>{w.description}</Txt>
        {w.standards ? <Txt variant="small" color={colors.outline}>{w.standards}</Txt> : null}
      </Expander>

      {locked ? <Txt color={colors.outline}>{t('floorLocked')}</Txt> : null}

      {!editing ? (
        <Card testID="judge-sent" style={{ gap: space.sm, alignItems: 'center' }}>
          <StatusPill label={queued ? t('floorWaiting') : t('floorSent')} color={queued ? colors.error : colors.success} />
          <Txt style={displayText(40)}>{raw ? scoreSummary(t, w.scoreType, raw, movements) : '—'}</Txt>
          {!locked ? <Button testID="judge-correct" kind="outlined" icon="edit" label={t('floorCorrect')} onPress={() => setEditing(true)} /> : null}
        </Card>
      ) : (
        <>
          <Card testID="judge-clock" style={{ alignItems: 'center', gap: space.sm }}>
            {startedAt ? (
              <Txt testID="judge-clock-time" style={displayText(56)}>{formatClock(kind === 'time' && tally.timeS != null ? tally.timeS * 1000 : Math.min(elapsed ?? 0, capMs ?? Infinity))}</Txt>
            ) : (
              <>
                <Txt color={colors.outline}>{t('floorNotStarted')}</Txt>
                <Button testID="judge-start" icon="play-arrow" label={t('floorStartHeat')} busy={busy} disabled={locked} onPress={start} />
              </>
            )}
          </Card>

          {kind === 'time' && !tally.capped ? (
            <>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <BigButton
                  testID="judge-finish"
                  label={t('floorFinish')}
                  hint={t('floorFinishHint')}
                  icon="flag"
                  disabled={!startedAt || tally.timeS != null}
                  onPress={() => {
                    set({ timeS: Math.max(1, wholeSeconds(elapsed ?? 0)) });
                    setTimeField((k) => k + 1);
                  }}
                  flex={3}
                />
                <BigButton testID="judge-tiebreak" label={t('floorTieBreak')} hint={t('floorTieBreakHint')} icon="more-time" kind="tonal" disabled={!startedAt || tally.timeS != null} onPress={() => set({ tieBreakS: wholeSeconds(elapsed ?? 0) })} flex={1} />
              </View>
              {/* The time stays editable: a judge who pressed late corrects it from their stopwatch. */}
              <TimeField testID="judge-time" key={timeField}label={t('floorTime')} initialSeconds={tally.timeS ?? undefined} onChange={(s) => set({ timeS: s })} />
            </>
          ) : null}
          {kind === 'time' && tally.capped ? <Txt testID="judge-capped" color={colors.primary} style={{ fontWeight: '700' }}>{t('floorCapReached')}</Txt> : null}
          {kind === 'time' ? <Chip testID="judge-capped-toggle" icon="timer-off" label={t('floorCapped')} selected={tally.capped} onPress={() => set({ capped: !tally.capped, timeS: null })} /> : null}
          {tally.tieBreakS != null ? <Txt testID="judge-tiebreak-at" color={colors.outline}>{t('floorTieBreakAt', { time: formatDuration(tally.tieBreakS) })}</Txt> : null}

          {bySc && <ScorecardCounter sc={sc} reps={tally.reps} onChange={(reps) => set({ reps })} />}
          {!bySc && (kind === 'reps' || (kind === 'time' && tally.capped)) && <Counter testID="judge-reps" label={t('floorReps')} value={tally.reps} onChange={(reps) => set({ reps })} addLabel={t('floorAddRep')} removeLabel={t('floorRemoveRep')} />}
          {kind === 'rounds' && (
            <>
              <Counter testID="judge-rounds" label={t('floorRounds')} value={tally.rounds} onChange={(rounds) => set({ rounds, reps: rounds > tally.rounds ? 0 : tally.reps })} addLabel={t('floorAddRound')} removeLabel={t('floorRemoveRound')} big={false} />
              <Counter testID="judge-reps" label={t('floorReps')} value={tally.reps} onChange={(reps) => set({ reps })} addLabel={t('floorAddRep')} removeLabel={t('floorRemoveRep')} />
              <TextField testID="judge-reps-per-round" label={t('floorRepsPerRound')} keyboardType="number-pad" value={tally.repsPerRound} onChangeText={(repsPerRound) => set({ repsPerRound })} />
            </>
          )}
          {kind === 'movements' &&
            movements.map((m, i) => (
              <Counter
                key={i}
                testID={`judge-move-${i}`}
                label={`${m.name} · ${t('compPointsPerRep', { points: m.pointsPerRep })}`}
                value={tally.movementReps[i] ?? 0}
                onChange={(v) => set({ movementReps: tally.movementReps.map((r, j) => (j === i ? v : r)) })}
                addLabel={t('floorAddRep')}
                removeLabel={t('floorRemoveRep')}
                big={false}
              />
            ))}
          {kind === 'movements' && raw ? <Txt testID="judge-points" style={displayText(28)} color={colors.primary}>{scoreSummary(t, w.scoreType, raw, movements)}</Txt> : null}
          {kind === 'value' && <TextField testID="judge-value" label={`${t('floorValue')} (${w.scoreType})`} keyboardType="decimal-pad" value={tally.value} onChangeText={(value) => set({ value })} />}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Txt style={{ flex: 1 }} color={colors.outline}>{t('floorNoRepCount', { count: tally.noReps })}</Txt>
            <Button testID="judge-norep" kind="tonal" icon="block" label={t('floorNoRep')} onPress={() => set({ noReps: tally.noReps + 1 })} />
          </View>
          {pen && pen.missedRepSeconds > 0 ? <PenaltyRow testID="judge-missed" label={t('judgeMissed')} count={extra.missedReps} onAdd={() => setExtra((e) => ({ ...e, missedReps: e.missedReps + 1 }))} /> : null}
          {pen && pen.minorPct > 0 ? <PenaltyRow testID="judge-minor" label={t('judgeMinor')} count={extra.minor} onAdd={() => setExtra((e) => ({ ...e, minor: e.minor + 1 }))} /> : null}
          {pen && pen.majorPct > 0 ? <PenaltyRow testID="judge-major" label={t('judgeMajor')} count={extra.major} onAdd={() => setExtra((e) => ({ ...e, major: e.major + 1 }))} /> : null}
          <Txt variant="small" color={colors.outline}>{t('judgeLiveHint')}</Txt>

          <ErrorText error={error} />
          <Button testID="judge-validate" icon="check" label={t('floorValidate')} busy={busy} disabled={!raw || locked} onPress={() => setConfirming(true)} />
        </>
      )}

      {/* Ruling 2: the athlete confirms on the judge's phone, with their name and the score in front of them. */}
      <Dialog
        visible={confirming}
        title={t('floorConfirmTitle')}
        message={raw ? t('floorConfirmBody', { name: personName(lane), score: scoreSummary(t, w.scoreType, raw, movements) }) : undefined}
        confirmLabel={t('floorConfirmButton')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          setConfirming(false);
          void send();
        }}
        onCancel={() => setConfirming(false)}
      />
    </Screen>
  );
}

/** Large target for the floor: a judge taps it without looking, chalk on the fingers. */
function BigButton({ label, hint, icon, onPress, disabled, testID, kind = 'filled', flex = 1 }: { label: string; hint: string; icon: IconName; onPress: () => void; disabled?: boolean; testID?: string; kind?: 'filled' | 'tonal'; flex?: number }) {
  const { colors } = useTheme();
  const fg = kind === 'filled' ? colors.onPrimary : colors.text;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ flex, minHeight: 96, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: kind === 'filled' ? colors.primary : colors.surfaceHigh, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 })}
    >
      <Icon name={icon} size={28} color={fg} />
      <Txt style={displayText(28)} color={fg}>{label}</Txt>
    </Pressable>
  );
}

/** − / value / + : the « + » is the big one, the judge taps it at every rep. Never under 0. */
function Counter({ label, value, onChange, addLabel, removeLabel, testID, big = true }: { label: string; value: number; onChange: (v: number) => void; addLabel: string; removeLabel: string; testID?: string; big?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Txt variant="label" color={colors.outline}>{label}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: space.sm }}>
        <Pressable
          testID={testID ? `${testID}-minus` : undefined}
          accessibilityRole="button"
          accessibilityLabel={removeLabel}
          disabled={value === 0}
          onPress={() => onChange(Math.max(0, value - 1))}
          style={({ pressed }) => ({ width: 72, minHeight: big ? 96 : 64, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceHigh, opacity: value === 0 ? 0.45 : pressed ? 0.8 : 1 })}
        >
          <Icon name="remove" size={28} />
        </Pressable>
        <View style={{ minWidth: 88, alignItems: 'center', justifyContent: 'center' }}>
          <Txt testID={testID ? `${testID}-value` : undefined} accessibilityLiveRegion="polite" style={displayText(big ? 56 : 40)}>{String(value)}</Txt>
        </View>
        <Pressable
          testID={testID ? `${testID}-plus` : undefined}
          accessibilityRole="button"
          accessibilityLabel={addLabel}
          onPress={() => onChange(value + 1)}
          style={({ pressed }) => ({ flex: 1, minHeight: big ? 96 : 64, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 })}
        >
          <Icon name="add" size={big ? 40 : 28} color={colors.onPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

/** Phase 8: where the athlete is on the scorecard; one tap counts the movement's « count every ». */
function ScorecardCounter({ sc, reps, onChange }: { sc: Scorecard; reps: number; onChange: (reps: number) => void }) {
  const t = useT();
  const { colors } = useTheme();
  const cur = scorecardCursor(sc, reps);
  if (!cur) return null;
  return (
    <Card testID="judge-sc" style={{ gap: space.sm }}>
      <Txt variant="label" color={colors.outline}>{cur.done ? t('judgeScDone') : t('judgeScWhere', { set: sc.sets[cur.set].name || String(cur.set + 1), round: cur.round })}</Txt>
      <Txt testID="judge-sc-name" style={displayText(32)}>{cur.name}</Txt>
      <Txt color={colors.outline}>{`${cur.moveReps} / ${cur.moveTarget} ${cur.unit}`}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: space.sm }}>
        <Pressable
          testID="judge-sc-minus"
          accessibilityRole="button"
          accessibilityLabel={t('judgeScRemove')}
          disabled={reps === 0}
          onPress={() => onChange(tapBack(sc, reps))}
          style={({ pressed }) => ({ width: 72, minHeight: 96, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceHigh, opacity: reps === 0 ? 0.45 : pressed ? 0.8 : 1 })}
        >
          <Icon name="remove" size={28} />
        </Pressable>
        <Pressable
          testID="judge-sc-plus"
          accessibilityRole="button"
          accessibilityLabel={t('judgeScAdd', { step: cur.step })}
          accessibilityState={{ disabled: cur.done }}
          disabled={cur.done}
          onPress={() => onChange(tapNext(sc, reps))}
          style={({ pressed }) => ({ flex: 1, minHeight: 96, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, opacity: cur.done ? 0.45 : pressed ? 0.8 : 1 })}
        >
          <Txt style={displayText(40)} color={colors.onPrimary}>{`+${cur.step}`}</Txt>
        </Pressable>
      </View>
      <Txt testID="judge-sc-progress" accessibilityLiveRegion="polite" style={{ fontWeight: '700' }}>{t('judgeScProgress', { reps, total: cur.total })}</Txt>
    </Card>
  );
}

function PenaltyRow({ label, count, onAdd, testID }: { label: string; count: number; onAdd: () => void; testID: string }) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <Txt testID={`${testID}-count`} style={{ flex: 1 }} color={colors.outline}>{t('judgePenaltyLine', { label, count })}</Txt>
      <Button testID={testID} kind="tonal" icon="report" label={label} onPress={onAdd} />
    </View>
  );
}

/** Kept for the organizer's lane list: the lane's judge in one line. */
export function laneJudgeLine(t: T, lane: Json): string {
  return lane.judge ? t('orgLaneJudge', { name: lane.judge.fullName || lane.judge.username || '—' }) : t('orgLaneNoJudge');
}

