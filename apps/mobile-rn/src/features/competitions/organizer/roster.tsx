import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { SectionHeader } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Chip, IconButton, ListGroup, ListRow, Screen, SwitchRow, TextField, Txt } from '../../../core/widgets/kit';
import { competitionsApi, useCompetitions } from '../api';
import { useRefreshCompetition, useRegistrations } from './api';
import { LocalBadge } from './local-badge';
import { checkinStats, finalistsFrom } from './logic-people';
import { OrgPageHeader } from './page';

/** A list the local layer keeps for this competition (`core/api/org-local.ts`), under the competition's query keys. */
export function useLocalList(id: string, path: string) {
  const api = useApi();
  return useQuery({ queryKey: ['competitions', id, 'local', path], queryFn: () => api.get<Json[]>(`/competitions/${id}/${path}`) });
}

const athleteName = (r: Json) => r.user?.profile?.fullName ?? r.user?.username ?? r.id;

/** Phase 5: check-in, teams, waiting list, finalists invited from a qualifier, sponsors. Kept on the device for now. */
export function RosterTab({ c }: { c: Json }) {
  const t = useT();
  const api = useApi();
  const { colors } = useTheme();
  const refresh = useRefreshCompetition();
  const regs = useRegistrations(c.id);
  const checkins = useLocalList(c.id, 'checkins');
  const waiting = useLocalList(c.id, 'waiting-list');
  const finalists = useLocalList(c.id, 'finalist-invitations');
  const sponsors = useLocalList(c.id, 'sponsors');
  const mine = useCompetitions('ALL', true);
  const [sponsor, setSponsor] = useState('');
  const [source, setSource] = useState<string | null>(null);
  const [count, setCount] = useState('5');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const live = (regs.data ?? []).filter((r) => r.registrationStatus !== 'CANCELLED' && r.registrationStatus !== 'REFUNDED');
  const stats = checkinStats(regs.data ?? [], checkins.data ?? [], c.categories ?? []);
  const checked = new Set((checkins.data ?? []).map((x) => x.id));
  const teams = live.filter((r) => r.teamName);
  const n = Number(count.trim());

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

  const checkIn = (r: Json, on: boolean) => act(() => (on ? api.post(`/competitions/${c.id}/checkins`, { id: r.id }) : api.delete(`/competitions/${c.id}/checkins/${r.id}`)));

  /** Each division of the qualifier: its top N become invitations to this final. */
  const invite = () =>
    act(async () => {
      const q = await competitionsApi(api).get(source!);
      for (const k of (q.categories ?? []).filter((x: Json) => x.active !== false)) {
        const board = await competitionsApi(api).leaderboard(source!, k.id);
        for (const f of finalistsFrom(board.rows ?? [], n, k.id)) await api.post(`/competitions/${c.id}/finalist-invitations`, { ...f, categoryName: k.name });
      }
    });

  return (
    <>
      <OrgPageHeader tab="roster" />
      <Screen>
        <View style={{ alignSelf: 'flex-start' }}>
          <LocalBadge />
        </View>

        <SectionHeader title={t('rosterCheckin')} />
        <Txt testID="roster-checkin-count" style={{ fontWeight: '700' }}>{t('rosterCheckedCount', { checked: stats.checked, total: stats.total })}</Txt>
        {stats.byCategory.map((k) => (
          <Txt key={k.categoryId} variant="small" color={colors.outline}>{t('rosterCategoryCount', { name: k.name, checked: k.checked, total: k.total })}</Txt>
        ))}
        {live.map((r) => (
          <SwitchRow key={r.id} testID={`checkin-${r.id}`} title={r.teamName ? `${athleteName(r)} · ${r.teamName}` : athleteName(r)} value={checked.has(r.id)} onChange={(on) => checkIn(r, on)} />
        ))}

        <SectionHeader title={t('rosterTeams')} />
        {teams.length === 0 ? (
          <Txt color={colors.outline}>{t('rosterNoTeams')}</Txt>
        ) : (
          <ListGroup>
            {teams.map((r) => (
              <ListRow key={r.id} testID={`team-${r.id}`} title={r.teamName} subtitle={[athleteName(r), ...(r.teamMembers ?? [])].join(', ')} />
            ))}
          </ListGroup>
        )}

        <SectionHeader title={t('rosterWaiting')} />
        {(waiting.data ?? []).length === 0 ? (
          <Txt color={colors.outline}>{t('rosterWaitingEmpty')}</Txt>
        ) : (
          <ListGroup>
            {(waiting.data ?? []).map((w) => (
              <ListRow
                key={w.id}
                testID={`waitlist-${w.id}`}
                title={w.name || w.email}
                subtitle={[w.email, (c.categories ?? []).find((k: Json) => k.id === w.categoryId)?.name].filter(Boolean).join(' · ')}
                trailing={<IconButton testID={`waitlist-remove-${w.id}`} icon="delete" label={t('orgFormRemove')} onPress={() => act(() => api.delete(`/competitions/${c.id}/waiting-list/${w.id}`))} />}
              />
            ))}
          </ListGroup>
        )}

        <SectionHeader title={t('rosterFinalists')} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {(mine.data ?? [])
            .filter((x) => x.id !== c.id)
            .map((x) => (
              <Chip key={x.id} testID={`finalists-src-${x.id}`} label={x.title} selected={source === x.id} onPress={() => setSource(x.id)} />
            ))}
        </View>
        <TextField testID="finalists-count" label={t('rosterFinalistsCount')} value={count} onChangeText={setCount} keyboardType="number-pad" />
        <Button testID="finalists-invite" kind="outlined" label={t('rosterFinalistsInvite')} busy={busy} disabled={!source || !(Number.isInteger(n) && n >= 1)} onPress={invite} />
        {(finalists.data ?? []).map((f) => (
          <Txt key={f.id} testID={`finalist-${f.id}`}>{`${t('rosterFinalistLine', { rank: f.rank, name: f.name })}${f.categoryName ? ` · ${f.categoryName}` : ''}`}</Txt>
        ))}

        <SectionHeader title={t('rosterSponsors')} />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
          <TextField testID="sponsor-name" style={{ flex: 1 }} label={t('rosterSponsorName')} value={sponsor} onChangeText={setSponsor} maxLength={80} />
          <Button
            testID="sponsor-add"
            kind="tonal"
            label={t('rosterSponsorAdd')}
            disabled={!sponsor.trim()}
            onPress={() =>
              act(async () => {
                await api.post(`/competitions/${c.id}/sponsors`, { name: sponsor.trim(), showOnLeaderboard: true, showOnLanding: true });
                setSponsor('');
              })
            }
          />
        </View>
        {(sponsors.data ?? []).map((s) => (
          <ListRow key={s.id} testID={`sponsor-${s.id}`} title={s.name} trailing={<IconButton testID={`sponsor-remove-${s.id}`} icon="delete" label={t('orgFormRemove')} onPress={() => act(() => api.delete(`/competitions/${c.id}/sponsors/${s.id}`))} />} />
        ))}
        <ErrorText error={error} />
      </Screen>
    </>
  );
}
