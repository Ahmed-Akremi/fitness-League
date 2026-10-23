import { useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { nextSeq } from '../../../core/live-bus';
import { useT } from '../../../core/prefs';
import { useApi, useLive } from '../../../core/services';
import { displayText, radius, space, useTheme } from '../../../core/theme';
import { EmptyState, SectionHeader, SkeletonList } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Button, Card, Chip, Dialog, Icon, Screen, TextField, Txt } from '../../../core/widgets/kit';
import { useCompetition } from '../api';
import { LocalBadge } from '../organizer/local-badge';
import { eventStyleOf } from '../organizer/logic';
import { emptyResult, flowOf, raceCursor, raceTotalMs, recordSplit, stageTimes, undoSplit, type Flow, type RaceResult } from '../organizer/logic-hybrid';
import { useLocalList } from '../organizer/roster';
import { formatClock } from './logic';

type Athlete = { registrationId: string; name: string };

/**
 * Phase 8: the judge of a hybrid race follows one athlete of a wave. « Station done » records the split on the wave's
 * clock (from the moment the organizer started it); the scoring rule and DNF are one tap away. Results stay on the
 * device for now (`race-results`) and are published on `wave.<waveId>`.
 */
export function JudgeRaceScreen({ id }: { id: string }) {
  const t = useT();
  const { colors } = useTheme();
  const comp = useCompetition(id);
  if (comp.isError) return <ErrorView error={comp.error} onRetry={() => comp.refetch()} />;
  if (!comp.data) return <SkeletonList count={3} height={96} />;
  const flow = flowOf(comp.data);
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: t('raceJudgeTitle') }} />
      {eventStyleOf(comp.data) !== 'HYBRID_RACE' || !flow ? <EmptyState icon="directions-run" message={t('raceOnlyHybrid')} /> : <RaceBoard c={comp.data} flow={flow} />}
    </View>
  );
}

function RaceBoard({ c, flow }: { c: Json; flow: Flow }) {
  const t = useT();
  const live = useLive();
  const qc = useQueryClient();
  const { colors } = useTheme();
  const waves = useLocalList(c.id, 'waves');
  const results = useLocalList(c.id, 'race-results');
  const [waveId, setWaveId] = useState<string | null>(null);
  const [registrationId, setRegistrationId] = useState<string | null>(null);

  // The organizer starts and stops waves from another tab of this browser: the list reloads at once.
  useEffect(() => {
    const reload = () => void qc.invalidateQueries({ queryKey: ['competitions', c.id, 'local', 'waves'] });
    const offs = [live.subscribe(`event.${c.id}`, 'wave_started', reload), live.subscribe(`event.${c.id}`, 'wave_stopped', reload)];
    return () => offs.forEach((off) => off());
  }, [live, qc, c.id]);

  if (waves.isError) return <ErrorView error={waves.error} onRetry={() => waves.refetch()} />;
  if (!waves.data || !results.data) return <SkeletonList count={3} height={64} />;
  const all = [...waves.data].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const wave = all.find((w) => w.id === waveId);
  const athletes: Athlete[] = wave ? (wave.athletes ?? (wave.registrationIds ?? []).map((r: string) => ({ registrationId: r, name: '—' }))) : [];
  const athlete = athletes.find((a) => a.registrationId === registrationId);

  return (
    <Screen>
      <View style={{ alignSelf: 'flex-start' }}>
        <LocalBadge />
      </View>
      <SectionHeader title={t('raceJudgeWaves')} />
      {all.length === 0 ? (
        <Txt color={colors.outline}>{t('raceJudgeNoWaves')}</Txt>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {all.map((w) => (
            <Chip
              key={w.id}
              testID={`race-wave-${w.id}`}
              icon={w.liveStart ? 'play-arrow' : undefined}
              label={w.liveStart ? `${w.name} · ${t('wavesLive')}` : w.name}
              selected={w.id === waveId}
              onPress={() => {
                setWaveId(w.id);
                setRegistrationId(null);
              }}
            />
          ))}
        </View>
      )}
      {wave ? (
        <>
          <SectionHeader title={t('raceJudgeAthletes')} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {athletes.map((a) => (
              <Chip key={a.registrationId} testID={`race-ath-${a.registrationId}`} label={a.name} selected={a.registrationId === registrationId} onPress={() => setRegistrationId(a.registrationId)} />
            ))}
          </View>
        </>
      ) : null}
      {wave && athlete ? <AthleteRace key={`${wave.id}:${athlete.registrationId}`} c={c} flow={flow} wave={wave} athlete={athlete} saved={results.data.find((r) => r.id === `${wave.id}:${athlete.registrationId}`) as RaceResult | undefined} /> : null}
    </Screen>
  );
}

function AthleteRace({ c, flow, wave, athlete, saved }: { c: Json; flow: Flow; wave: Json; athlete: Athlete; saved?: RaceResult }) {
  const t = useT();
  const api = useApi();
  const live = useLive();
  const qc = useQueryClient();
  const { colors } = useTheme();
  const [r, setR] = useState<RaceResult>(() => saved ?? emptyResult(wave.id, athlete.registrationId));
  const [now, setNow] = useState(Date.now());
  const [ruleValue, setRuleValue] = useState('');
  const [confirmDnf, setConfirmDnf] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const liveStart: string | null = wave.liveStart ?? null;
  const cursor = raceCursor(flow, r);
  const elapsed = liveStart ? Math.max(0, now - Date.parse(liveStart)) : null;
  const rule = flow.scoringRule;
  const total = raceTotalMs(flow, r);
  const times = stageTimes(r.splits);

  useEffect(() => {
    if (!liveStart || cursor == null) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [liveStart, cursor]);

  const publish = (event: string, payload: Json, seq = nextSeq()) => live.publish(`wave.${wave.id}`, event, { registrationId: athlete.registrationId, ...payload, seq, serverTs: Date.now() });

  /** Shows the change at once, tells the displays, then keeps it on the device with the same `seq`. */
  async function keep(change: RaceResult, event: string, payload: Json) {
    const seq = nextSeq();
    const next = { ...change, seq };
    setR(next);
    setError(null);
    publish(event, payload, seq);
    try {
      await api.post(`/competitions/${c.id}/race-results`, next);
      await qc.invalidateQueries({ queryKey: ['competitions', c.id, 'local', 'race-results'] });
    } catch (e) {
      setError(e);
    }
  }

  async function next() {
    if (!liveStart || cursor == null) return;
    const n = recordSplit(flow, r, Date.now() - Date.parse(liveStart));
    const split = { stageId: flow.stages[cursor].id, stageIndex: cursor, atMs: n.splits[n.splits.length - 1] };
    if (!n.finished) return keep(n, 'split', split);
    publish('split', split);
    return keep(n, 'done', { totalMs: raceTotalMs(flow, n), splits: n.splits });
  }

  const apply = (value: number) => keep({ ...r, adjustments: [...r.adjustments, value] }, 'penalty', { value, unit: rule?.unit, op: rule?.op });
  const last = cursor != null && cursor === flow.stages.length - 1;
  const stage = cursor != null ? flow.stages[cursor] : null;
  const nextLabel = last ? t('raceJudgeFinish') : stage?.kind === 'TRANSITION' ? t('raceJudgeRunDone') : t('raceJudgeStationDone');
  const ruleLabel = rule ? t('raceJudgeApply', { op: t(`raceRule${rule.op}`), value: rule.value ?? '…', unit: t(`raceRuleUnit${rule.unit}`) }) : '';

  return (
    <>
      <Card style={{ gap: space.xs, alignItems: 'center' }}>
        <Txt testID="race-athlete" style={displayText(32)}>{athlete.name}</Txt>
        <Txt color={colors.outline}>{wave.name}</Txt>
        {liveStart ? <Txt testID="race-clock" style={displayText(56)}>{formatClock(r.finished || r.dnf ? (r.splits[r.splits.length - 1] ?? 0) : (elapsed ?? 0))}</Txt> : <Txt color={colors.outline}>{t('raceJudgeNotLive')}</Txt>}
      </Card>

      {r.finished && total != null ? (
        <Card testID="race-finished" style={{ alignItems: 'center', borderWidth: 1, borderColor: colors.success }}>
          <Txt style={displayText(28)} color={colors.success}>{t('raceJudgeFinished', { time: formatClock(total) })}</Txt>
        </Card>
      ) : null}
      {r.dnf ? (
        <Card testID="race-out" style={{ alignItems: 'center', borderWidth: 1, borderColor: colors.error }}>
          <Txt style={displayText(28)} color={colors.error}>{t('raceJudgeOut')}</Txt>
        </Card>
      ) : null}

      {stage ? (
        <>
          <View style={{ gap: 2 }}>
            <Txt variant="label" color={colors.outline}>{`${(cursor ?? 0) + 1} / ${flow.stages.length} · ${stage.kind === 'TRANSITION' ? t('raceRun') : t('raceStation')}`}</Txt>
            <Txt testID="race-current" style={displayText(36)}>{stage.name}</Txt>
            <Txt color={colors.outline}>{`${stage.target} ${stage.unit}`}</Txt>
          </View>
          <Pressable
            testID="race-next"
            accessibilityRole="button"
            accessibilityLabel={nextLabel}
            accessibilityState={{ disabled: !liveStart }}
            disabled={!liveStart}
            onPress={() => void next()}
            style={({ pressed }) => ({ minHeight: 112, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: colors.primary, opacity: !liveStart ? 0.45 : pressed ? 0.8 : 1 })}
          >
            <Icon name={last ? 'flag' : 'skip-next'} size={32} color={colors.onPrimary} />
            <Txt style={displayText(30)} color={colors.onPrimary}>{nextLabel}</Txt>
          </Pressable>
          {rule ? (
            rule.value != null ? (
              <Button testID="race-penalty" kind="tonal" icon="report" label={ruleLabel} disabled={!liveStart} onPress={() => void apply(rule.value!)} />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
                <TextField testID="race-penalty-value" style={{ flex: 1 }} label={t('raceJudgeApplyValue')} value={ruleValue} onChangeText={setRuleValue} keyboardType="number-pad" />
                <Button
                  testID="race-penalty"
                  kind="tonal"
                  icon="report"
                  label={ruleLabel}
                  disabled={!liveStart || !(Number(ruleValue) > 0)}
                  onPress={() => {
                    void apply(Number(ruleValue));
                    setRuleValue('');
                  }}
                />
              </View>
            )
          ) : null}
        </>
      ) : null}
      {r.adjustments.length > 0 && rule ? <Txt testID="race-applied" color={colors.outline}>{t('raceJudgeApplied', { total: `${r.adjustments.reduce((a, b) => a + b, 0)} ${t(`raceRuleUnit${rule.unit}`)}` })}</Txt> : null}

      <Card style={{ gap: space.xs }}>
        {flow.stages.map((s, i) => (
          <View key={s.id} testID={`race-j-stage-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 4, paddingHorizontal: space.sm, borderRadius: radius.field, backgroundColor: i === cursor ? colors.surfaceHigh : undefined }}>
            <Icon name={i < r.splits.length ? 'check-circle' : s.kind === 'TRANSITION' ? 'directions-run' : 'fitness-center'} size={18} color={i < r.splits.length ? colors.success : colors.outline} />
            <Txt style={{ flex: 1, fontWeight: i === cursor ? '700' : '400' }}>{s.name}</Txt>
            <Txt color={colors.outline}>{i < times.length ? formatClock(times[i]) : ''}</Txt>
          </View>
        ))}
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {r.splits.length > 0 && !r.dnf ? <Button testID="race-undo" kind="outlined" icon="undo" label={t('raceJudgeUndo')} onPress={() => void keep(undoSplit(r), 'clear', { stageIndex: r.splits.length - 1 })} /> : null}
        {cursor != null ? <Button testID="race-dnf" kind="outlined" icon="block" label={t('raceJudgeDnf')} onPress={() => setConfirmDnf(true)} /> : null}
      </View>
      <ErrorText error={error} />
      <Dialog
        visible={confirmDnf}
        title={t('raceJudgeDnf')}
        message={t('raceJudgeDnfConfirm', { name: athlete.name })}
        confirmLabel={t('raceJudgeDnf')}
        cancelLabel={t('cancel')}
        destructive
        onConfirm={() => {
          setConfirmDnf(false);
          void keep({ ...r, dnf: true }, 'dnf', { stageIndex: cursor });
        }}
        onCancel={() => setConfirmDnf(false)}
      />
    </>
  );
}
