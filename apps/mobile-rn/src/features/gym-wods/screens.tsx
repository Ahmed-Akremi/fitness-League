import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Json } from '../../core/api/client';
import { useT } from '../../core/prefs';
import { useApi } from '../../core/services';
import { displayText, useTheme } from '../../core/theme';
import { formatDuration } from '../../core/utils/format';
import { newClientId } from '../../core/utils/ids';
import { AvatarBadge, CountdownText, EmptyState, Loading, RankRow, SectionHeader, SkeletonList, TimeField } from '../../core/widgets/common';
import { ErrorText, ErrorView, errorMessage } from '../../core/widgets/error';
import { Button, Card, Chip, Dialog, Expander, Icon, IconButton, ListGroup, ListRow, Screen, Segmented, SwitchRow, TextField, Txt, toast } from '../../core/widgets/kit';
import { DateField, Select } from '../../core/widgets/pickers';
import { useGym } from '../gyms/api';
import { useMe } from '../me/api';
import { useSports } from '../reference/api';
import { formatWodScore, gymWodsApi, useGymWods, useWod, wodKeys } from './api';

/** Gym profile section: the WODs running now (highlighted), past ones on demand. Members and coaches only. */
export function GymWodsSection({ gymId, isMember, isCoach }: { gymId: string; isMember: boolean; isCoach: boolean }) {
  const t = useT();
  const active = useGymWods(isMember || isCoach ? gymId : null, 'active');
  const header = <SectionHeader title={t('gymWods')} actionLabel={isCoach ? t('wodCreate') : undefined} onAction={() => router.push(`/gyms/${gymId}/wods/new`)} />;
  if (!isMember && !isCoach) {
    return (
      <View>
        {header}
        <ListGroup>
          <ListRow icon="lock-outline" title={t('wodsMembersOnly')} />
        </ListGroup>
      </View>
    );
  }
  const wods: Json[] = active.data?.data ?? [];
  return (
    <View style={{ gap: 8 }}>
      {header}
      {active.isLoading && <Loading />}
      {!active.isLoading && wods.length === 0 && (
        <ListGroup>
          <ListRow icon="event-busy" title={t('wodNone')} />
        </ListGroup>
      )}
      {wods.map((w) => (
        <WodCard key={w.id} gymId={gymId} wod={w} />
      ))}
      {isCoach && (
        <Expander title={t('wodUpcoming')}>
          <WodList gymId={gymId} when="upcoming" />
        </Expander>
      )}
      <Expander title={t('wodPast')}>
        <WodList gymId={gymId} when="past" />
      </Expander>
    </View>
  );
}

function WodList({ gymId, when }: { gymId: string; when: string }) {
  const list = useGymWods(gymId, when);
  if (list.isLoading) return <Loading />;
  return (
    <View style={{ gap: 8 }}>
      {((list.data?.data as Json[]) ?? []).map((w) => (
        <WodCard key={w.id} gymId={gymId} wod={w} />
      ))}
    </View>
  );
}

/** Compact WOD card: title, countdown, my score (or "no score yet"). */
export function WodCard({ gymId, wod }: { gymId: string; wod: Json }) {
  const t = useT();
  const { colors } = useTheme();
  const open = wod.isOpen === true;
  const tint = open ? colors.primary : colors.outline;
  return (
    <Card testID={`wod-${wod.id}`} onPress={() => router.push(`/gyms/${gymId}/wods/${wod.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: tint + '2E', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={open ? 'local-fire-department' : 'history'} color={tint} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt variant="title" numberOfLines={1} style={{ flexShrink: 1, fontWeight: '800' }}>{wod.title}</Txt>
          {wod.status === 'DRAFT' && <DraftBadge />}
        </View>
        <CountdownText endsAt={wod.endsAt} style={{ color: colors.outline, fontSize: 13 }} />
      </View>
      {wod.myScore == null ? <Txt variant="small">{t('wodNotScored')}</Txt> : <Txt style={displayText(22)}>{formatWodScore(wod.scoreType, wod.myScore)}</Txt>}
    </Card>
  );
}

function DraftBadge() {
  const t = useT();
  const { colors } = useTheme();
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: colors.surfaceHigh }}>
      <Txt variant="small" style={{ fontWeight: '800', fontSize: 11 }}>{t('wodDraftBadge')}</Txt>
    </View>
  );
}

/** Sheet to submit a score: Rx/Scaled + time, AMRAP rounds/reps, or load, depending on the WOD. */
function WodScoreSheet({ wod, onSubmit, onClose }: { wod: Json; onSubmit: (body: Json) => Promise<unknown>; onClose: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const [division, setDivision] = useState<'RX' | 'SCALED'>('RX');
  // One id per sheet: a retry after a timeout the server already processed is recognised, not duplicated.
  const clientId = useRef(newClientId()).current;
  const [seconds, setSeconds] = useState<number | null>(null);
  const [rounds, setRounds] = useState<number | null>(null);
  const [repsPerRound, setRepsPerRound] = useState<number | null>(null);
  const [extraReps, setExtraReps] = useState<number | null>(null);
  const [load, setLoad] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const type: string = wod.scoreType;
  const cap: number | null = wod.timeCapS ?? null;
  const overCap = type === 'FOR_TIME' && seconds != null && cap != null && seconds > cap;
  const amrapTotal = rounds == null ? null : rounds * (repsPerRound ?? 0) + (extraReps ?? 0);
  const score: Json | null =
    type === 'FOR_TIME'
      ? seconds == null || overCap
        ? null
        : { timeS: seconds }
      : type === 'MAX_LOAD'
        ? load == null || load < 1 || load > 500
          ? null
          : { loadKg: load }
        : amrapTotal == null || (repsPerRound == null && extraReps == null)
          ? null
          : { rounds, reps: amrapTotal };
  const int = (v: string) => (/^\d{1,4}$/.test(v) ? Number(v) : null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ division, ...score, performedAt: new Date().toISOString(), clientId });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Txt variant="title" style={{ flex: 1, fontSize: 20 }}>{t('wodSubmitScore')}</Txt>
              <IconButton icon="close" label={t('cancel')} onPress={onClose} />
            </View>
            <Segmented
              value={division}
              onChange={setDivision}
              options={[
                { key: 'RX', label: 'Rx' },
                { key: 'SCALED', label: t('scaled') },
              ]}
            />
            {type === 'FOR_TIME' ? (
              <>
                <TimeField testID="wod-time" label={t('wodYourTime')} onChange={setSeconds} />
                {overCap && <Txt color={colors.error}>{t('wodOverCap')}</Txt>}
                {cap != null && !overCap && <Txt variant="small">{`Cap ${formatDuration(cap)}`}</Txt>}
              </>
            ) : type === 'MAX_LOAD' ? (
              <TextField testID="wod-load" label={t('wodLoad')} keyboardType="decimal-pad" onChangeText={(v) => setLoad(v.trim() ? Number(v.replace(',', '.')) || null : null)} />
            ) : (
              <>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TextField testID="wod-rounds" style={{ flex: 1 }} label={t('wodRounds')} keyboardType="number-pad" maxLength={4} onChangeText={(v) => setRounds(int(v))} />
                  <TextField testID="wod-reps-per-round" style={{ flex: 1 }} label={t('wodRepsPerRound')} keyboardType="number-pad" maxLength={4} onChangeText={(v) => setRepsPerRound(int(v))} />
                </View>
                <TextField testID="wod-extra-reps" label={t('wodExtraReps')} keyboardType="number-pad" maxLength={4} onChangeText={(v) => setExtraReps(int(v))} />
                {amrapTotal != null && <Txt variant="title">{`= ${amrapTotal} reps`}</Txt>}
              </>
            )}
            <ErrorText error={error} />
            <Button testID="wod-score-save" label={t('save')} busy={busy} disabled={score == null} onPress={save} style={{ marginTop: 8 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

/** A gym WOD: description, countdown, my score, Rx/Scaled boards; coaches invalidate with a long press. */
export function WodScreen({ gymId, wodId }: { gymId: string; wodId: string }) {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const wod = useWod(gymId, wodId);
  const gym = useGym(gymId).data;
  const myId = useMe().data?.id;
  const isCoach = gym?.myMembership?.role === 'COACH' || gym?.canManage === true;
  const [division, setDivision] = useState<'RX' | 'SCALED'>('RX');
  const [scoring, setScoring] = useState(false);
  const [invalidating, setInvalidating] = useState<Json | null>(null);
  const repo = gymWodsApi(api);
  const board = useQuery({ queryKey: wodKeys.board(gymId, wodId, division), queryFn: () => repo.board(gymId, wodId, division) });

  const refresh = () => qc.invalidateQueries({ queryKey: ['gyms', gymId, 'wods'] });

  async function publish() {
    try {
      await repo.update(gymId, wodId, { status: 'PUBLISHED' });
    } catch (e) {
      toast(errorMessage(t, e));
    }
    await refresh();
  }

  async function invalidate(row: Json, reason: string) {
    setInvalidating(null);
    try {
      await repo.invalidate(gymId, wodId, row.scoreId, reason);
    } catch (e) {
      toast(errorMessage(t, e));
    }
    await refresh();
  }

  if (wod.isError) return <ErrorView error={wod.error} onRetry={refresh} />;
  if (!wod.data) return <SkeletonList count={5} />;
  const w = wod.data;
  const type: string = w.scoreType;
  const mine: Json | null = w.myScore ?? null;
  const typeLabel = type === 'FOR_TIME' ? t('forTime') : type === 'AMRAP' ? t('amrap') : t('maxLoad');
  const rows: Json[] = board.data?.data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Txt style={displayText(34)}>{w.title}</Txt>
        {w.status === 'DRAFT' && <Chip icon="edit-note" label={t('wodDraftBadge')} />}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Chip icon="bolt" label={typeLabel} />
          {w.timeCapS != null && <Chip icon="timer" label={`Cap ${formatDuration(w.timeCapS)}`} />}
          <Card style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999 }}>
            <CountdownText endsAt={w.endsAt} style={{ fontSize: 13 }} />
          </Card>
        </View>
        <Card>
          <Txt selectable style={{ fontSize: 16 }}>{w.description}</Txt>
        </Card>
        {mine && (
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: mine.status === 'INVALIDATED' ? colors.error + '33' : colors.primary + '1F' }}>
            <View style={{ flex: 1 }}>
              <Txt variant="label">{t('wodMyScore')}</Txt>
              {mine.status === 'INVALIDATED' && <Txt variant="small">{t('wodInvalidated', { reason: mine.invalidationReason ?? '' })}</Txt>}
            </View>
            <Txt style={displayText(30)}>{formatWodScore(type, mine)}</Txt>
            <Txt style={{ fontWeight: '700' }}>{mine.division === 'SCALED' ? t('scaled') : 'Rx'}</Txt>
          </Card>
        )}
        <Segmented
          value={division}
          onChange={setDivision}
          options={[
            { key: 'RX', label: 'Rx' },
            { key: 'SCALED', label: t('scaled') },
          ]}
        />
        {board.isError ? (
          <ErrorView error={board.error} />
        ) : !board.data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState icon="leaderboard" message={t('wodNoScores')} />
        ) : (
          rows.map((r) => {
            const name: string = r.athlete?.fullName ?? r.athlete?.username ?? '';
            return (
              <RankRow
                key={r.scoreId ?? r.athlete?.id}
                rank={r.rank}
                name={name}
                value={formatWodScore(type, r)}
                highlight={r.athlete?.id === myId}
                leading={<AvatarBadge name={name} size={40} />}
                onLongPress={isCoach ? () => setInvalidating(r) : undefined}
              />
            );
          })
        )}
      </ScrollView>
      {isCoach && w.status === 'DRAFT' ? (
        <View style={{ padding: 16, paddingTop: 8 }}>
          <Button icon="publish" label={t('wodPublish')} onPress={publish} />
        </View>
      ) : w.isOpen === true ? (
        <View style={{ padding: 16, paddingTop: 8 }}>
          <Button testID="wod-score" icon="edit-note" label={t('wodSubmitScore')} onPress={() => setScoring(true)} />
        </View>
      ) : null}
      {scoring && (
        <WodScoreSheet
          wod={w}
          onSubmit={(body) => repo.submit(gymId, wodId, body)}
          onClose={() => {
            setScoring(false);
            void refresh();
          }}
        />
      )}
      <Dialog
        visible={invalidating != null}
        title={t('invalidate')}
        input={{ label: t('invalidateReason'), testID: 'invalidate-reason', valid: (s) => s.trim().length >= 3 }}
        confirmLabel={t('invalidate')}
        cancelLabel={t('cancel')}
        onCancel={() => setInvalidating(null)}
        onConfirm={(reason) => invalidate(invalidating!, reason.trim())}
      />
    </View>
  );
}

/** Coach form: title, movements, score type, optional time cap, window (≤ 31 days), sport, draft. */
export function CreateWodScreen({ gymId }: { gymId: string }) {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const sports = (useSports().data ?? []).filter((s) => s.code === 'CROSSFIT' || s.code === 'HYROX');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scoreType, setScoreType] = useState<'FOR_TIME' | 'AMRAP' | 'MAX_LOAD'>('FOR_TIME');
  const [cap, setCap] = useState<number | null>(null);
  const [capText, setCapText] = useState('');
  const [startsAt, setStartsAt] = useState(() => new Date());
  const [endsAt, setEndsAt] = useState(() => new Date(Date.now() + 7 * 86400_000));
  const [sportId, setSportId] = useState<string>('');
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Cap typed but unparsable or under the API minimum (60 s).
  const capInvalid = scoreType !== 'MAX_LOAD' && capText.trim() !== '' && (cap == null || cap < 60);
  const span = endsAt.getTime() - startsAt.getTime();
  const filled = title.trim().length >= 3 && description.trim() !== '';
  const problem = !filled ? null : span <= 0 ? t('wodEndsBeforeStart') : span > 31 * 86400_000 ? t('wodWindowTooLong') : null;
  const valid = !capInvalid && filled && title.trim().length <= 80 && span > 0 && span <= 31 * 86400_000;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await gymWodsApi(api).create(gymId, {
        title: title.trim(),
        description: description.trim(),
        scoreType,
        ...(scoreType !== 'MAX_LOAD' && cap != null ? { timeCapS: cap } : {}),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        ...(sportId ? { sportId } : {}),
        ...(draft ? { status: 'DRAFT' } : {}),
      });
      await qc.invalidateQueries({ queryKey: ['gyms', gymId, 'wods'] });
      if (router.canGoBack()) router.back();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const monthAgo = new Date(Date.now() - 30 * 86400_000);
  const yearAhead = new Date(Date.now() + 365 * 86400_000);
  return (
    <Screen>
      <TextField testID="wod-title" label={t('wodTitle')} value={title} onChangeText={setTitle} maxLength={80} />
      <TextField testID="wod-description" label={t('wodDescription')} value={description} onChangeText={setDescription} maxLength={2000} multiline style={{ minHeight: 90 }} />
      <Txt variant="label">{t('wodScoreType')}</Txt>
      <Segmented
        value={scoreType}
        onChange={setScoreType}
        options={[
          { key: 'FOR_TIME', label: t('forTime') },
          { key: 'AMRAP', label: t('amrap') },
          { key: 'MAX_LOAD', label: t('maxLoad') },
        ]}
      />
      {scoreType !== 'MAX_LOAD' && <TimeField testID="wod-cap" label={t('wodTimeCap')} value={capText} onChangeText={setCapText} onChange={setCap} />}
      {capInvalid && <Txt color={colors.error}>{t('wodCapTooShort')}</Txt>}
      <DateField testID="wod-starts" label={t('wodStarts')} mode="datetime" value={startsAt} onChange={setStartsAt} minimumDate={monthAgo} maximumDate={yearAhead} />
      <DateField testID="wod-ends" label={t('wodEnds')} mode="datetime" value={endsAt} onChange={setEndsAt} minimumDate={monthAgo} maximumDate={yearAhead} />
      {sports.length > 0 && (
        <Select
          label={t('sport')}
          value={sportId}
          options={[{ value: '', label: t('none') }, ...sports.map((s) => ({ value: s.id, label: s.code === 'HYROX' ? 'Hyrox' : 'CrossFit' }))]}
          onChange={setSportId}
        />
      )}
      <SwitchRow title={t('wodDraft')} value={draft} onChange={setDraft} />
      {problem && <Txt color={colors.error}>{problem}</Txt>}
      <ErrorText error={error} />
      <Button testID="wod-save" label={draft ? t('save') : t('wodPublish')} busy={busy} disabled={!valid} onPress={save} style={{ marginTop: 8 }} />
    </Screen>
  );
}
