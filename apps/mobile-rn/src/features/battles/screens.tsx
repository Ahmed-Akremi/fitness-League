import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import type { Json } from '../../core/api/client';
import { useT, type T } from '../../core/prefs';
import { useApi, useServices } from '../../core/services';
import { displayText, useTheme } from '../../core/theme';
import { AvatarBadge, CountdownText, EmptyState, Loading, SectionHeader, SkeletonList, XpBar } from '../../core/widgets/common';
import { ErrorText, ErrorView, errorMessage } from '../../core/widgets/error';
import { Button, Card, Chip, Fab, Icon, ListRow, Segmented, Txt, toast, useHeader } from '../../core/widgets/kit';
import { useCurrentGymWar } from '../gym-wars/api';
import { useMe } from '../me/api';
import { useFriends } from '../social/api';
import { battleKeys, battlesApi } from './api';

const COMPONENTS = ['progress', 'consistency', 'performance'];
const componentLabel = (t: T, c: string) => (c === 'progress' ? t('componentProgress') : c === 'consistency' ? t('componentConsistency') : t('componentPerformance'));

type Tab = 'ACTIVE' | 'PENDING' | 'COMPLETED';

/** Battles by state: active, invites (pending), finished. */
export function BattlesScreen() {
  const t = useT();
  const { colors } = useTheme();
  const [tab, setTab] = useState<Tab>('ACTIVE');
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 96 }}>
        <DuelCard />
        <GymWarCard />
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { key: 'ACTIVE', label: t('battlesActive') },
            { key: 'PENDING', label: t('battlesInvites') },
            { key: 'COMPLETED', label: t('battlesFinished') },
          ]}
        />
        <BattleList key={tab} status={tab} />
      </ScrollView>
      <Fab testID="battle-new" icon="sports-mma" label={t('newBattle')} onPress={() => router.push('/battles/new')} />
    </View>
  );
}

/** This week's Gym War of my primary gym, when there is one. */
function GymWarCard() {
  const t = useT();
  const { colors } = useTheme();
  const war: Json | undefined = useCurrentGymWar().data?.war;
  if (!war || war.status === 'BYE') return null;
  const gyms: Json[] = war.gyms ?? [];
  const mine = gyms.find((g) => g.isMine) ?? gyms[0];
  const them = gyms.find((g) => g !== mine);
  if (!mine || !them) return null;
  const score = (g: Json) => (g.score == null ? '—' : Number(g.score).toFixed(1));
  return (
    <Card style={{ marginHorizontal: 12, marginTop: 12, paddingVertical: 4 }}>
      <ListRow
        leading={<Icon name="shield" color={colors.primary} />}
        title={t('gymWarThisWeek')}
        subtitle={`${mine.name} ${score(mine)} – ${score(them)} ${them.name}`}
        chevron
        onPress={() => router.push(`/gym-wars/${war.id}`)}
      />
    </Card>
  );
}

/** Weekly Duel: join or leave the queue, see the MMR and open the duel of the week (docs §6.1). */
function DuelCard() {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const loaded = useQuery({ queryKey: battleKeys.duel, queryFn: () => battlesApi(api).duelStatus(), retry: false });
  const [status, setStatus] = useState<Json | null>(null);
  const [busy, setBusy] = useState(false);
  const s = status ?? loaded.data;
  if (!s) return null; // the card simply stays hidden

  async function run(call: () => Promise<Json>) {
    setBusy(true);
    try {
      setStatus(await call());
    } catch (e) {
      toast(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  const rating: Json = s.rating ?? {};
  const duel: Json | null = s.currentDuel ?? null;
  const waiting = s.entry?.status === 'WAITING';
  const repo = battlesApi(api);
  let action;
  if (duel && !waiting) action = <Button icon="sports-mma" label={t('duelSeeDuel')} onPress={() => router.push(`/battles/${duel.battleId}`)} />;
  else if (waiting) action = <Button testID="duel-leave" kind="outlined" label={t('duelLeave')} disabled={busy} onPress={() => run(repo.leaveDuel)} />;
  else if (s.queueOpen === true) action = <Button testID="duel-join" label={t('duelJoin')} busy={busy} onPress={() => run(repo.joinDuel)} />;
  else action = <Txt color={colors.outline}>{t('duelQueueClosed')}</Txt>;

  return (
    <Card testID="duel-card" style={{ marginHorizontal: 12, marginTop: 12, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="bolt" color={colors.primary} />
        <Txt variant="title" style={{ flex: 1 }}>{t('weeklyDuel')}</Txt>
        <Txt variant="small">{t('duelRating', { rating: Math.trunc(rating.rating ?? 0), games: Math.trunc(rating.games ?? 0) })}</Txt>
      </View>
      <Txt>{duel?.isGhost ? t('duelGhost') : waiting ? t('duelWaiting') : t('duelIntro')}</Txt>
      <View style={{ alignItems: 'flex-end', marginTop: 4 }}>{action}</View>
    </Card>
  );
}

function BattleList({ status }: { status: Tab }) {
  const t = useT();
  const api = useApi();
  const page = useQuery({ queryKey: battleKeys.list(status), queryFn: () => battlesApi(api).list(status) });
  if (page.isError) return <ErrorView error={page.error} onRetry={() => page.refetch()} />;
  if (!page.data) return <Loading />;
  const rows: Json[] = page.data.data ?? [];
  if (rows.length === 0) return <EmptyState icon="sports-mma" message={t('noBattles')} />;
  return (
    <View style={{ padding: 12, gap: 8 }}>
      {rows.map((b) => (
        <Card key={b.id} testID={`battle-${b.id}`} style={{ paddingVertical: 4 }}>
          <ListRow
            icon={b.type === 'DUEL' ? 'bolt' : 'sports-mma'}
            title={b.type === 'DUEL' ? (b.isGhost ? t('duelGhost') : t('weeklyDuel')) : t('days', { count: b.durationDays ?? 0 })}
            trailing={b.endsAt ? <CountdownText endsAt={b.endsAt} /> : <Txt>{t('pending')}</Txt>}
            chevron
            onPress={() => router.push(`/battles/${b.id}`)}
          />
        </Card>
      ))}
    </View>
  );
}

/** Face-to-face battle: live scores (polled every 30 s while active), components, actions, result. */
export function BattleScreen({ id }: { id: string }) {
  const t = useT();
  const { colors } = useTheme();
  const { api, realtime } = useServices();
  const myId = useMe().data?.id ?? '';
  const [battle, setBattle] = useState<Json | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const repo = battlesApi(api);

  const load = useCallback(async () => {
    try {
      setBattle(await battlesApi(api).get(id));
    } catch (e) {
      setError(e);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
    // Live score: the server says when a participant's workouts change; polling stays as the fallback.
    realtime.subscribeBattle(id);
    const off = realtime.onBattleScore((battleId) => battleId === id && void load());
    return () => {
      off();
      realtime.unsubscribeBattle(id);
    };
  }, [id, load, realtime]);

  const active = battle?.status === 'ACTIVE';
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [active, load]);

  useHeader({ title: battle?.type === 'DUEL' ? t('weeklyDuel') : t('battles') }, [battle?.type]);

  async function act(action: 'accept' | 'decline' | 'cancel') {
    setBusy(true);
    try {
      await repo.act(id, action);
      await load();
    } catch (e) {
      toast(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  if (!battle) return error != null ? <ErrorView error={error} onRetry={load} /> : <SkeletonList count={3} height={120} />;
  const b = battle;
  const parts: Json[] = b.participants ?? [];
  const me = parts.find((p) => p.userId === myId) ?? parts[0];
  // A ghost duel has one participant: the opponent is the athlete's own previous week.
  const them: Json = b.isGhost ? { userId: null, fullName: t('duelGhostOpponent'), score: b.ghostTarget } : parts.find((p) => p.userId !== me?.userId) ?? {};
  const iCreated = b.createdById === myId;
  const mine = Number(me?.score ?? 0);
  const theirs = Number(them.score ?? 0);
  const share = mine + theirs === 0 ? 0.5 : mine / (mine + theirs);
  const outcome: string | null = me?.outcome ?? null;

  const side = (p: Json) => {
    const name: string = p.fullName ?? p.username ?? '';
    return (
      <View style={{ flex: 1, alignItems: 'center', gap: 6 }}>
        <AvatarBadge name={name} size={64} />
        <Txt variant="title" numberOfLines={1}>{name}</Txt>
        <Txt style={displayText(48)}>{p.score == null ? '—' : Number(p.score).toFixed(1)}</Txt>
      </View>
    );
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}>
      <Card style={{ paddingVertical: 24, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          {me && side(me)}
          <Txt style={[displayText(28), { color: colors.primary, marginTop: 24 }]}>{t('vs')}</Txt>
          {side(them)}
        </View>
        <XpBar value={share} />
      </Card>
      {b.status === 'ACTIVE' && b.endsAt && <CountdownText endsAt={b.endsAt} style={{ textAlign: 'center', fontSize: 16, fontWeight: '600' }} />}
      {b.status === 'PENDING' && <Txt variant="title" style={{ textAlign: 'center' }}>{iCreated ? t('battleWaiting') : t('battleInvited')}</Txt>}
      {outcome && (
        <Txt style={[displayText(36), { textAlign: 'center', color: outcome === 'WIN' ? colors.primary : colors.text }]}>
          {outcome === 'WIN' ? t('battleWon') : outcome === 'LOSS' ? t('battleLost') : t('battleDraw')}
        </Txt>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
        {((b.components as string[]) ?? []).map((c) => (
          <Chip key={c} label={componentLabel(t, c)} />
        ))}
      </View>
      {b.status === 'PENDING' && !iCreated && (
        <>
          <Button testID="battle-accept" label={t('accept')} disabled={busy} onPress={() => act('accept')} />
          <Button kind="text" label={t('decline')} disabled={busy} onPress={() => act('decline')} />
        </>
      )}
      {b.status === 'PENDING' && iCreated && <Button kind="outlined" label={t('cancelBattle')} disabled={busy} onPress={() => act('cancel')} />}
    </ScrollView>
  );
}

/** Challenge a friend: opponent, 3 / 7 / 14 days, scoring components. */
export function NewBattleScreen({ opponentId }: { opponentId?: string }) {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const friends = useFriends();
  const [opponent, setOpponent] = useState<string | null>(opponentId ?? null);
  const [days, setDays] = useState<'3' | '7' | '14'>('7');
  const [selected, setSelected] = useState<string[]>(COMPONENTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const b = await battlesApi(api).create(opponent!, Number(days), selected.length === COMPONENTS.length ? null : selected);
      router.replace(`/battles/${b.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (friends.isError) return <ErrorView error={friends.error} onRetry={() => friends.refetch()} />;
  if (!friends.data) return <Loading />;
  if (friends.data.length === 0) return <EmptyState icon="group-add" message={t('noFriendsYet')} actionLabel={t('findAthletes')} onAction={() => router.push('/search')} />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 4 }}>
        <SectionHeader title={t('friends')} />
        {friends.data.map((f) => {
          const name: string = f.fullName ?? f.username;
          const on = opponent === f.id;
          return (
            <Pressable key={f.id} testID={`opponent-${f.id}`} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setOpponent(f.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
              <Icon name={on ? 'radio-button-checked' : 'radio-button-unchecked'} color={on ? colors.primary : colors.outline} />
              <View style={{ flex: 1 }}>
                <Txt>{name}</Txt>
                <Txt variant="small" color={colors.outline}>{`@${f.username}`}</Txt>
              </View>
              <AvatarBadge name={name} size={40} />
            </Pressable>
          );
        })}
        <SectionHeader title={t('battleDuration')} />
        <Segmented value={days} onChange={setDays} options={(['3', '7', '14'] as const).map((d) => ({ key: d, label: t('days', { count: Number(d) }) }))} />
        <SectionHeader title={t('battleComponents')} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {COMPONENTS.map((c) => (
            <Chip key={c} testID={`component-${c}`} label={componentLabel(t, c)} selected={selected.includes(c)} onPress={() => setSelected((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))} />
          ))}
        </View>
        <ErrorText error={error} />
      </ScrollView>
      <View style={{ padding: 16, paddingTop: 8 }}>
        <Button testID="battle-send" label={t('sendChallenge')} busy={busy} disabled={!opponent || selected.length === 0} onPress={send} />
      </View>
    </View>
  );
}
