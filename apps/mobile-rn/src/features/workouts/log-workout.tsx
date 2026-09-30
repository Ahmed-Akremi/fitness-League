import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '../../core/api/errors';
import { useLocale, useT } from '../../core/prefs';
import { useServices } from '../../core/services';
import { useTheme } from '../../core/theme';
import { localized } from '../../core/utils/format';
import { newClientId } from '../../core/utils/ids';
import { Loading, SectionHeader, TimeField } from '../../core/widgets/common';
import { ErrorText, ErrorView } from '../../core/widgets/error';
import { Button, Card, Icon, IconButton, Screen, TextField, Txt, toast } from '../../core/widgets/kit';
import { DateField, Select } from '../../core/widgets/pickers';
import { meKey } from '../me/api';
import { useExercises, useSports, type RefItem } from '../reference/api';
import { workoutKeys } from './api';
import { HyroxRaceSheet, type TimedExercise } from './hyrox-sheet';

interface SetRow {
  reps: string;
  weight: string;
  distance: string;
  time: string;
  warmup: boolean;
}

interface Entry {
  key: number;
  exercise: RefItem;
  sets: SetRow[];
  /** Timed exercises (benchmark WODs, Hyrox): a single finish time instead of sets. */
  seconds: number | null;
}

const emptySet = (): SetRow => ({ reps: '', weight: '', distance: '', time: '', warmup: false });
const metrics = (e: RefItem) => (Array.isArray(e.trackedMetrics) ? (e.trackedMetrics as string[]) : []);
const isCardio = (e: RefItem) => metrics(e).includes('DISTANCE');
const isBodyweight = (e: RefItem) => e.isBodyweight === true;
const isTimed = (e: RefItem) => metrics(e).includes('FINISH_TIME');
const num = (text: string): number | null => {
  if (!text.trim()) return null;
  const v = Number(text.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

/** Picker sections, in display order. */
const GROUP_ORDER = ['HYROX_RACE', 'BENCHMARK_WOD', 'HYROX_STATION', 'MOVEMENT', null] as const;

function workoutType(sport?: RefItem): string {
  if (sport?.code === 'HYROX') return 'RACE';
  if (sport?.code === 'CROSSFIT') return 'WOD';
  return sport?.category === 'CARDIO' ? 'CARDIO' : 'STRENGTH';
}

/** Raw data only: the server computes volume, e1RM, records and points (spec §7, §9.1). */
export function LogWorkoutScreen() {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const { sync } = useServices();
  const qc = useQueryClient();
  const sports = useSports();
  const [sportId, setSportId] = useState<string | null>(null);
  const exercises = useExercises(sportId);
  const [performedAt, setPerformedAt] = useState(() => new Date(Date.now() - 3600_000));
  const [duration, setDuration] = useState('60');
  const [notes, setNotes] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [picker, setPicker] = useState(false);
  const [hyrox, setHyrox] = useState(false);
  // Generated once per form: re-submitting after a timeout reuses it, so the server never duplicates.
  const clientId = useRef(newClientId()).current;
  const nextKey = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const update = (key: number, fn: (e: Entry) => Entry) => setEntries((list) => list.map((e) => (e.key === key ? fn(e) : e)));
  const add = (exercise: RefItem, seconds: number | null = null) => ({ key: nextKey.current++, exercise, sets: [emptySet()], seconds });
  const timesComplete = entries.every((e) => !isTimed(e.exercise) || (e.seconds != null && e.seconds > 0));

  function payload(type: string) {
    return {
      clientId,
      sportId: sportId!,
      workoutType: type,
      performedAt: performedAt.toISOString(),
      durationS: Math.round((num(duration) ?? 0) * 60),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      exercises: entries.map((e) => ({
        exerciseId: e.exercise.id,
        sets: isTimed(e.exercise)
          ? [{ durationS: e.seconds }]
          : e.sets.map((s) => {
              const cardio = isCardio(e.exercise);
              const set: Record<string, unknown> = {};
              if (!cardio && num(s.reps) != null) set.reps = Math.round(num(s.reps)!);
              if (!cardio && !isBodyweight(e.exercise) && num(s.weight) != null) set.weightKg = num(s.weight);
              if (cardio && num(s.distance) != null) set.distanceM = Math.round(num(s.distance)! * 1000);
              if (cardio && num(s.time) != null) set.durationS = Math.round(num(s.time)! * 60);
              if (s.warmup) set.isWarmup = true;
              return set;
            }),
      })),
    };
  }

  async function save(type: string) {
    setBusy(true);
    setError(null);
    try {
      const [outcome] = await sync.save(payload(type));
      await Promise.all([
        qc.invalidateQueries({ queryKey: workoutKeys.list }),
        qc.invalidateQueries({ queryKey: workoutKeys.outbox }),
        qc.invalidateQueries({ queryKey: meKey }),
      ]);
      toast(outcome === 'saved' ? t('workoutSaved') : t('workoutQueued'));
      if (router.canGoBack()) router.back();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function addHyroxRace(result: TimedExercise[]) {
    setHyrox(false);
    if (!result.length) return;
    setEntries((list) => [...list, ...result.map((r) => add(r.exercise, r.seconds))]);
    // The session lasts at least the race.
    const raceMin = Math.ceil(result[0].seconds / 60);
    if ((num(duration) ?? 0) < raceMin) setDuration(String(raceMin));
  }

  if (sports.isError) return <ErrorView error={sports.error} onRetry={() => sports.refetch()} />;
  if (!sports.data) return <Loading />;
  const sport = sports.data.find((s) => s.id === sportId);
  const monthAgo = new Date(Date.now() - 30 * 86400_000);

  return (
    <Screen>
      <Select
        testID="log-sport"
        label={t('sport')}
        value={sportId}
        options={sports.data.map((s) => ({ value: s.id, label: localized(s.name, locale) }))}
        onChange={(v) => {
          setSportId(v);
          setEntries([]);
        }}
      />
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <DateField testID="log-date" label={t('performedAt')} mode="datetime" value={performedAt} onChange={setPerformedAt} minimumDate={monthAgo} maximumDate={new Date()} />
        </View>
        <TextField testID="log-duration" style={{ width: 130 }} label={t('durationMin')} value={duration} onChangeText={setDuration} keyboardType="number-pad" />
      </View>

      {entries.map((e, i) => (
        <ExerciseCard key={e.key} index={i} entry={e} onChange={(fn) => update(e.key, fn)} onRemove={() => setEntries((l) => l.filter((x) => x.key !== e.key))} />
      ))}

      {sportId &&
        (exercises.isError ? (
          <ErrorView error={exercises.error} />
        ) : !exercises.data ? (
          <Loading />
        ) : (
          <View style={{ gap: 8 }}>
            {sport?.code === 'HYROX' && exercises.data.some((e) => e.group === 'HYROX_RACE') && (
              <Button testID="hyrox-race" kind="tonal" icon="flag" label={t('hyroxFullRace')} onPress={() => setHyrox(true)} />
            )}
            <Button testID="log-add-exercise" kind="outlined" icon="add" label={t('addExercise')} onPress={() => setPicker(true)} />
            <ExercisePicker
              visible={picker}
              exercises={exercises.data}
              onClose={() => setPicker(false)}
              onPick={(ex) => {
                setPicker(false);
                setEntries((l) => [...l, add(ex)]);
              }}
            />
            {hyrox && <HyroxRaceSheet visible exercises={exercises.data} onClose={() => setHyrox(false)} onAdd={addHyroxRace} />}
          </View>
        ))}

      <TextField label={t('notes')} value={notes} onChangeText={setNotes} multiline maxLength={2000} style={{ marginTop: 8 }} />
      {!timesComplete && <Txt color={colors.error}>{t('timeRequired')}</Txt>}
      <ErrorText error={error} />
      <Button testID="log-save" label={t('save')} busy={busy} disabled={!sportId || entries.length === 0 || !timesComplete} onPress={() => save(workoutType(sport))} />
    </Screen>
  );
}

function ExerciseCard({ index, entry, onChange, onRemove }: { index: number; entry: Entry; onChange: (fn: (e: Entry) => Entry) => void; onRemove: () => void }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const cardio = isCardio(entry.exercise);
  const setField = (i: number, patch: Partial<SetRow>) => onChange((e) => ({ ...e, sets: e.sets.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const field = (i: number, value: string, label: string, key: string, name: keyof SetRow) => (
    <TextField key={key} testID={key} style={{ flex: 1 }} label={label} value={value} keyboardType="decimal-pad" onChangeText={(v) => setField(i, { [name]: v })} />
  );
  return (
    <Card testID={`exercise-${index}`} style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Txt variant="title" style={{ flex: 1 }}>{localized(entry.exercise.name, locale)}</Txt>
        <IconButton icon="close" label={t('delete')} onPress={onRemove} />
      </View>
      {isTimed(entry.exercise) ? (
        <TimeField testID={`time-${index}`} label={t('finishTime')} initialSeconds={entry.seconds ?? undefined} onChange={(v) => onChange((e) => ({ ...e, seconds: v }))} />
      ) : (
        <>
          {entry.sets.map((s, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <Txt variant="title" style={{ width: 20, paddingBottom: 14 }}>{String(i + 1)}</Txt>
              {cardio
                ? [field(i, s.distance, t('distanceKm'), `set-${i}-distance`, 'distance'), field(i, s.time, t('timeMin'), `set-${i}-time`, 'time')]
                : [
                    field(i, s.reps, t('reps'), `set-${i}-reps`, 'reps'),
                    ...(isBodyweight(entry.exercise) ? [] : [field(i, s.weight, t('weightKg'), `set-${i}-weight`, 'weight')]),
                  ]}
              {!cardio && (
                <Pressable
                  testID={`set-${i}-warmup`}
                  accessibilityRole="checkbox"
                  accessibilityLabel={t('warmup')}
                  accessibilityState={{ checked: s.warmup }}
                  onPress={() => setField(i, { warmup: !s.warmup })}
                  style={{ paddingBottom: 12 }}
                >
                  <Icon name={s.warmup ? 'check-box' : 'check-box-outline-blank'} color={s.warmup ? colors.primary : colors.outline} />
                </Pressable>
              )}
            </View>
          ))}
          <Button testID="add-set" kind="text" icon="add" label={t('addSet')} onPress={() => onChange((e) => ({ ...e, sets: [...e.sets, emptySet()] }))} style={{ alignSelf: 'flex-start' }} />
        </>
      )}
    </Card>
  );
}

function ExercisePicker({ visible, exercises, onClose, onPick }: { visible: boolean; exercises: RefItem[]; onClose: () => void; onPick: (e: RefItem) => void }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const grouped = exercises.some((e) => e.group != null);
  const title = (g: string | null) =>
    g === 'HYROX_RACE' ? t('groupHyroxRace') : g === 'BENCHMARK_WOD' ? t('groupBenchmark') : g === 'HYROX_STATION' ? t('groupHyroxStations') : g === 'MOVEMENT' ? t('groupMovements') : t('groupOther');
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12 }}>
          <Txt variant="title" style={{ flex: 1 }}>{t('addExercise')}</Txt>
          <IconButton icon="close" label={t('cancel')} onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          {GROUP_ORDER.map((g) => {
            const items = exercises.filter((e) => (e.group ?? null) === g);
            if (!items.length) return null;
            return (
              <View key={g ?? 'other'}>
                {grouped && (
                  <View style={{ paddingHorizontal: 12 }}>
                    <SectionHeader title={title(g)} />
                  </View>
                )}
                {items.map((e) => {
                  const description = localized(e.description, locale);
                  return (
                    <Pressable key={e.id} testID={`pick-${e.code}`} accessibilityRole="button" onPress={() => onPick(e)} style={{ paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Txt>{localized(e.name, locale)}</Txt>
                        {description ? <Txt variant="small" color={colors.outline} numberOfLines={2}>{description}</Txt> : null}
                      </View>
                      {isTimed(e) && <Icon name="timer" size={18} color={colors.outline} />}
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
