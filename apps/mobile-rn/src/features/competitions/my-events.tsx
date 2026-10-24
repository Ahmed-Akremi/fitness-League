import { useQueries } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, View } from 'react-native';

import type { Json } from '../../core/api/client';
import { useLocale, useT, type T } from '../../core/prefs';
import { useApi } from '../../core/services';
import { radius, space, useTheme } from '../../core/theme';
import { formatDate } from '../../core/utils/format';
import { EmptyState, SectionHeader, SkeletonList } from '../../core/widgets/common';
import { ErrorView } from '../../core/widgets/error';
import { Button, Icon, Segmented, Txt, type IconName } from '../../core/widgets/kit';
import { compKeys, competitionsApi, useCompetitions, useMySubmissions } from './api';
import { isPast, registrationState, requiredActions, rolesOf, sortMine, staffRoleOf, type Due, type MyRole, type RequiredAction } from './logic-my-events';
import { DEFAULT_COVER } from './screens';

/**
 * « My events » (Circle21 §3.11): the events I take part in, as an athlete, an organiser or on the staff, with what
 * is left to do in each (« Required actions »). Built from the existing routes: the list of my events, then each
 * event's detail (my registration, my roles) and, for an online event, my submissions.
 */
export function MyEventsScreen() {
  const t = useT();
  const api = useApi();
  const { colors } = useTheme();
  const list = useCompetitions('ALL', true);
  const details = useQueries({
    queries: (list.data ?? []).map((c) => ({ queryKey: compKeys.detail(c.id), queryFn: () => competitionsApi(api).get(c.id) })),
  });
  const [role, setRole] = useState<MyRole>('ATHLETE');
  const now = Date.now();
  const loaded = details.every((d) => d.data || d.isError);
  const events = sortMine(details.map((d) => d.data).filter((d): d is Json => !!d), now);
  const of = (r: MyRole) => events.filter((c) => rolesOf(c).includes(r));
  const shown = of(role);
  const upcoming = shown.filter((c) => !isPast(c, now));
  const past = shown.filter((c) => isPast(c, now));
  const count = (r: MyRole) => (loaded ? ` (${of(r).length})` : '');

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: t('myEventsTitle') }} />
      <Segmented
        value={role}
        onChange={setRole}
        options={[
          { key: 'ATHLETE', label: `${t('myEventsAsAthlete')}${count('ATHLETE')}` },
          { key: 'ORGANIZER', label: `${t('myEventsAsOrganiser')}${count('ORGANIZER')}` },
          { key: 'STAFF', label: `${t('myEventsAsStaff')}${count('STAFF')}` },
        ]}
      />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xl }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => void Promise.all([list.refetch(), ...details.map((d) => d.refetch())])} tintColor={colors.primary} />}>
        {list.isError ? (
          <ErrorView error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data || !loaded ? (
          <SkeletonList count={3} height={140} />
        ) : shown.length === 0 ? (
          <Empty role={role} />
        ) : (
          <>
            {upcoming.map((c) => (role === 'ATHLETE' ? <AthleteCard key={c.id} c={c} /> : <RoleCard key={c.id} c={c} role={role} />))}
            {past.length ? <SectionHeader title={t('myEventsPast')} /> : null}
            {past.map((c) => (role === 'ATHLETE' ? <AthleteCard key={c.id} c={c} /> : <RoleCard key={c.id} c={c} role={role} />))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Empty({ role }: { role: MyRole }) {
  const t = useT();
  const { colors } = useTheme();
  if (role === 'ATHLETE') {
    return (
      <View style={{ gap: space.md }}>
        <EmptyState icon="event-busy" message={t('myEventsNoneAthlete')} actionLabel={t('myEventsExplore')} onAction={() => router.push('/competitions')} />
        <Txt variant="small" color={colors.outline} style={{ textAlign: 'center' }}>{t('myEventsAccountHint')}</Txt>
      </View>
    );
  }
  if (role === 'ORGANIZER') return <EmptyState icon="add-business" message={t('myEventsNoneOrganiser')} actionLabel={t('createEvent')} onAction={() => router.push('/competitions/new')} />;
  return <EmptyState icon="badge" message={t('myEventsNoneStaff')} />;
}

/** The event's picture, its name, date and place: the head of every card. */
function EventHead({ c, children }: { c: Json; children?: ReactNode }) {
  const locale = useLocale();
  const { colors } = useTheme();
  return (
    <Pressable testID={`my-event-open-${c.id}`} accessibilityRole="link" accessibilityLabel={c.title} onPress={() => router.push(`/competitions/${c.id}`)} style={({ pressed }) => ({ flexDirection: 'row', gap: space.md, opacity: pressed ? 0.8 : 1 })}>
      <View style={{ width: 72, height: 72, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surfaceHigh }}>
        <Image source={c.coverUrl ? { uri: c.coverUrl } : DEFAULT_COVER} resizeMode="cover" accessibilityIgnoresInvertColors style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, width: '100%', height: '100%' }} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt style={{ fontWeight: '800', fontSize: 16 }} numberOfLines={2}>{c.title}</Txt>
        <Txt variant="small" color={colors.outline} numberOfLines={1}>{[formatDate(c.eventStart, locale, { day: 'numeric', month: 'short', year: 'numeric' }), c.city ?? c.location].filter(Boolean).join(' · ')}</Txt>
        {children}
      </View>
    </Pressable>
  );
}

function Pill({ label, color, testID }: { label: string; color: string; testID?: string }) {
  return (
    <View testID={testID} style={{ alignSelf: 'flex-start', paddingVertical: 3, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: `${color}26`, borderWidth: 1, borderColor: color }}>
      <Txt variant="small" style={{ fontWeight: '800', fontSize: 12 }} color={color}>{label}</Txt>
    </View>
  );
}

/** A plain container: it holds buttons of its own, so it cannot be one (no <button> in a <button> on the web). */
function CardShell({ children, testID }: { children: ReactNode; testID: string }) {
  const { colors } = useTheme();
  return <View testID={testID} style={{ gap: space.md, padding: space.lg, borderRadius: radius.card, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>{children}</View>;
}

const dueText = (t: T, due: Due) => (due.kind === 'DAYS' ? t('myEventsDaysLeft', { count: due.days }) : due.kind === 'TODAY' ? t('myEventsDueToday') : due.kind === 'PASSED' ? t('myEventsDeadlinePassed') : '');

/** My registration in one event: division, status, team, and what is left to do. */
function AthleteCard({ c }: { c: Json }) {
  const t = useT();
  const { colors } = useTheme();
  const r = c.myRegistration;
  const state = registrationState(c);
  const online = c.format !== 'ONSITE';
  const subs = useMySubmissions(c.id, state === 'CONFIRMED' && online);
  const sent = (subs.data ?? []).filter((s: Json) => s.status !== 'DRAFT').length;
  const actions = requiredActions(c, sent, Date.now());
  const division = (c.categories ?? []).find((k: Json) => k.id === r.categoryId);
  const tiers = Object.values(colors.tier);
  const tone = tiers[Math.max(0, (c.categories ?? []).indexOf(division)) % tiers.length];
  const stateLabel = { CONFIRMED: t('myEventsConfirmed'), PAYMENT_PENDING: t('myEventsPaymentPending'), PENDING: t('myEventsPending') }[state];
  return (
    <CardShell testID={`my-event-${c.id}`}>
      <EventHead c={c}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {division ? <Pill label={division.name} color={tone} /> : null}
          <Pill testID={`my-event-state-${c.id}`} label={stateLabel} color={state === 'CONFIRMED' ? colors.success : colors.warning} />
        </View>
      </EventHead>
      {r.teamName ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Icon name="groups" size={18} color={colors.outline} />
          <Txt variant="small">{t('compMyTeam', { name: r.teamName })}</Txt>
        </View>
      ) : null}
      {actions.length ? (
        <View testID={`my-event-actions-${c.id}`} style={{ gap: space.sm, padding: space.md, borderRadius: 14, backgroundColor: colors.surfaceHigh }}>
          <Txt variant="label" color={colors.outline}>{t('myEventsRequired')}</Txt>
          {actions.map((a) => (
            <ActionLine key={a.kind} a={a} onPress={a.kind === 'SCORES' ? () => router.push(`/competitions/${c.id}`) : undefined} />
          ))}
        </View>
      ) : !isPast(c, Date.now()) && state === 'CONFIRMED' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Icon name="check-circle" size={18} color={colors.success} />
          <Txt variant="small" color={colors.outline}>{t('myEventsAllSet')}</Txt>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {!online && state === 'CONFIRMED' ? <Button testID={`my-event-heats-${c.id}`} kind="tonal" icon="schedule" label={t('myHeatsTitle')} onPress={() => router.push(`/competitions/${c.id}/my-heats`)} /> : null}
        <Button kind="text" icon="arrow-forward" label={t('myEventsOpen')} onPress={() => router.push(`/competitions/${c.id}`)} />
      </View>
    </CardShell>
  );
}

function ActionLine({ a, onPress }: { a: RequiredAction; onPress?: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const urgent = a.due.kind === 'TODAY' || a.due.kind === 'PASSED' || (a.due.kind === 'DAYS' && a.due.days <= 3);
  const icon: IconName = a.kind === 'SCORES' ? 'videocam' : 'payments';
  const title = a.kind === 'PAYMENT' ? t('myEventsCompletePayment') : a.kind === 'BALANCE' ? t('myEventsPayBalance') : t('myEventsSubmitScores', { sent: a.sent, total: a.total });
  const due = dueText(t, a.due);
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 32 }}>
      <Icon name={icon} size={18} color={urgent ? colors.warning : colors.primary} />
      <Txt style={{ flex: 1, fontWeight: '700' }}>{title}</Txt>
      {due ? <Txt variant="small" style={{ fontWeight: '700' }} color={a.due.kind === 'PASSED' ? colors.error : urgent ? colors.warning : colors.outline}>{due}</Txt> : null}
      {onPress ? <Icon name="chevron-right" size={18} color={colors.outline} /> : null}
    </Pressable>
  );
}

/** An event I organise or work at: its status and the way into my space for it. */
function RoleCard({ c, role }: { c: Json; role: MyRole }) {
  const t = useT();
  const { colors } = useTheme();
  const staff = staffRoleOf(c);
  const staffLabel: Record<string, string> = { HEAD_JUDGE: t('myEventsHeadJudge'), JUDGE: t('myEventsJudge'), FLOOR_JUDGE: t('myEventsFloorJudge') };
  return (
    <CardShell testID={`my-event-${c.id}`}>
      <EventHead c={c}>
        <View style={{ marginTop: 4 }}>
          {role === 'ORGANIZER' ? (
            <Pill label={c.status === 'DRAFT' ? t('myEventsDraft') : t('myEventsPublished')} color={c.status === 'DRAFT' ? colors.warning : colors.success} />
          ) : staff ? (
            <Pill label={staffLabel[staff] ?? staff} color={colors.primary} />
          ) : null}
        </View>
      </EventHead>
      {role === 'ORGANIZER' ? (
        <Button testID={`my-event-manage-${c.id}`} kind="tonal" icon="tune" label={t('orgManage')} onPress={() => router.push(`/competitions/${c.id}/manage`)} />
      ) : staff === 'FLOOR_JUDGE' ? (
        <Button testID={`my-event-judge-${c.id}`} kind="tonal" icon="sports" label={t('floorOpenSpace')} onPress={() => router.push(`/competitions/${c.id}/judge`)} />
      ) : null}
    </CardShell>
  );
}
