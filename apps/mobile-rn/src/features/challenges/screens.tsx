import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import type { Json } from '../../core/api/client';
import { useT, type T } from '../../core/prefs';
import { useApi } from '../../core/services';
import { displayText, useTheme } from '../../core/theme';
import { CountdownText, EmptyState, Loading, RankRow, SectionHeader, SkeletonList, XpBar } from '../../core/widgets/common';
import { ErrorText, ErrorView, errorMessage } from '../../core/widgets/error';
import { Button, Card, Chip, Fab, Icon, Screen, Segmented, TextField, Txt, toast } from '../../core/widgets/kit';
import { GoalsList } from '../goals/screen';
import { useMe } from '../me/api';
import { challengeKeys, challengesApi, useChallenge, useChallenges } from './api';

export const challengeMetricLabel = (t: T, metric: string) =>
  metric === 'WORKOUTS'
    ? t('metricWorkouts')
    : metric === 'TRAINING_DAYS'
      ? t('metricTrainingDays')
      : metric === 'DURATION_MIN'
        ? t('metricDurationMin')
        : metric === 'DISTANCE_KM'
          ? t('metricDistanceKm')
          : t('metricVolumeKg');

export const challengeScopeLabel = (t: T, scope: string) =>
  scope === 'PERSONAL' ? t('scopePersonal') : scope === 'FRIEND' ? t('scopeFriends') : scope === 'GYM' ? t('scopeGym') : t('scopeCommunity');

export const fmtAmount = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** Bottom-bar "Challenges" tab: challenges and personal goals. */
export function ChallengesTabScreen() {
  const t = useT();
  const { colors } = useTheme();
  const [tab, setTab] = useState<'challenges' | 'goals'>('challenges');
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { key: 'challenges', label: t('challenges') },
            { key: 'goals', label: t('goals') },
          ]}
        />
      </View>
      {tab === 'challenges' ? <ChallengesList /> : <GoalsList />}
    </View>
  );
}

export function ChallengesList() {
  const t = useT();
  const { colors } = useTheme();
  const [ended, setEnded] = useState(false);
  const rows = useChallenges(ended);
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 96, gap: 12 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => rows.refetch()} tintColor={colors.primary} />}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip testID="challenges-active" label={t('challengesActive')} selected={!ended} onPress={() => setEnded(false)} />
          <Chip testID="challenges-ended" label={t('challengesEnded')} selected={ended} onPress={() => setEnded(true)} />
        </View>
        {rows.isError ? (
          <ErrorView error={rows.error} onRetry={() => rows.refetch()} />
        ) : !rows.data ? (
          <Loading />
        ) : rows.data.length === 0 ? (
          <EmptyState icon="outlined-flag" message={t('noChallenges')} />
        ) : (
          rows.data.map((c) => <ChallengeCard key={c.id} challenge={c} />)
        )}
      </ScrollView>
      <Fab testID="challenge-new" label={t('newChallenge')} onPress={() => router.push('/challenges/new')} />
    </View>
  );
}

export function ChallengeCard({ challenge: c }: { challenge: Json }) {
  const t = useT();
  const { colors } = useTheme();
  const target = Number(c.target);
  const mine: number | null = c.myProgress ?? null;
  return (
    <Card testID={`challenge-${c.id}`} onPress={() => router.push(`/challenges/${c.id}`)} style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Txt variant="title" style={{ flex: 1 }}>{c.title}</Txt>
        {c.completedAt != null && <Icon name="check-circle" color={colors.primary} />}
      </View>
      <Txt variant="small" color={colors.outline}>
        {`${challengeScopeLabel(t, c.scope)} · ${fmtAmount(target)} ${challengeMetricLabel(t, c.metric)} · ${t('participantsCount', { count: c.participants ?? 0 })}`}
      </Txt>
      {mine != null && (
        <View style={{ marginTop: 8, gap: 4 }}>
          <XpBar value={mine / target} />
          <Txt variant="small">{`${fmtAmount(mine)} / ${fmtAmount(target)}`}</Txt>
        </View>
      )}
      {c.status === 'ACTIVE' && <CountdownText endsAt={c.endsAt} style={{ color: colors.outline, fontSize: 13, marginTop: 4 }} />}
    </Card>
  );
}

/** One challenge: target, my progress, join / leave, leaderboard. */
export function ChallengeScreen({ id }: { id: string }) {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const challenge = useChallenge(id);
  const myId = useMe().data?.id;
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    try {
      await action();
      await qc.invalidateQueries({ queryKey: ['challenges'] });
      after?.();
    } catch (e) {
      toast(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  if (challenge.isError) return <ErrorView error={challenge.error} onRetry={() => challenge.refetch()} />;
  if (!challenge.data) return <SkeletonList count={3} height={96} />;
  const c = challenge.data;
  const repo = challengesApi(api);
  const target = Number(c.target);
  const mine: number | null = c.myProgress ?? null;
  const joined = c.joined === true;
  const open = c.status === 'ACTIVE' || c.status === 'UPCOMING';
  const isAuthor = c.createdById === myId;
  const selfMade = c.scope === 'PERSONAL' || c.scope === 'FRIEND';
  const board: Json[] = c.leaderboard ?? [];
  return (
    <Screen>
      <Txt style={displayText(30)}>{c.title}</Txt>
      <Txt color={colors.outline}>{`${challengeScopeLabel(t, c.scope)}${c.gym ? ` · ${c.gym.name}` : ''}`}</Txt>
      {c.description ? <Txt>{c.description}</Txt> : null}
      <Card style={{ gap: 6 }}>
        <Txt variant="title">{t('challengeGoal', { target: fmtAmount(target), metric: challengeMetricLabel(t, c.metric) })}</Txt>
        {Number(c.xpReward ?? 0) > 0 && <Txt variant="small" color={colors.primary}>{t('challengeXp', { xp: c.xpReward })}</Txt>}
        {mine != null && (
          <>
            <XpBar value={mine / target} />
            <Txt variant="title">{c.completedAt != null ? t('challengeCompleted') : `${fmtAmount(mine)} / ${fmtAmount(target)}`}</Txt>
          </>
        )}
        {c.status === 'ACTIVE' && <CountdownText endsAt={c.endsAt} />}
      </Card>
      {open && !joined && c.scope !== 'PERSONAL' && <Button testID="challenge-join" label={t('challengeJoin')} busy={busy} onPress={() => run(() => repo.join(id))} />}
      {open && joined && !(isAuthor && selfMade) && c.completedAt == null && <Button testID="challenge-leave" kind="outlined" label={t('challengeLeave')} disabled={busy} onPress={() => run(() => repo.leave(id))} />}
      {isAuthor && <Button kind="text" label={t('delete')} disabled={busy} onPress={() => run(() => repo.remove(id), () => router.canGoBack() && router.back())} />}
      {board.length > 0 && (
        <>
          <SectionHeader title={t('leaderboard')} />
          {board.map((p) => (
            <RankRow key={p.userId} rank={p.rank} name={p.fullName ?? p.username} value={p.completed ? `✓ ${fmtAmount(p.progress)}` : fmtAmount(p.progress)} highlight={p.userId === myId} />
          ))}
        </>
      )}
    </Screen>
  );
}

const METRICS = ['WORKOUTS', 'TRAINING_DAYS', 'DURATION_MIN', 'DISTANCE_KM', 'VOLUME_KG'];

/** Personal or friends challenge: a title, a quantity, a target and a duration starting now. */
export function NewChallengeScreen() {
  const t = useT();
  const api = useApi();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('12');
  const [scope, setScope] = useState<'FRIEND' | 'PERSONAL'>('FRIEND');
  const [metric, setMetric] = useState('WORKOUTS');
  const [days, setDays] = useState<'7' | '14' | '30'>('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const targetValue = Number(target.replace(',', '.'));
  const valid = title.trim().length >= 3 && targetValue >= 1;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const now = new Date();
      const c = await challengesApi(api).create({
        scope,
        title: title.trim(),
        metric,
        targetValue,
        startsAt: now.toISOString(),
        endsAt: new Date(now.getTime() + Number(days) * 86400_000).toISOString(),
      });
      await qc.invalidateQueries({ queryKey: ['challenges'] });
      router.replace(`/challenges/${c.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <TextField testID="challenge-title" label={t('challengeTitle')} value={title} onChangeText={setTitle} maxLength={80} />
      <SectionHeader title={t('challengeWho')} />
      <Segmented flush
        value={scope}
        onChange={setScope}
        options={[
          { key: 'FRIEND', label: t('scopeFriends') },
          { key: 'PERSONAL', label: t('scopePersonal') },
        ]}
      />
      <SectionHeader title={t('challengeWhat')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {METRICS.map((m) => (
          <Chip key={m} testID={`metric-${m}`} label={challengeMetricLabel(t, m)} selected={metric === m} onPress={() => setMetric(m)} />
        ))}
      </View>
      <TextField testID="challenge-target" label={`${t('challengeTarget')} (${challengeMetricLabel(t, metric)})`} value={target} onChangeText={(v) => setTarget(v.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad" />
      <SectionHeader title={t('battleDuration')} />
      <Segmented flush
        value={days}
        onChange={setDays}
        options={(['7', '14', '30'] as const).map((d) => ({ key: d, label: t('days', { count: Number(d) }) }))}
      />
      <ErrorText error={error} />
      <Button testID="challenge-create" label={t('createChallenge')} busy={busy} disabled={!valid} onPress={create} style={{ marginTop: 12 }} />
    </Screen>
  );
}
