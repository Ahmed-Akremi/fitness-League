import { useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi, useLive } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { EmptyState, SectionHeader } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Card, Checkbox, Chip, Screen, TextField, Txt } from '../../../core/widgets/kit';
import { DateField } from '../../../core/widgets/pickers';
import { useRefreshCompetition, useRegistrations } from './api';
import { LocalBadge } from './local-badge';
import { eventStyleOf } from './logic';
import { personName } from './logic-b';
import { planWaves } from './logic-hybrid';
import { OrgPageHeader } from './page';
import { useLocalList } from './roster';

const int = (s: string) => (s.trim() && Number.isInteger(Number(s.trim())) ? Number(s.trim()) : NaN);

/**
 * Phase 7: the waves of a hybrid race. Starting the selected waves sets their start time, starts the shared clock and
 * tells the displays (`event.<id>` wave_started, `timer.<id>` timer_start on the live bus). Kept on the device for now.
 */
export function WavesTab({ c }: { c: Json }) {
  const t = useT();
  if (eventStyleOf(c) !== 'HYBRID_RACE') {
    return (
      <>
        <OrgPageHeader tab="waves" />
        <EmptyState icon="waves" message={t('raceOnlyHybrid')} />
      </>
    );
  }
  return <WavesBoard c={c} />;
}

function WavesBoard({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const live = useLive();
  const { colors } = useTheme();
  const refresh = useRefreshCompetition();
  const regs = useRegistrations(c.id);
  const waves = useLocalList(c.id, 'waves');
  const categories: Json[] = (c.categories ?? []).filter((k: Json) => k.active !== false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [per, setPer] = useState('10');
  const [interval, setInterval_] = useState('10');
  const [start, setStart] = useState(() => new Date(c.eventStart));
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const all = [...(waves.data ?? [])].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const racing = all.filter((w) => w.liveStart);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  const create = () =>
    act(async () => {
      const category = categories.find((k) => k.id === categoryId);
      const entries = (regs.data ?? [])
        .filter((r) => r.categoryId === categoryId && r.registrationStatus !== 'CANCELLED' && r.registrationStatus !== 'REFUNDED')
        .map((r) => ({ registrationId: r.id, name: personName(r), userId: r.userId, registeredAt: r.registeredAt }));
      for (const w of planWaves({ entries, perWave: int(per), start, intervalMin: int(interval) })) {
        await api.post(`/competitions/${c.id}/waves`, { ...w, name: t('wavesName', { division: category?.name ?? '', number: w.number }), categoryId, liveStart: null });
      }
    });

  const setLive = (on: boolean) =>
    act(async () => {
      const now = new Date().toISOString();
      for (const w of all.filter((x) => selected.includes(x.id) && !!x.liveStart !== on)) {
        await api.put(`/competitions/${c.id}/waves/${w.id}`, { liveStart: on ? now : null });
        live.publish(`event.${c.id}`, on ? 'wave_started' : 'wave_stopped', { waveId: w.id, at: now });
        live.publish(`timer.${c.id}`, on ? 'timer_start' : 'timer_stop', { waveId: w.id, startTimestamp: now });
      }
      setSelected([]);
    });

  return (
    <>
      <OrgPageHeader tab="waves" />
      <Screen>
        <View style={{ alignSelf: 'flex-start' }}>
          <LocalBadge />
        </View>
        <Txt testID="waves-progress" style={{ fontWeight: '700' }}>{t('wavesProgress', { live: racing.length, total: all.length })}</Txt>

        <SectionHeader title={t('wavesGenerate')} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {categories.map((k) => (
            <Chip key={k.id} testID={`wave-cat-${k.id}`} label={k.name} selected={categoryId === k.id} onPress={() => setCategoryId(k.id)} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <TextField testID="wave-per" label={t('wavesPer')} value={per} onChangeText={setPer} keyboardType="number-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <TextField testID="wave-interval" label={t('wavesInterval')} value={interval} onChangeText={setInterval_} keyboardType="number-pad" />
          </View>
        </View>
        <DateField testID="wave-start-at" mode="datetime" label={t('wavesStart')} value={start} onChange={setStart} />
        <Button testID="wave-run" kind="outlined" label={t('wavesGenerate')} busy={busy} disabled={!categoryId || !(int(per) >= 1) || !(int(interval) >= 1)} onPress={create} />

        {all.length === 0 ? (
          <Txt color={colors.outline}>{t('wavesEmpty')}</Txt>
        ) : (
          <Card style={{ gap: space.xs }}>
            {all.map((w) => (
              <View key={w.id} testID={`wave-${w.id}`} style={{ gap: 2 }}>
                <Checkbox testID={`wave-select-${w.id}`} label={`${w.name} · ${formatDate(w.startsAt, locale)}`} value={selected.includes(w.id)} onChange={(on) => setSelected(on ? [...selected, w.id] : selected.filter((x) => x !== w.id))} />
                <Txt testID={`wave-status-${w.id}`} variant="small" color={w.liveStart ? colors.primary : colors.outline}>{`${w.liveStart ? t('wavesLive') : t('wavesWaiting')} · ${(w.registrationIds ?? []).length}`}</Txt>
              </View>
            ))}
          </Card>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Button testID="wave-start" label={t('wavesStartSelected')} busy={busy} disabled={!all.some((w) => selected.includes(w.id) && !w.liveStart)} onPress={() => setLive(true)} />
          <Button testID="wave-stop" kind="outlined" label={t('wavesStopSelected')} busy={busy} disabled={!all.some((w) => selected.includes(w.id) && w.liveStart)} onPress={() => setLive(false)} />
        </View>
        <ErrorText error={error} />
      </Screen>
    </>
  );
}
