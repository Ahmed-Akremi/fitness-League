import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import type { Json } from '../../core/api/client';
import { useT, type T } from '../../core/prefs';
import { useApi } from '../../core/services';
import { displayText, useTheme } from '../../core/theme';
import { EmptyState, Loading, RankRow, SectionHeader, SkeletonList } from '../../core/widgets/common';
import { ErrorText, ErrorView, errorMessage } from '../../core/widgets/error';
import { Button, Card, Fab, Icon, IconButton, ListGroup, ListRow, Screen, Segmented, SwitchRow, TextField, Txt, toast } from '../../core/widgets/kit';
import { leagueKeys, leaguesApi, useLeague, useLeagueBoard, useLeagues } from './api';

export const leaguePresetLabel = (t: T, preset: string) =>
  preset === 'CONSISTENCY' ? t('componentConsistency') : preset === 'PROGRESS' ? t('componentProgress') : t('leaguePresetStandard');

/** League tab "Leagues": my private and public leagues, join with a code, public leagues to join, create one. */
export function LeaguesTab() {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const leagues = useLeagues();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function joinByCode() {
    setBusy(true);
    try {
      const league = await leaguesApi(api).joinByCode(code.trim());
      setCode('');
      await qc.invalidateQueries({ queryKey: leagueKeys.list });
      router.push(`/leagues/${league.id}`);
    } catch (e) {
      toast(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  const mine: Json[] = leagues.data?.mine ?? [];
  const open: Json[] = leagues.data?.public ?? [];
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 96, gap: 8 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => leagues.refetch()} tintColor={colors.primary} />}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          <TextField testID="league-code" style={{ flex: 1 }} label={t('leagueInviteCode')} value={code} onChangeText={setCode} autoCapitalize="characters" />
          <Button testID="league-code-join" label={t('leagueJoin')} busy={busy} disabled={code.trim().length < 4} onPress={joinByCode} />
        </View>
        {leagues.isError ? (
          <ErrorView error={leagues.error} onRetry={() => leagues.refetch()} />
        ) : !leagues.data ? (
          <Loading />
        ) : (
          <>
            <SectionHeader title={t('myLeagues')} />
            {mine.length === 0 && <EmptyState icon="groups" message={t('noLeagues')} />}
            {mine.map((lg) => (
              <LeagueTile key={lg.id} league={lg} />
            ))}
            {open.length > 0 && <SectionHeader title={t('publicLeagues')} />}
            {open.map((lg) => (
              <LeagueTile key={lg.id} league={lg} />
            ))}
          </>
        )}
      </ScrollView>
      <Fab testID="league-new" label={t('newLeague')} onPress={() => router.push('/leagues/new')} />
    </View>
  );
}

function LeagueTile({ league }: { league: Json }) {
  const t = useT();
  return (
    <Card testID={`league-${league.id}`} style={{ paddingVertical: 4 }}>
      <ListRow
        icon={league.visibility === 'PRIVATE' ? 'lock-outline' : 'public'}
        title={league.name}
        subtitle={`${leaguePresetLabel(t, league.scoringPreset)} · ${t('membersOf', { count: league.members, max: league.maxMembers })}`}
        trailing={league.status === 'ENDED' ? <Txt>{t('challengesEnded')}</Txt> : <Icon name="chevron-right" />}
        onPress={() => router.push(`/leagues/${league.id}`)}
      />
    </Card>
  );
}

/** A league: invite code to share, ranking of its members, join / leave / delete. */
export function LeagueDetailScreen({ id }: { id: string }) {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const league = useLeague(id);
  const board = useLeagueBoard(id);
  const [busy, setBusy] = useState(false);
  const repo = leaguesApi(api);

  async function run(action: () => Promise<unknown>, pop = false) {
    setBusy(true);
    try {
      await action();
      await qc.invalidateQueries({ queryKey: leagueKeys.list });
      if (pop && router.canGoBack()) router.back();
    } catch (e) {
      toast(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  if (league.isError) return <ErrorView error={league.error} onRetry={() => league.refetch()} />;
  if (!league.data) return <SkeletonList count={3} height={80} />;
  const lg = league.data;
  const code: string | null = lg.inviteCode ?? null;
  const rows: Json[] = board.data?.data ?? [];
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, gap: 8 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => Promise.all([league.refetch(), board.refetch()])} tintColor={colors.primary} />}
    >
      <Txt style={displayText(30)}>{lg.name}</Txt>
      <Txt color={colors.outline}>{`${leaguePresetLabel(t, lg.scoringPreset)} · ${t('membersOf', { count: lg.members, max: lg.maxMembers })}`}</Txt>
      {code && (
        <ListGroup>
          <ListRow
            icon="key"
            title={code}
            subtitle={t('leagueInviteHint')}
            trailing={
              <IconButton
                icon="content-copy"
                label={t('leagueCopyCode')}
                onPress={async () => {
                  await Clipboard.setStringAsync(code);
                  toast(t('leagueCodeCopied'));
                }}
              />
            }
          />
        </ListGroup>
      )}
      {lg.isMember !== true && lg.status !== 'ENDED' && <Button testID="league-join" label={t('leagueJoin')} busy={busy} onPress={() => run(() => repo.join(id).then(() => Promise.all([league.refetch(), board.refetch()])))} />}
      <SectionHeader title={t('leaderboard')} />
      {rows.map((r) => (
        <RankRow
          key={r.userId ?? r.username}
          rank={r.rank}
          name={r.fullName ?? r.username}
          value={Number.isInteger(Number(r.points)) ? String(r.points) : Number(r.points).toFixed(1)}
          subtitle={t('weeksCount', { count: r.weeks ?? 0 })}
          highlight={r.isMe === true}
        />
      ))}
      <View style={{ height: 16 }} />
      {lg.myRole === 'MEMBER' && <Button kind="outlined" label={t('leagueLeave')} disabled={busy} onPress={() => run(() => repo.leave(id), true)} />}
      {lg.myRole === 'OWNER' && <Button kind="text" label={t('delete')} disabled={busy} onPress={() => run(() => repo.remove(id), true)} />}
    </ScrollView>
  );
}

/** Create a league: name, private or public, what counts, how long. */
export function NewLeagueScreen() {
  const t = useT();
  const api = useApi();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [isPublic, setPublic] = useState(false);
  const [preset, setPreset] = useState<'STANDARD' | 'CONSISTENCY' | 'PROGRESS'>('STANDARD');
  const [weeks, setWeeks] = useState<'4' | '8' | '12'>('8');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const lg = await leaguesApi(api).create({
        name: name.trim(),
        visibility: isPublic ? 'PUBLIC' : 'PRIVATE',
        scoringPreset: preset,
        endsAt: new Date(Date.now() + 7 * Number(weeks) * 86400_000).toISOString(),
      });
      await qc.invalidateQueries({ queryKey: leagueKeys.list });
      router.replace(`/leagues/${lg.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <TextField testID="league-name" label={t('leagueName')} value={name} onChangeText={setName} maxLength={60} />
      <SwitchRow title={`${t('leaguePublic')} — ${t('leaguePublicHint')}`} value={isPublic} onChange={setPublic} />
      <SectionHeader title={t('leagueRanking')} />
      <Segmented value={preset} onChange={setPreset} options={(['STANDARD', 'CONSISTENCY', 'PROGRESS'] as const).map((p) => ({ key: p, label: leaguePresetLabel(t, p) }))} />
      <SectionHeader title={t('battleDuration')} />
      <Segmented value={weeks} onChange={setWeeks} options={(['4', '8', '12'] as const).map((w) => ({ key: w, label: t('weeksCount', { count: Number(w) }) }))} />
      <ErrorText error={error} />
      <Button testID="league-create" label={t('createLeague')} busy={busy} disabled={name.trim().length < 3} onPress={create} style={{ marginTop: 12 }} />
    </Screen>
  );
}
