import { useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { displayText, space, useTheme, webDense } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { Ring } from '../../../core/widgets/chart';
import { SkeletonList, StatusPill } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Card, Icon, ListRow, Screen, Txt } from '../../../core/widgets/kit';
import { Select, type Option } from '../../../core/widgets/pickers';
import { Grid, SearchField, SectionCard } from '../../../core/widgets/web';
import { useHeats } from '../api';
import { useLiveRefresh } from './api';
import { Guide } from './guide';
import type { ManageTab } from './logic';
import { filterHeats, heatDays, heatEnd, timetable } from './logic-b';
import { dayEnd, daySchedule, scheduleDay } from './logic-web';
import { OrgPageHeader } from './page';
import { DelayControls, useNow } from './timetable';

/** « Horaire du jour » on a computer (analysis §3 item 10, Circle21 ref 19): a clock ticking every second, the heat running, how far the day is, the day's heats and « Retard ». */
export function ScheduleTab({ c, onGo }: { c: Json; onGo?: (tab: ManageTab) => void }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  // Read again every 30 s while this page is on screen (analysis §3 item 11).
  const heats = useHeats(c.id, useLiveRefresh());
  // Every second, and only while this page is open: the interval stops when the page closes.
  const now = useNow(1000);
  const [day, setDay] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [workoutId, setWorkoutId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  // A failed 30 s reload keeps the clock and « Retard »: the error shows above them.
  if (!heats.data) return heats.isError ? <ErrorView error={heats.error} onRetry={() => heats.refetch()} /> : <SkeletonList label={t('orgLoading')} />;
  const all: Json[] = heats.data;
  const days = heatDays(all);
  // Until the organizer picks a day: the day of the heat running, else the one « Retard » would move.
  const shownDay = day ?? scheduleDay(all, now);
  const today = shownDay ? daySchedule(all, shownDay, now) : [];
  const dayHeats = today.map((x) => x.heat);
  const tt = timetable(dayHeats, now);
  const end = dayEnd(dayHeats);
  const visible = new Set(filterHeats(dayHeats, { day: null, categoryId, workoutId, q }).map((h) => h.id));
  const list = today.filter((x) => visible.has(x.heat.id));
  const hour = (iso: string) => formatDate(iso, locale, { hour: '2-digit', minute: '2-digit' });
  const dayLabel = (d: string, long = false) => formatDate(`${d}T12:00:00`, locale, long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' });
  const stateLabel = { done: t('orgHeatStateDone'), running: t('orgHeatStateRunning'), upcoming: t('orgHeatStateUpcoming') };
  const progress = t('orgHeatsProgress', { done: tt.done, total: tt.total, left: tt.total - tt.done });
  const pct = tt.total ? Math.round((tt.done / tt.total) * 100) : 0;
  const catOptions: Option[] = (c.categories ?? []).map((k: Json) => ({ value: k.id, label: k.name }));
  const wodOptions: Option[] = (c.workouts ?? []).map((w: Json) => ({ value: w.id, label: `${w.number}. ${w.name}` }));
  const tile = { backgroundColor: colors.surface, borderRadius: webDense.radius.card, padding: webDense.pad, minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: space.xs } as const;
  const kicker = [webDense.caption, { textTransform: 'uppercase', letterSpacing: 0.5 }] as const;

  return (
    <>
      <OrgPageHeader
        tab="timetable"
        actions={
          shownDay ? (
            <>
              <Select testID="sched-day" bare label={t('orgDay')} value={shownDay} options={days.map((d) => ({ value: d, label: dayLabel(d) }))} onChange={setDay} />
              <Select testID="sched-cat" bare label={t('orgHeatCategory')} value={categoryId ?? ''} options={[{ value: '', label: t('orgAllCategories') }, ...catOptions]} onChange={(v) => setCategoryId(v || null)} />
              <Select testID="sched-wod" bare label={t('orgHeatWod')} value={workoutId ?? ''} options={[{ value: '', label: t('orgAllWods') }, ...wodOptions]} onChange={(v) => setWorkoutId(v || null)} />
              <SearchField testID="sched-search" placeholder={t('orgHeatSearch')} value={q} onChangeText={setQ} />
            </>
          ) : undefined
        }
      />
      <Screen>
        <ErrorText error={heats.error} />
        {!shownDay ? (
          <Guide testID="guide-heats" message={t('orgNeedHeat')} action={t('orgGoHeats')} onPress={onGo && (() => onGo('planning'))} />
        ) : (
          <>
            <Grid min={240} counts={[3, 1]}>
              <View style={tile}>
                <Icon name="schedule" size={22} color={colors.outline} />
                <Txt style={kicker} color={colors.outline}>
                  {formatDate(new Date(now), locale, { weekday: 'long', day: 'numeric', month: 'short' })}
                </Txt>
                <Txt testID="sched-clock" style={displayText(28)}>
                  {formatDate(new Date(now), locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                </Txt>
                {end ? (
                  <Txt style={webDense.caption} color={colors.outline}>
                    {t('orgScheduleEnds', { time: hour(end) })}
                  </Txt>
                ) : null}
              </View>
              <View testID="sched-current" style={tile}>
                <Txt style={kicker} color={colors.outline}>
                  {t('orgCurrentHeat')}
                </Txt>
                {tt.current ? (
                  <>
                    <Txt style={{ fontSize: 18, fontWeight: '700', textAlign: 'center' }}>{tt.current.name}</Txt>
                    <Txt style={webDense.caption} color={colors.outline}>{`${hour(tt.current.startsAt)}–${hour(heatEnd(tt.current))}`}</Txt>
                  </>
                ) : (
                  <Txt style={{ fontSize: 16, fontWeight: '600' }}>{t('orgNoActiveHeat')}</Txt>
                )}
              </View>
              <View style={tile}>
                <Ring testID="sched-progress" label={progress} parts={[{ value: tt.done, color: colors.primary }, { value: tt.total - tt.done, color: 'transparent' }]}>
                  <Txt style={displayText(24)}>{`${pct}%`}</Txt>
                </Ring>
                <Txt style={webDense.caption} color={colors.outline}>
                  {progress}
                </Txt>
              </View>
            </Grid>
            <Card style={{ gap: space.sm }}>
              <DelayControls c={c} heats={all} now={now} />
            </Card>
            <SectionCard testID="sched-list" title={dayLabel(shownDay, true)} empty={list.length ? null : t('orgHeatNoMatch')}>
              {list.map(({ heat, state }) => (
                <ListRow
                  key={heat.id}
                  testID={`sched-heat-${heat.id}`}
                  title={heat.name}
                  subtitle={[`${hour(heat.startsAt)}–${hour(heatEnd(heat))}`, heat.workout?.name, heat.category?.name].filter(Boolean).join(' · ')}
                  trailing={<StatusPill label={stateLabel[state]} color={state === 'running' ? colors.primary : state === 'done' ? colors.outline : colors.text} />}
                />
              ))}
            </SectionCard>
          </>
        )}
      </Screen>
    </>
  );
}
