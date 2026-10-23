import { useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { SectionHeader } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Card, Chip, IconButton, ListRow, Screen, TextField, Txt } from '../../../core/widgets/kit';
import { DateField } from '../../../core/widgets/pickers';
import { useCompLeaderboard } from '../api';
import { organizerApi, useRefreshCompetition, useRegistrations } from './api';
import { LocalBadge } from './local-badge';
import { planHeats, sortEntries, type HeatSort, type Placement } from './logic-heats';
import { personName } from './logic-b';
import { useLocalList } from './roster';

const SORTS: HeatSort[] = ['RANK_TOP', 'RANK_LOW', 'ALPHABET', 'REGISTRATION'];
const PLACEMENTS: Placement[] = ['START', 'MIDDLE', 'END'];
const int = (s: string) => (s.trim() && Number.isInteger(Number(s.trim())) ? Number(s.trim()) : NaN);

/** Phase 6: the stages and floors of an on-site event. Kept on the device for now. */
export function LocationsSection({ c }: { c: Json }) {
  const t = useT();
  const api = useApi();
  const refresh = useRefreshCompetition();
  const locations = useLocalList(c.id, 'locations');
  const [name, setName] = useState('');
  const [lanes, setLanes] = useState('8');
  const [error, setError] = useState<unknown>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
    }
  };
  return (
    <>
      <SectionHeader title={t('locTitle')} />
      <View style={{ alignSelf: 'flex-start' }}>
        <LocalBadge />
      </View>
      {(locations.data ?? []).map((l) => (
        <ListRow key={l.id} testID={`loc-${l.id}`} title={l.name} subtitle={t('locLanesCount', { count: l.lanes })} trailing={<IconButton testID={`loc-remove-${l.id}`} icon="delete" label={t('orgFormRemove')} onPress={() => act(() => api.delete(`/competitions/${c.id}/locations/${l.id}`))} />} />
      ))}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
        <TextField testID="loc-name" style={{ flex: 2 }} label={t('locName')} value={name} onChangeText={setName} maxLength={60} />
        <TextField testID="loc-lanes" style={{ flex: 1 }} label={t('locLanes')} value={lanes} onChangeText={setLanes} keyboardType="number-pad" />
        <Button
          testID="loc-add"
          kind="tonal"
          label={t('locAdd')}
          disabled={!name.trim() || !(int(lanes) >= 1 && int(lanes) <= 40)}
          onPress={() =>
            act(async () => {
              await api.post(`/competitions/${c.id}/locations`, { name: name.trim(), lanes: int(lanes) });
              setName('');
            })
          }
        />
      </View>
      <ErrorText error={error} />
    </>
  );
}

/**
 * Phase 6: plans heats for one division (order, lane placement, times with transitions and pauses), then creates
 * them with the server's heat and lane routes. The heat's location is kept on the device.
 */
export function HeatGenerator({ c, onDone, onCancel }: { c: Json; onDone: (heats: number) => void; onCancel: () => void }) {
  const t = useT();
  const api = useApi();
  const { colors } = useTheme();
  const refresh = useRefreshCompetition();
  const regs = useRegistrations(c.id);
  const locations = useLocalList(c.id, 'locations');
  const categories: Json[] = (c.categories ?? []).filter((k: Json) => k.active !== false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [workoutId, setWorkoutId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [sort, setSort] = useState<HeatSort>('REGISTRATION');
  const [placement, setPlacement] = useState<Placement>('MIDDLE');
  const [lanes, setLanes] = useState('8');
  const [perHeat, setPerHeat] = useState('8');
  const [start, setStart] = useState(() => new Date(c.eventStart));
  const [duration, setDuration] = useState('15');
  const [transition, setTransition] = useState('3');
  const [pauseEvery, setPauseEvery] = useState('');
  const [pauseMin, setPauseMin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const board = useCompLeaderboard(c.id, categoryId ?? undefined);

  const ranks: Record<string, number> = Object.fromEntries((board.data?.rows ?? []).filter((r: Json) => r.athlete?.id).map((r: Json) => [r.athlete.id, r.rank]));
  const entries = (regs.data ?? [])
    .filter((r) => r.categoryId === categoryId && r.registrationStatus !== 'CANCELLED' && r.registrationStatus !== 'REFUNDED')
    .map((r) => ({ registrationId: r.id, name: personName(r), userId: r.userId, registeredAt: r.registeredAt }));
  const n = { lanes: int(lanes), perHeat: int(perHeat), duration: int(duration), transition: int(transition), pauseEvery: pauseEvery.trim() ? int(pauseEvery) : 0, pauseMin: pauseMin.trim() ? int(pauseMin) : 0 };
  const valid = !!categoryId && n.lanes >= 1 && n.lanes <= 40 && n.perHeat >= 1 && n.duration >= 1 && n.transition >= 0 && !Number.isNaN(n.pauseEvery) && !Number.isNaN(n.pauseMin);
  const plan = valid
    ? planHeats({ entries: sortEntries(entries, sort, ranks), perHeat: n.perHeat, lanes: n.lanes, placement, start, durationMin: n.duration, transitionMin: n.transition, pauseEvery: n.pauseEvery, pauseMin: n.pauseMin })
    : [];

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const org = organizerApi(api);
      const category = categories.find((k) => k.id === categoryId);
      for (const h of plan) {
        const heat = await org.addHeat(c.id, { name: `${category?.name ?? ''} · ${h.number}`.trim(), categoryId, ...(workoutId ? { workoutId } : {}), startsAt: h.startsAt, durationMin: n.duration, laneCount: n.lanes });
        for (const l of h.lanes) await org.assignLane(c.id, heat.id, l.registrationId, l.lane);
        if (locationId) await api.post(`/competitions/${c.id}/heat-locations`, { id: heat.id, locationId });
      }
      await refresh();
      onDone(plan.length);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const chips = <K extends string>(items: { key: K; label: string }[], selected: K | null, pick: (k: K) => void, prefix: string) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {items.map((x) => (
        <Chip key={x.key} testID={`${prefix}-${x.key}`} label={x.label} selected={selected === x.key} onPress={() => pick(x.key)} />
      ))}
    </View>
  );
  const field = (testID: string, label: string, value: string, set: (v: string) => void) => (
    <View style={{ flex: 1 }}>
      <TextField testID={testID} label={label} value={value} onChangeText={set} keyboardType="number-pad" />
    </View>
  );

  return (
    <Screen>
      <Card style={{ gap: space.md }}>
        <Txt variant="title">{t('genOpen')}</Txt>
        <Txt variant="label" color={colors.outline}>{t('genDivision')}</Txt>
        {chips(categories.map((k) => ({ key: k.id as string, label: k.name as string })), categoryId, setCategoryId, 'gen-cat')}
        {(c.workouts ?? []).length > 0 && (
          <>
            <Txt variant="label" color={colors.outline}>{t('genWorkout')}</Txt>
            {chips((c.workouts ?? []).map((w: Json) => ({ key: w.id as string, label: w.name as string })), workoutId, (k) => setWorkoutId(workoutId === k ? null : k), 'gen-wod')}
          </>
        )}
        {(locations.data ?? []).length > 0 && (
          <>
            <Txt variant="label" color={colors.outline}>{t('genLocation')}</Txt>
            {chips(
              (locations.data ?? []).map((l) => ({ key: l.id as string, label: l.name as string })),
              locationId,
              (k) => {
                setLocationId(locationId === k ? null : k);
                const l = (locations.data ?? []).find((x) => x.id === k);
                if (l && locationId !== k) {
                  setLanes(String(l.lanes));
                  setPerHeat(String(l.lanes));
                }
              },
              'gen-loc',
            )}
          </>
        )}
        <Txt variant="label" color={colors.outline}>{t('genSort')}</Txt>
        {chips(SORTS.map((s) => ({ key: s, label: t(`genSort${s}`) })), sort, setSort, 'gen-sort')}
        <Txt variant="label" color={colors.outline}>{t('genPlacement')}</Txt>
        {chips(PLACEMENTS.map((p) => ({ key: p, label: t(`genPlace${p}`) })), placement, setPlacement, 'gen-place')}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {field('gen-lanes', t('locLanes'), lanes, setLanes)}
          {field('gen-per-heat', t('genPerHeat'), perHeat, setPerHeat)}
        </View>
        <DateField testID="gen-start" mode="datetime" label={t('genStart')} value={start} onChange={setStart} />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {field('gen-duration', t('genDuration'), duration, setDuration)}
          {field('gen-transition', t('genTransition'), transition, setTransition)}
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {field('gen-pause-every', t('genPauseEvery'), pauseEvery, setPauseEvery)}
          {field('gen-pause-min', t('genPauseMin'), pauseMin, setPauseMin)}
        </View>
        {valid && <Txt testID="gen-preview" style={{ fontWeight: '700' }}>{t('genPreview', { heats: plan.length, athletes: entries.length })}</Txt>}
        <ErrorText error={error} />
        <Button testID="gen-run" label={t('genRun')} busy={busy} disabled={!valid || plan.length === 0} onPress={run} />
        <Button kind="text" label={t('cancel')} onPress={onCancel} />
      </Card>
    </Screen>
  );
}
