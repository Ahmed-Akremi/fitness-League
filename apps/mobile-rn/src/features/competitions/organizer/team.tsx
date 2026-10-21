import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { Loading, SectionHeader, SkeletonList } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Button, Dialog, IconButton, ListGroup, ListRow, Screen, TextField, Txt, toast } from '../../../core/widgets/kit';
import { useMe } from '../../me/api';
import { socialApi } from '../../social/api';
import { floorApi } from '../judge/api';
import { organizerApi, useRefreshCompetition, useStaff } from './api';
import { exportCsv } from './export';
import { csvFileName, csvSeparator, personName, STAFF_ORDER, staffByRole, staffCsv } from './logic-b';
import { ExportButton, OrgPageHeader } from './page';
import { useWideWeb } from './web';

/**
 * « Équipe » (spec §1.3 item 7): organizers, head judges and judges; co-organizers are added or removed here, the
 * admin panel's judges stay there. On-site events also invite app users as floor judges (spec 2026-10-21).
 */
export function TeamTab({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const refresh = useRefreshCompetition();
  const staff = useStaff(c.id);
  const me = useMe().data;
  const [adding, setAdding] = useState<'ORGANIZER' | 'FLOOR_JUDGE' | null>(null);
  const [removing, setRemoving] = useState<Json | null>(null);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const wide = useWideWeb();

  async function run(fn: () => Promise<unknown>, after?: () => void, done?: string) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
      // Only once the request has succeeded: an error keeps its text, with no toast.
      if (done) toast(done);
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  if (staff.isError) return <ErrorView error={staff.error} onRetry={() => staff.refetch()} />;
  if (!staff.data) return <SkeletonList label={t('orgLoading')} />;
  const groups = staffByRole(staff.data);
  if (adding) {
    const judge = adding === 'FLOOR_JUDGE';
    const taken = new Set(groups[adding].map((s) => s.userId as string));
    return (
      <>
        <AddPerson hint={judge ? t('orgFloorInviteHint') : t('orgTeamAddHint')} taken={taken} takenLabel={judge ? t('orgFloorAlready') : t('orgTeamAlready')} busy={busy} error={error} onPick={setPicked} onCancel={() => setAdding(null)} />
        {/* A co-organizer gets every right on the event, a judge an invitation: asked first, like a removal. */}
        <Dialog
          visible={picked != null}
          title={judge ? t('orgFloorInvite') : t('orgTeamAdd')}
          message={picked ? (judge ? t('orgFloorInviteConfirm', { name: picked.name }) : t('orgTeamAddConfirm', { name: picked.name })) : undefined}
          confirmLabel={judge ? t('orgFloorInvite') : t('orgTeamAdd')}
          cancelLabel={t('cancel')}
          onConfirm={() => {
            const p = picked;
            setPicked(null);
            if (!p) return;
            if (judge) void run(() => floorApi(api).invite(c.id, p.id), () => setAdding(null), t('orgToastJudgeInvited', { name: p.name }));
            else void run(() => organizerApi(api).addOrganizer(c.id, p.id), () => setAdding(null), t('orgToastOrganizerAdded', { name: p.name }));
          }}
          onCancel={() => setPicked(null)}
        />
      </>
    );
  }
  const titles = { ORGANIZER: t('orgTeamOrganizers'), HEAD_JUDGE: t('orgTeamHeadJudges'), JUDGE: t('orgTeamJudges'), FLOOR_JUDGE: t('orgFloorJudges') };
  const onsite = c.format !== 'ONLINE';
  const add = <Button testID="team-add" icon="person-add" label={t('orgTeamAdd')} busy={busy} onPress={() => setAdding('ORGANIZER')} />;
  const exportBtn = <ExportButton testID="team-export" disabled={staff.data.length === 0} onPress={() => exportCsv(csvFileName(c, 'team'), staffCsv(staff.data, csvSeparator(locale)))} />;
  return (
    <>
      <OrgPageHeader
        tab="team"
        actions={
          <>
            {add}
            {exportBtn}
          </>
        }
      />
      <Screen>
        {STAFF_ORDER.filter((role) => role !== 'FLOOR_JUDGE').map((role) => (
          <View key={role} style={{ gap: space.sm }}>
            <SectionHeader title={titles[role]} />
            {groups[role].length === 0 ? (
              <Txt color={colors.outline}>{t('orgTeamNone')}</Txt>
            ) : (
              <ListGroup>
                {groups[role].map((s) => (
                  <ListRow
                    key={s.id}
                    testID={`staff-${s.id}`}
                    icon={role === 'ORGANIZER' ? 'manage-accounts' : 'gavel'}
                    title={personName(s)}
                    subtitle={s.userId === me?.id ? t('orgTeamYou') : s.user?.username ? `@${s.user.username}` : null}
                    trailing={role === 'ORGANIZER' && me && s.userId !== me.id ? <IconButton icon="person-remove" label={t('orgTeamRemove')} onPress={() => setRemoving(s)} /> : null}
                  />
                ))}
              </ListGroup>
            )}
          </View>
        ))}
        <Txt color={colors.outline}>{t('orgTeamJudgesHint')}</Txt>
        {onsite ? (
          <View testID="team-floor" style={{ gap: space.sm }}>
            <SectionHeader title={titles.FLOOR_JUDGE} />
            {groups.FLOOR_JUDGE.length === 0 ? (
              <Txt color={colors.outline}>{t('orgTeamNone')}</Txt>
            ) : (
              <ListGroup>
                {groups.FLOOR_JUDGE.map((s) => (
                  <ListRow
                    key={s.id}
                    testID={`staff-${s.id}`}
                    icon="sports"
                    title={personName(s)}
                    subtitle={s.acceptedAt ? t('orgFloorAccepted') : t('orgFloorPending')}
                    trailing={<IconButton icon="person-remove" label={t('orgFloorRemove')} onPress={() => setRemoving(s)} />}
                  />
                ))}
              </ListGroup>
            )}
            <Button testID="team-floor-invite" kind="outlined" icon="sports" label={t('orgFloorInvite')} busy={busy} onPress={() => setAdding('FLOOR_JUDGE')} />
          </View>
        ) : null}
        <ErrorText error={error} />
        {wide ? null : add}
        {wide ? null : exportBtn}
        <Dialog
          visible={removing != null}
          title={removing?.role === 'FLOOR_JUDGE' ? t('orgFloorRemove') : t('orgTeamRemove')}
          message={removing ? (removing.role === 'FLOOR_JUDGE' ? t('orgFloorRemoveConfirm', { name: personName(removing) }) : t('orgTeamRemoveConfirm', { name: personName(removing) })) : undefined}
          confirmLabel={removing?.role === 'FLOOR_JUDGE' ? t('orgFloorRemove') : t('orgTeamRemove')}
          cancelLabel={t('cancel')}
          destructive
          onConfirm={() => {
            const s = removing;
            setRemoving(null);
            if (s) void run(() => organizerApi(api).removeStaff(c.id, s.id), undefined, t('orgToastStaffRemoved', { name: personName(s) }));
          }}
          onCancel={() => setRemoving(null)}
        />
      </Screen>
    </>
  );
}

/** Athlete search (2 characters or more, debounced, same as the app's search screen); people already in the role cannot be picked. */
function AddPerson({ hint, taken, takenLabel, busy, error, onPick, onCancel }: { hint: string; taken: Set<string>; takenLabel: string; busy: boolean; error: unknown; onPick: (person: { id: string; name: string }) => void; onCancel: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ q: string; rows: Json[] } | { q: string; error: unknown } | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(id);
  }, [text]);

  useEffect(() => {
    if (q.length < 2) {
      setResults(null);
      return;
    }
    let live = true;
    socialApi(api)
      .search(q)
      .then((page) => live && setResults({ q, rows: page.data ?? [] }))
      .catch((e) => live && setResults({ q, error: e }));
    return () => {
      live = false;
    };
  }, [q, api]);

  return (
    <Screen>
      <Txt color={colors.outline}>{hint}</Txt>
      <TextField testID="team-search" icon="search" placeholder={t('searchAthletesHint')} value={text} onChangeText={setText} autoCapitalize="none" autoFocus />
      {q.length < 2 ? null : results == null || results.q !== q ? (
        <Loading />
      ) : 'error' in results ? (
        <ErrorView error={results.error} />
      ) : results.rows.length === 0 ? (
        <Txt color={colors.outline}>{t('noAthleteFound')}</Txt>
      ) : (
        <ListGroup>
          {results.rows.map((a) => (
            <ListRow key={a.id} testID={`team-pick-${a.id}`} icon="person" title={a.fullName || a.username} subtitle={taken.has(a.id) ? takenLabel : `@${a.username}`} onPress={taken.has(a.id) ? undefined : () => onPick({ id: a.id, name: a.fullName || a.username })} />
          ))}
        </ListGroup>
      )}
      <ErrorText error={error} />
      <Button kind="text" label={t('cancel')} busy={busy} onPress={onCancel} />
    </Screen>
  );
}
