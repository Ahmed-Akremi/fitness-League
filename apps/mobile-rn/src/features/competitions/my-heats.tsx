import { Stack } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';

import type { Json } from '../../core/api/client';
import { useLocale, useT } from '../../core/prefs';
import { displayText, space, useTheme } from '../../core/theme';
import { formatDate } from '../../core/utils/format';
import { EmptyState, SkeletonList, StatusPill } from '../../core/widgets/common';
import { ErrorView } from '../../core/widgets/error';
import { Card, Icon, Txt } from '../../core/widgets/kit';
import { useCompetition, useHeats, useMySubmissions } from './api';
import { scoreSummary } from './judge/screens';

export type MyHeatState = 'scored' | 'live' | 'upcoming';

/** Scored once the score is FINAL; live once the heat's clock has started; upcoming before. */
export function myHeatState(heat: Json, submission: Json | undefined): MyHeatState {
  if (submission?.status === 'FINAL') return 'scored';
  return heat.startedAt ? 'live' : 'upcoming';
}

/**
 * « Mon heat » (on-site events): the athlete's heats in running order — lane, WOD, time — and the validated score of
 * each. Read from the existing heats and my-submissions routes; who judges the lane is not shown.
 */
export function MyHeatsScreen({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const comp = useCompetition(id);
  const heats = useHeats(id, 30_000);
  const subs = useMySubmissions(id, true);
  const error = comp.error ?? heats.error ?? subs.error;
  if (error) return <ErrorView error={error} onRetry={() => void Promise.all([comp.refetch(), heats.refetch(), subs.refetch()])} />;
  if (!comp.data || !heats.data || !subs.data) return <SkeletonList count={3} height={120} />;

  const byWorkout = new Map<string, Json>(subs.data.map((s) => [s.workout?.id ?? s.workoutId, s]));
  const workouts = new Map<string, Json>((comp.data.workouts ?? []).map((w: Json) => [w.id, w]));
  const mine = heats.data.flatMap((h) => (h.lanes ?? []).filter((l: Json) => l.mine).map((l: Json) => ({ heat: h, lane: l.lane as number })));
  const label = { scored: t('myHeatScored'), live: t('myHeatLive'), upcoming: t('myHeatUpcoming') };
  const tone = { scored: colors.success, live: colors.primary, upcoming: colors.outline };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: t('myHeatsTitle') }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void Promise.all([heats.refetch(), subs.refetch()])} tintColor={colors.primary} />}
      >
        {mine.length === 0 ? (
          <EmptyState icon="event-note" message={t('myHeatsNone')} />
        ) : (
          mine.map(({ heat, lane }) => {
            const s = heat.workout ? byWorkout.get(heat.workout.id) : undefined;
            const state = myHeatState(heat, s);
            const w = heat.workout ? workouts.get(heat.workout.id) : undefined;
            const score = state === 'scored' && s?.raw ? scoreSummary(t, s.workout?.scoreType ?? w?.scoreType, s.raw, w?.movements ?? []) : null;
            return (
              <Card key={heat.id} testID={`my-heat-${heat.id}`} style={{ gap: space.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <Txt variant="label" style={{ flex: 1 }}>{heat.name}</Txt>
                  <StatusPill label={label[state]} color={tone[state]} />
                </View>
                <Txt style={displayText(40)}>{t('compLane', { lane })}</Txt>
                <View style={{ gap: space.xs }}>
                  <Line icon="fitness-center" text={heat.workout?.name ?? '—'} />
                  <Line icon="schedule" text={heat.startsAt ? formatDate(heat.startsAt, locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : t('myHeatNoTime')} />
                  {heat.category?.name ? <Line icon="category" text={heat.category.name} /> : null}
                </View>
                <View testID={`my-heat-score-${heat.id}`} style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm, borderTopWidth: 1, borderTopColor: colors.surfaceHigh, paddingTop: space.sm }}>
                  {score ? (
                    <>
                      <Txt style={[displayText(28), { flex: 1 }]}>{score}</Txt>
                      {s?.points != null ? <Txt style={displayText(28)} color={colors.primary}>{t('compPoints', { points: Number(s.points) })}</Txt> : null}
                    </>
                  ) : (
                    <Txt color={colors.outline}>{t('myHeatNoScore')}</Txt>
                  )}
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function Line({ icon, text }: { icon: 'fitness-center' | 'schedule' | 'category'; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <Icon name={icon} size={18} color={colors.outline} />
      <Txt>{text}</Txt>
    </View>
  );
}
