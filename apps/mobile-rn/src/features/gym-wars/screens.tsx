import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import type { Json } from '../../core/api/client';
import { useLocale, useT } from '../../core/prefs';
import { useApi } from '../../core/services';
import { displayText, useTheme } from '../../core/theme';
import { localized } from '../../core/utils/format';
import { CountdownText, GymLogo, SectionHeader, SkeletonList, XpBar } from '../../core/widgets/common';
import { ErrorView, errorMessage } from '../../core/widgets/error';
import { Card, Icon, ListRow, SwitchRow, Txt, toast } from '../../core/widgets/kit';
import { gymWarsApi, useGymWar, useGymWarHistory } from './api';

/** One Gym War: both gyms side by side, live or final scores and what makes them (docs §6.2). */
export function GymWarScreen({ id }: { id: string }) {
  const { colors } = useTheme();
  const war = useGymWar(id);
  if (war.isError) return <ErrorView error={war.error} onRetry={() => war.refetch()} />;
  if (!war.data) return <SkeletonList count={3} height={120} />;
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => war.refetch()} tintColor={colors.primary} />}>
      <GymWarView war={war.data} />
    </ScrollView>
  );
}

export function GymWarView({ war }: { war: Json }) {
  const t = useT();
  const { colors } = useTheme();
  // My gym on the start side.
  const gyms: Json[] = [...(war.gyms ?? [])].sort((a, b) => (b.isMine ? 1 : 0) - (a.isMine ? 1 : 0));
  const mine = gyms[0];
  const outcome: string | null = mine?.isMine ? mine.outcome ?? null : null;
  if (war.status === 'BYE') {
    return (
      <>
        <GymSide gym={mine} />
        <Txt variant="title" style={{ textAlign: 'center' }}>{t('gymWarBye')}</Txt>
      </>
    );
  }
  const them = gyms[gyms.length - 1];
  const score = (g: Json) => Number(g.score ?? 0);
  const total = score(mine) + score(them);
  const part = (g: Json, key: string) => (g.breakdown?.[key] == null ? '—' : Number(g.breakdown[key]).toFixed(0));
  const row = (left: string, label: string, right: string) => (
    <View key={label} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
      <Txt variant="title" style={{ width: 56 }}>{left}</Txt>
      <Txt color={colors.outline} style={{ flex: 1, textAlign: 'center' }}>{label}</Txt>
      <Txt variant="title" style={{ width: 56, textAlign: 'right' }}>{right}</Txt>
    </View>
  );
  return (
    <>
      <Card style={{ paddingVertical: 24, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <GymSide gym={mine} />
          </View>
          <Txt style={[displayText(28), { color: colors.primary, marginTop: 28 }]}>{t('vs')}</Txt>
          <View style={{ flex: 1 }}>
            <GymSide gym={them} />
          </View>
        </View>
        <XpBar value={total === 0 ? 0.5 : score(mine) / total} />
      </Card>
      {war.status === 'ACTIVE' && <CountdownText endsAt={war.endsAt} style={{ textAlign: 'center', fontSize: 16, fontWeight: '600' }} />}
      {outcome && (
        <Txt style={[displayText(36), { textAlign: 'center', color: outcome === 'WIN' ? colors.primary : colors.text }]}>
          {outcome === 'WIN' ? t('gymWarWon') : outcome === 'LOSS' ? t('gymWarLost') : t('battleDraw')}
        </Txt>
      )}
      <Card>
        {row(part(mine, 'topK'), t('gymWarTopK'), part(them, 'topK'))}
        {row(part(mine, 'participation'), t('gymWarParticipation'), part(them, 'participation'))}
        {row(part(mine, 'meanProgress'), t('componentProgress'), part(them, 'meanProgress'))}
        {row(part(mine, 'consistency'), t('componentConsistency'), part(them, 'consistency'))}
        {row(`${mine.activeMembers}/${mine.eligibleMembers}`, t('gymWarActiveMembers'), `${them.activeMembers}/${them.eligibleMembers}`)}
      </Card>
      <Txt variant="small" color={colors.outline}>{t('gymWarExplain')}</Txt>
    </>
  );
}

function GymSide({ gym }: { gym: Json }) {
  const locale = useLocale();
  const { colors } = useTheme();
  return (
    <Pressable onPress={() => router.push(`/gyms/${gym.gymId}`)} style={{ alignItems: 'center', gap: 4 }}>
      <GymLogo name={gym.name} url={gym.logoUrl} size={64} />
      <Txt variant="title" numberOfLines={2} style={{ textAlign: 'center', fontSize: 15 }}>{gym.name}</Txt>
      <Txt variant="small" color={colors.outline}>{localized(gym.city, locale)}</Txt>
      <Txt style={displayText(44)}>{gym.score == null ? '—' : Number(gym.score).toFixed(1)}</Txt>
    </Pressable>
  );
}

/** Gym profile section: war record, gym rating, recent wars and (for the gym admin) the enrolment switch. */
export function GymWarsSection({ gymId, canManage }: { gymId: string; canManage: boolean }) {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const history = useGymWarHistory(gymId).data;
  const [busy, setBusy] = useState(false);
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  if (!history) return null;
  const record: Json = history.record ?? {};
  const wars: Json[] = history.data ?? [];
  if (wars.length === 0 && !canManage) return null;

  async function setEnrolment(v: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await gymWarsApi(api).setEnrolled(gymId, v);
      setEnrolled(r.enrolled === true);
    } catch (e) {
      toast(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <SectionHeader title={t('gymWars')} />
      <Card style={{ paddingVertical: 4 }}>
        <ListRow
          leading={<Icon name="shield" color={colors.primary} />}
          title={t('gymWarRecord', { wins: record.wins ?? 0, losses: record.losses ?? 0, draws: record.draws ?? 0 })}
          trailing={<Txt style={{ fontWeight: '700' }}>{t('gymWarRating', { rating: history.rating ?? 0 })}</Txt>}
        />
        {canManage && <SwitchRow testID="war-enrolled" title={`${t('gymWarEnrolled')} — ${t('gymWarEnrolledHint')}`} value={enrolled ?? history.enrolled === true} onChange={setEnrolment} />}
        {wars.slice(0, 5).map((w) => (
          <ListRow
            key={w.id}
            icon={w.outcome === 'WIN' ? 'emoji-events' : w.outcome === 'LOSS' ? 'close' : 'shield'}
            title={w.opponent == null ? t('gymWarByeShort') : t('gymWarVs', { name: w.opponent.name })}
            subtitle={w.weekStart}
            trailing={w.score == null ? (w.status === 'ACTIVE' ? <Txt>{t('gymWarLive')}</Txt> : null) : <Txt>{`${Number(w.score).toFixed(1)} – ${Number(w.opponentScore ?? 0).toFixed(1)}`}</Txt>}
            onPress={() => router.push(`/gym-wars/${w.id}`)}
          />
        ))}
      </Card>
    </View>
  );
}
