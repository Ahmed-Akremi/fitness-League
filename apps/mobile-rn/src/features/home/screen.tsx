import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Json } from '../../core/api/client';
import { useLocale, useT } from '../../core/prefs';
import { displayText, radius, space, useTheme } from '../../core/theme';
import { formatDate, formatMetric, localized } from '../../core/utils/format';
import { AvatarBadge, CountdownText, divisionColor, GymLogo, Loading, SectionHeader, StatCard, XpBar } from '../../core/widgets/common';
import { ErrorView } from '../../core/widgets/error';
import { Button, Card, Expander, Icon, IconButton, ListGroup, ListRow, Screen, Txt, useHeader, type IconName } from '../../core/widgets/kit';
import { authApi } from '../auth/api';
import { useGoals } from '../goals/api';
import { formatWodScore, useGymWods } from '../gym-wods/api';
import { useGym, useMyGyms } from '../gyms/api';
import { meKey, useHomeDashboard, useMe, type Me } from '../me/api';
import { NotificationBell } from '../notifications/screens';
import { useRecords } from '../progress/api';
import { useApi } from '../../core/services';

/** "I have a goal. I have progress. I have a rank. I have a reason to train today." (spec §1, §19.3) */
export function HomeScreen() {
  const { colors } = useTheme();
  const me = useMe();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  async function refresh() {
    setRefreshing(true);
    await Promise.all([qc.invalidateQueries({ queryKey: meKey }), qc.invalidateQueries({ queryKey: ['home-dashboard'] }), qc.invalidateQueries({ queryKey: ['goals'] })]);
    setRefreshing(false);
  }
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
      {me.isError ? (
        <ErrorView error={me.error} onRetry={() => me.refetch()} />
      ) : !me.data ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: space.md, gap: space.md, paddingBottom: 28 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
          <HomeBody me={me.data} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function HomeBody({ me }: { me: Me }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const dashboard = useHomeDashboard();
  const goals = useGoals();
  const profile = me.profile ?? {};
  const stats: Json = me.stats ?? {};
  const streak: Json = me.streak ?? {};
  const firstName = String(profile.fullName ?? '').split(' ')[0];
  const calibrationEnds = profile.calibrationEndsAt ? new Date(profile.calibrationEndsAt) : null;
  const calibrating = calibrationEnds != null && calibrationEnds > new Date();
  const xpInto = Number(stats.xpIntoLevel ?? 0);
  const xpNext = Number(stats.xpForNextLevel ?? 0);
  const lp: Json = dashboard.data?.lp ?? {};
  const ranks: Json = dashboard.data?.ranks ?? {};
  const week: Json = dashboard.data?.week ?? {};
  const division: string | undefined = lp.division ?? stats.division;
  const gym = profile.gym;
  const active = (goals.data ?? []).filter((g) => g.status === 'ACTIVE');

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Txt color={colors.outline} style={{ flex: 1, fontWeight: '800', letterSpacing: 1.1, fontSize: 16 }}>
          {(new Date().getHours() < 17 ? t('greetingMorning', { name: firstName }) : t('greetingEvening', { name: firstName })).toUpperCase()}
        </Txt>
        <NotificationBell />
      </View>
      {me.emailVerified !== true && (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surfaceHigh }}>
          <Icon name="mark-email-unread" />
          <Txt style={{ flex: 1 }}>{t('emailNotVerified')}</Txt>
          <Button kind="text" label={t('resendEmail')} onPress={() => authApi(api).resendVerification().catch(() => {})} />
        </Card>
      )}
      {/* Hero: season LP, division, level progress, streak. */}
      <Pressable
        testID="home-hero"
        accessibilityRole="button"
        onPress={() => router.navigate('/league')}
        style={{ padding: 20, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: divisionColor(division) + '59' }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Txt variant="label" color={colors.outline}>{t('seasonLp')}</Txt>
            <Txt style={displayText(56)}>{String(lp.lp ?? 0)}</Txt>
          </View>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <AvatarBadge name={String(profile.fullName ?? me.username)} division={division} size={56} />
            <Txt color={divisionColor(division)} style={{ fontWeight: '800' }}>{division ?? '—'}</Txt>
          </View>
        </View>
        <View style={{ marginTop: space.md }}>
          <XpBar value={xpNext === 0 ? 0 : xpInto / xpNext} label={t('level', { level: stats.level ?? 1 })} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 4 }}>
          <Txt variant="small" numberOfLines={1} style={{ flex: 1 }}>{`${t('level', { level: stats.level ?? 1 })} · ${t('xpProgress', { current: xpInto, total: xpNext })}`}</Txt>
          <Icon name="local-fire-department" color="#FF8A3D" size={18} />
          <Txt style={{ fontWeight: '700' }}>{t('weekStreak', { count: streak.currentWeeks ?? 0 })}</Txt>
        </View>
      </Pressable>
      {calibrating && (
        <Card style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <Icon name="tune" />
          <Txt style={{ flex: 1 }}>{t('calibrating', { date: formatDate(calibrationEnds!, locale) })}</Txt>
        </Card>
      )}
      {dashboard.isError && <ErrorView error={dashboard.error} onRetry={() => dashboard.refetch()} />}
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Tile label={t('rankNationalShort')} value={ranks.national == null ? '—' : `#${ranks.national}`} onPress={() => router.navigate('/league')} />
        <Tile label={localized(profile.governorate?.name, locale)} value={ranks.governorate == null ? '—' : `#${ranks.governorate}`} onPress={() => router.navigate('/league')} />
        <Tile label={t('thisWeek')} value={week.total == null ? '—' : String(Math.round(week.total))} caption={week.total == null ? undefined : `${week.trainingDays}/${week.plannedDays}`} />
      </View>
      <SectionHeader title={t('myGym')} actionLabel={t('gymsTitle')} onAction={() => router.push('/gyms')} />
      {gym ? (
        <MyGymCard gymId={gym.id} gymName={gym.name} />
      ) : (
        <Card onPress={() => router.push('/gyms')}>
          <ListRow icon="storefront" title={t('findGym')} subtitle={t('findGymHint')} chevron />
        </Card>
      )}
      <SectionHeader title={t('yourGoal')} actionLabel={t('navChallenges')} onAction={() => router.navigate('/goals')} />
      {goals.data &&
        (active.length === 0 ? (
          <Card onPress={() => router.navigate('/goals')}>
            <ListRow icon="outlined-flag" title={t('emptyGoals')} />
          </Card>
        ) : (
          <GoalCard goal={active[0]} onPress={() => router.navigate('/goals')} />
        ))}
      <SectionHeader title={t('shortcuts')} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(
          [
            ['emoji-events', t('records'), '/records'],
            ['group', t('friends'), '/friends'],
            ['sports-mma', t('battles'), '/battles'],
            ['dynamic-feed', t('feed'), '/feed'],
            ['military-tech', t('competitions'), '/competitions'],
          ] as [IconName, string, string][]
        ).map(([icon, label, route]) => (
          <Pressable key={route} accessibilityRole="button" onPress={() => router.push(route as never)} style={{ flex: 1, alignItems: 'center', gap: space.xs, paddingVertical: space.md, paddingHorizontal: space.xs, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
            <Icon name={icon} color={colors.primary} />
            <Txt variant="small" numberOfLines={2} style={{ fontSize: 12, textAlign: 'center' }}>{label}</Txt>
          </Pressable>
        ))}
      </View>
      <Button testID="home-log-workout" icon="add" label={t('logWorkout').toUpperCase()} onPress={() => router.push('/workouts/new')} style={{ marginTop: 8 }} />
    </>
  );
}

export function GoalCard({ goal: g, onPress }: { goal: Json; onPress?: () => void }) {
  const t = useT();
  const locale = useLocale();
  const unit = g.metric?.unit ?? '';
  const milestones: unknown[] = g.milestones ?? [];
  return (
    <StatCard label={t('yourGoal')} onPress={onPress}>
      {/* Numbers and units read left-to-right, also in Arabic. */}
      <Txt style={[displayText(28), { writingDirection: 'ltr' }]}>{`${formatMetric(g.startValue, unit, locale)} → ${formatMetric(g.targetValue, unit, locale)}`}</Txt>
      <View style={{ marginVertical: 8 }}>
        <XpBar value={milestones.length === 0 ? 0 : g.milestonesReached / milestones.length} />
      </View>
      <Txt variant="small">{t('goalMilestones', { reached: g.milestonesReached ?? 0, total: milestones.length })}</Txt>
    </StatCard>
  );
}

function Tile({ label, value, caption, onPress }: { label: string; value: string; caption?: string; onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={{ flex: 1, backgroundColor: colors.surface, borderRadius: radius.card, padding: space.md, borderWidth: 1, borderColor: colors.border }}>
      <Txt variant="label" numberOfLines={1} color={colors.outline} style={{ fontSize: 11, letterSpacing: 1 }}>{label}</Txt>
      <Txt style={[displayText(28), { marginTop: 4 }]}>{value}</Txt>
      {caption ? <Txt variant="small">{caption}</Txt> : null}
    </Pressable>
  );
}

/** "My gym": logo, name and the WOD running now (or a hint), tapping opens the gym. */
function MyGymCard({ gymId, gymName }: { gymId: string; gymName: string }) {
  const t = useT();
  const { colors } = useTheme();
  const gym = useGym(gymId).data;
  const wod: Json | undefined = useGymWods(gymId, 'active').data?.data?.[0];
  return (
    <Card onPress={() => router.push(`/gyms/${gymId}`)} style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <GymLogo name={gymName} url={gym?.logoUrl} size={52} />
        <Txt variant="title" style={{ flex: 1, fontSize: 20, fontWeight: '800' }}>{gymName}</Txt>
        <Icon name="chevron-right" />
      </View>
      {wod && (
        <Pressable onPress={() => router.push(`/gyms/${gymId}/wods/${wod.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: colors.surfaceHigh, paddingTop: 12 }}>
          <Icon name="local-fire-department" color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Txt variant="title">{wod.title}</Txt>
            <CountdownText endsAt={wod.endsAt} style={{ color: colors.outline, fontSize: 13 }} />
          </View>
          {wod.myScore == null ? (
            <Txt color={colors.primary} style={{ fontWeight: '700' }}>{t('wodSubmitScore')}</Txt>
          ) : (
            <Txt style={displayText(22)}>{formatWodScore(wod.scoreType, wod.myScore)}</Txt>
          )}
        </Pressable>
      )}
    </Card>
  );
}

export function ProfileScreen() {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const me = useMe();
  const records = useRecords().data ?? [];
  const myGyms = useMyGyms().data ?? [];
  useHeader({ headerRight: () => <IconButton icon="settings" label={t('settings')} onPress={() => router.push('/settings')} /> });
  if (me.isError) return <ErrorView error={me.error} onRetry={() => me.refetch()} />;
  if (!me.data) return <Loading />;
  const profile = me.data.profile ?? {};
  const stats: Json = me.data.stats ?? {};
  return (
    <Screen>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <AvatarBadge name={String(profile.fullName ?? me.data.username)} division={stats.division} size={96} />
        <Txt style={displayText(30)}>{profile.fullName ?? me.data.username}</Txt>
        <Txt color={colors.outline}>{`@${me.data.username} · ${t('level', { level: stats.level ?? 1 })}${stats.division ? ` · ${stats.division}` : ''}`}</Txt>
      </View>
      <Card style={{ paddingVertical: 4 }}>
        {profile.gym ? (
          <ListRow icon="fitness-center" title={profile.gym.name} chevron onPress={() => router.push(`/gyms/${profile.gym!.id}`)} />
        ) : (
          <ListRow icon="storefront" title={t('findGym')} onPress={() => router.push('/gyms')} />
        )}
      </Card>
      {/* Gyms I submitted that are not verified yet (verified ones show as "my gym" above). */}
      {myGyms
        .filter((g) => g.status !== 'VERIFIED')
        .map((g) => (
          <Card key={g.id} style={{ paddingVertical: 4 }}>
            <ListRow leading={<GymLogo name={g.name} url={g.logoUrl} size={40} />} title={g.name} subtitle={g.status === 'REJECTED' ? t('gymRejected') : t('gymPending')} trailing={<Icon name={g.status === 'REJECTED' ? 'cancel' : 'hourglass-top'} />} />
          </Card>
        ))}
      <SectionHeader title={t('profileGroupProgress')} />
      <ListGroup>
        <ListRow icon="insights" title={t('myProgress')} chevron onPress={() => router.push('/progress')} />
        <Expander icon="emoji-events" title={t('records')}>
          {records.map((r, i) => (
            <ListRow key={i} title={`${localized(r.exercise?.name, locale)} · ${r.metric?.code}`} trailing={<Txt variant="title">{formatMetric(r.value, r.metric?.unit, locale)}</Txt>} />
          ))}
        </Expander>
        <ListRow icon="emoji-events" title={t('allRecords')} chevron onPress={() => router.push('/records')} />
        <ListRow icon="military-tech" title={t('badges')} chevron onPress={() => router.push('/badges')} />
      </ListGroup>
      <SectionHeader title={t('profileGroupSocial')} />
      <ListGroup>
        <ListRow icon="group" title={t('friends')} chevron onPress={() => router.push('/friends')} />
        <ListRow icon="sports-mma" title={t('battles')} chevron onPress={() => router.push('/battles')} />
        <ListRow icon="military-tech" title={t('competitions')} chevron onPress={() => router.push('/competitions')} />
      </ListGroup>
      <SectionHeader title={t('profileGroupAccount')} />
      <ListGroup>
        <ListRow icon="add-business" title={t('addMyGym')} chevron onPress={() => router.push('/gyms/new')} />
        <ListRow icon="monitor-weight" title={t('body')} chevron onPress={() => router.push('/me/body')} />
        <ListRow icon="settings" title={t('settings')} chevron onPress={() => router.push('/settings')} />
      </ListGroup>
    </Screen>
  );
}
