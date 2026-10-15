import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { Loading, SectionHeader } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Button, Dialog, IconButton, ListGroup, ListRow, Screen, TextField, Txt } from '../../../core/widgets/kit';
import { useMe } from '../../me/api';
import { socialApi } from '../../social/api';
import { organizerApi, useRefreshCompetition, useStaff } from './api';
import { exportCsv } from './export';
import { csvFileName, csvSeparator, personName, STAFF_ORDER, staffByRole, staffCsv } from './logic-b';

/** « Équipe » (spec §1.3 item 7): organizers, head judges and judges; co-organizers are added or removed here, judges stay with the admin panel. */
export function TeamTab({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const refresh = useRefreshCompetition();
  const staff = useStaff(c.id);
  const me = useMe().data;
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Json | null>(null);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  if (staff.isError) return <ErrorView error={staff.error} onRetry={() => staff.refetch()} />;
  if (!staff.data) return <Loading />;
  const groups = staffByRole(staff.data);
  if (adding) {
    const organizers = new Set(groups.ORGANIZER.map((s) => s.userId as string));
    return (
      <>
        <AddOrganizer organizers={organizers} busy={busy} error={error} onPick={setPicked} onCancel={() => setAdding(false)} />
        {/* A co-organizer gets every right on the event: asked first, like a removal. */}
        <Dialog
          visible={picked != null}
          title={t('orgTeamAdd')}
          message={picked ? t('orgTeamAddConfirm', { name: picked.name }) : undefined}
          confirmLabel={t('orgTeamAdd')}
          cancelLabel={t('cancel')}
          onConfirm={() => {
            const p = picked;
            setPicked(null);
            if (p) void run(() => organizerApi(api).addOrganizer(c.id, p.id), () => setAdding(false));
          }}
          onCancel={() => setPicked(null)}
        />
      </>
    );
  }
  const titles = { ORGANIZER: t('orgTeamOrganizers'), HEAD_JUDGE: t('orgTeamHeadJudges'), JUDGE: t('orgTeamJudges') };
  return (
    <Screen>
      {STAFF_ORDER.map((role) => (
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
      <ErrorText error={error} />
      <Button testID="team-add" icon="person-add" label={t('orgTeamAdd')} busy={busy} onPress={() => setAdding(true)} />
      <Button testID="team-export" kind="outlined" icon="file-download" label={t('orgExport')} disabled={staff.data.length === 0} onPress={() => exportCsv(csvFileName(c, 'team'), staffCsv(staff.data, csvSeparator(locale)))} />
      <Dialog
        visible={removing != null}
        title={t('orgTeamRemove')}
        message={removing ? t('orgTeamRemoveConfirm', { name: personName(removing) }) : undefined}
        confirmLabel={t('orgTeamRemove')}
        cancelLabel={t('cancel')}
        destructive
        onConfirm={() => {
          const s = removing;
          setRemoving(null);
          if (s) void run(() => organizerApi(api).removeStaff(c.id, s.id));
        }}
        onCancel={() => setRemoving(null)}
      />
    </Screen>
  );
}

/** Athlete search (2 characters or more, debounced, same as the app's search screen); people already organizing cannot be picked. */
function AddOrganizer({ organizers, busy, error, onPick, onCancel }: { organizers: Set<string>; busy: boolean; error: unknown; onPick: (person: { id: string; name: string }) => void; onCancel: () => void }) {
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
      <Txt color={colors.outline}>{t('orgTeamAddHint')}</Txt>
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
            <ListRow key={a.id} testID={`team-pick-${a.id}`} icon="person" title={a.fullName || a.username} subtitle={organizers.has(a.id) ? t('orgTeamAlready') : `@${a.username}`} onPress={organizers.has(a.id) ? undefined : () => onPick({ id: a.id, name: a.fullName || a.username })} />
          ))}
        </ListGroup>
      )}
      <ErrorText error={error} />
      <Button kind="text" label={t('cancel')} busy={busy} onPress={onCancel} />
    </Screen>
  );
}
