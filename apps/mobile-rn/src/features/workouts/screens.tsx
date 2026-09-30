import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { useLocale, useT } from '../../core/prefs';
import { useServices } from '../../core/services';
import { useTheme } from '../../core/theme';
import { formatDate, formatDuration, formatMetric, formatNumber } from '../../core/utils/format';
import { EmptyState, Loading, StatCard } from '../../core/widgets/common';
import { ErrorView } from '../../core/widgets/error';
import { Card, Icon, IconButton, Txt } from '../../core/widgets/kit';
import { ProofsSection } from './proofs';
import { explainPoints, usePendingWorkouts, useWorkoutDetail, useWorkouts, workoutKeys, type Workout } from './api';

export function TrainScreen() {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const { sync } = useServices();
  const qc = useQueryClient();
  const workouts = useWorkouts();
  const pending = usePendingWorkouts();
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    await sync.flush().catch(() => 0);
    await Promise.all([qc.invalidateQueries({ queryKey: workoutKeys.outbox }), qc.invalidateQueries({ queryKey: workoutKeys.list })]);
    setRefreshing(false);
  }

  const queued = pending.data ?? [];
  let body;
  if (workouts.isError) body = <ErrorView error={workouts.error} onRetry={() => workouts.refetch()} />;
  else if (!workouts.data) body = <Loading />;
  else if (workouts.data.data.length === 0 && queued.length === 0)
    body = (
      <View style={{ paddingTop: 80 }}>
        <EmptyState icon="fitness-center" message={t('emptyWorkouts')} actionLabel={t('logWorkout')} onAction={() => router.push('/workouts/new')} />
      </View>
    );
  else
    body = (
      <View style={{ gap: 10 }}>
        {queued.map((q) => (
          <Card key={q.clientId} testID={`queued-${q.clientId}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Icon name={q.status === 'pending' ? 'cloud-upload' : 'error-outline'} />
            <View style={{ flex: 1 }}>
              <Txt variant="title">{formatDate(String(q.payload.performedAt), locale)}</Txt>
              <Txt variant="small" color={colors.outline}>{q.status === 'pending' ? t('pendingSync') : q.status === 'rejected' ? t('statusRejected') : t('errorGeneric')}</Txt>
            </View>
            {q.status !== 'pending' && (
              <IconButton
                icon="delete-outline"
                label={t('delete')}
                onPress={async () => {
                  await sync.discard(q.clientId);
                  await qc.invalidateQueries({ queryKey: workoutKeys.outbox });
                }}
              />
            )}
          </Card>
        ))}
        {workouts.data.data.map((w) => (
          <WorkoutTile key={w.id} workout={w} />
        ))}
      </View>
    );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 96 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
        {body}
      </ScrollView>
      <Pressable
        testID="train-log"
        accessibilityRole="button"
        onPress={() => router.push('/workouts/new')}
        style={{ position: 'absolute', end: 16, bottom: 16, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: 18, paddingHorizontal: 20, paddingVertical: 16, elevation: 4 }}
      >
        <Icon name="add" color={colors.onPrimary} />
        <Txt style={{ color: colors.onPrimary, fontWeight: '700' }}>{t('logWorkout')}</Txt>
      </Pressable>
    </View>
  );
}

function WorkoutTile({ workout }: { workout: Workout }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const [label, color] =
    workout.status === 'ACCEPTED' ? [t('statusAccepted'), colors.primary] : workout.status === 'HELD_FOR_REVIEW' ? [t('statusHeld'), '#FFB020'] : [t('statusRejected'), colors.error];
  const volume = workout.totalVolumeKg;
  const distance = workout.totalDistanceM;
  const subtitle = [volume && volume > 0 ? `${formatNumber(volume, locale)} kg` : null, distance && distance > 0 ? formatMetric(distance, 'm', locale) : null].filter(Boolean).join(' · ');
  return (
    <Card testID={`workout-${workout.id}`} onPress={() => router.push(`/workouts/${workout.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Txt variant="title">{`${formatDate(workout.performedAt, locale)} · ${formatDuration(workout.durationS)}`}</Txt>
        {subtitle ? <Txt variant="small" color={colors.outline}>{subtitle}</Txt> : null}
      </View>
      <View style={{ borderWidth: 1, borderColor: color, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
        <Txt variant="small" color={color} style={{ fontWeight: '700' }}>{label}</Txt>
      </View>
    </Card>
  );
}

export function WorkoutDetailScreen({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const detail = useWorkoutDetail(id);
  if (detail.isError) return <ErrorView error={detail.error} onRetry={() => detail.refetch()} />;
  if (!detail.data) return <Loading />;
  const [w, points] = detail.data;
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 20, gap: 12 }}>
      <View>
        <Txt variant="title" style={{ fontSize: 22 }}>{formatDate(w.performedAt, locale, { dateStyle: 'full' })}</Txt>
        <Txt>{formatDuration(w.durationS)}</Txt>
      </View>
      {w.status === 'HELD_FOR_REVIEW' && (
        <Card style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <Icon name="hourglass-top" />
          <Txt style={{ flex: 1 }}>{t('workoutHeldInfo')}</Txt>
        </Card>
      )}
      {(w.exercises ?? []).map((e, i) => (
        <StatCard key={i} label={t('exercise')}>
          {e.sets.map((s, j) => (
            <Txt key={j}>
              {[
                s.reps != null ? `${s.reps} ×` : null,
                s.weightKg != null ? `${formatNumber(s.weightKg, locale)} kg` : null,
                s.distanceM != null ? formatMetric(s.distanceM, 'm', locale) : null,
                s.durationS != null ? formatDuration(s.durationS) : null,
                s.isWarmup ? `(${t('warmup')})` : null,
              ]
                .filter(Boolean)
                .join(' ')}
            </Txt>
          ))}
        </StatCard>
      ))}
      {(w.status === 'ACCEPTED' || w.status === 'HELD_FOR_REVIEW') && <ProofsSection workoutId={id} />}
      <StatCard label={t('whyThesePoints')} trailing={<Txt variant="title" color={colors.primary}>{t('totalXp', { xp: points.totalXp })}</Txt>}>
        {points.entries.map((e, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
            <View style={{ flex: 1 }}>
              <Txt>{e.reason}</Txt>
              <Txt variant="small" color={colors.outline}>{explainPoints(e.explanation)}</Txt>
            </View>
            <Txt variant="title">{`${e.amount > 0 ? '+' : ''}${e.amount}`}</Txt>
          </View>
        ))}
      </StatCard>
    </ScrollView>
  );
}
