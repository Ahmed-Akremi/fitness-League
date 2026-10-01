import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Image, Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';

import type { Json } from '../../core/api/client';
import { ApiError } from '../../core/api/errors';
import { useLocale, useT, type T } from '../../core/prefs';
import { useApi } from '../../core/services';
import { displayText, useTheme } from '../../core/theme';
import { formatDate } from '../../core/utils/format';
import { newClientId } from '../../core/utils/ids';
import { pickVideo } from '../../core/utils/pick-image';
import { EmptyState, Loading, SectionHeader, SkeletonList, StatCard, TimeField } from '../../core/widgets/common';
import { ErrorText, ErrorView, errorMessage } from '../../core/widgets/error';
import { Button, Card, Chip, Icon, ListRow, Screen, Segmented, TextField, Txt, toast } from '../../core/widgets/kit';
import { compKeys, competitionsApi, formatMoney, useCompetition, useCompetitions, useCompLeaderboard, useHeats, useMySubmissions, youtubeId, type CompFilter } from './api';

const statusLabel = (t: T, s: string) => (t as (k: string) => string)(`compStatus${s}`);

// ───────────── List ─────────────

export function CompetitionsScreen() {
  const t = useT();
  const { colors } = useTheme();
  const [filter, setFilter] = useState<CompFilter>('ALL');
  const [mine, setMine] = useState(false);
  const list = useCompetitions(filter, mine);
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { key: 'ALL', label: t('compFilterAll') },
          { key: 'REGISTRATION_OPEN', label: t('compFilterOpen') },
          { key: 'UPCOMING', label: t('compFilterUpcoming') },
          { key: 'ACTIVE', label: t('compFilterActive') },
          { key: 'FINISHED', label: t('compFilterFinished') },
        ]}
      />
      <View style={{ flexDirection: 'row', paddingHorizontal: 16 }}>
        <Chip testID="comp-mine" icon="person" label={t('competitionsMine')} selected={mine} onPress={() => setMine(!mine)} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => list.refetch()} tintColor={colors.primary} />}>
        {list.isError ? (
          <ErrorView error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data ? (
          <SkeletonList count={3} height={140} />
        ) : list.data.length === 0 ? (
          <EmptyState icon="emoji-events" message={t('compNone')} />
        ) : (
          list.data.map((c) => <CompetitionCard key={c.id} c={c} />)
        )}
      </ScrollView>
    </View>
  );
}

function CompetitionCard({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  return (
    <Card testID={`comp-${c.id}`} onPress={() => router.push(`/competitions/${c.id}`)} style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="emoji-events" color={colors.primary} />
        <Txt variant="title" style={{ flex: 1, fontWeight: '800' }}>{c.title}</Txt>
      </View>
      <Txt variant="small" color={colors.outline} numberOfLines={2}>{c.shortDescription}</Txt>
      <Txt>{`📅 ${formatDate(c.eventStart, locale)}   📍 ${c.city ?? c.location ?? '—'}`}</Txt>
      <Txt>{`💰 ${c.registrationPrice === 0 ? t('compFree') : formatMoney(c.registrationPrice, c.currency, locale)}   👥 ${t('compAthletes', { count: c.participants })}`}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <Chip label={statusLabelForCompetition(t, c.status)} selected={c.status === 'REGISTRATION_OPEN'} />
        {c.status === 'REGISTRATION_OPEN' && <Txt variant="small" color={colors.outline}>{t('compDeadline', { date: formatDate(c.registrationEnd, locale) })}</Txt>}
      </View>
    </Card>
  );
}

function statusLabelForCompetition(t: T, s: string) {
  if (s === 'REGISTRATION_OPEN') return t('compFilterOpen');
  if (s === 'FINAL_LEADERBOARD' || s === 'FINISHED') return t('compFilterFinished');
  if (s === 'DRAFT' || s === 'REGISTRATION_CLOSED') return t('compFilterUpcoming');
  return t('compFilterActive');
}

// ───────────── Detail ─────────────

type Tab = 'overview' | 'categories' | 'wods' | 'leaderboard' | 'prizes';

export function CompetitionScreen({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const comp = useCompetition(id);
  const [tab, setTab] = useState<Tab>('overview');
  const registered = comp.data?.myRegistration?.registrationStatus === 'CONFIRMED';
  const mine = useMySubmissions(id, registered);
  if (comp.isError) return <ErrorView error={comp.error} onRetry={() => comp.refetch()} />;
  if (!comp.data) return <SkeletonList count={4} height={100} />;
  const c = comp.data;
  const subs = new Map<string, Json>((mine.data ?? []).map((s) => [s.workout.id, s]));
  const price = (p: number) => (p === 0 ? t('compFree') : formatMoney(p, c.currency, locale));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 96 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => comp.refetch()} tintColor={colors.primary} />}>
        <Txt style={displayText(30)}>{c.title}</Txt>
        <Txt color={colors.outline}>{`${c.format} · ${c.city ?? c.location ?? ''} · ${formatDate(c.eventStart, locale)}`}</Txt>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { key: 'overview', label: t('compOverview') },
            { key: 'categories', label: t('compCategories') },
            { key: 'wods', label: t('compWods') },
            { key: 'leaderboard', label: t('leaderboard') },
            { key: 'prizes', label: t('compPrizes') },
          ]}
        />
        {tab === 'overview' && (
          <>
            <Card>
              <Txt>{c.description}</Txt>
            </Card>
            <Card style={{ paddingVertical: 4 }}>
              <ListRow icon="person" title={t('compOrganizer')} subtitle={c.organizer?.fullName ?? c.organizer?.username} />
              <ListRow icon="payments" title={t('compPrice')} subtitle={price(c.registrationPrice)} />
              <ListRow icon="event" title={t('compDeadline', { date: formatDate(c.deadlines.registrationEnd, locale) })} />
              {c.deadlines.scoreSubmissionDeadline && <ListRow icon="timer" title={t('compSubmissionDeadline')} subtitle={formatDate(c.deadlines.scoreSubmissionDeadline, locale)} />}
              {c.deadlines.judgingDeadline && <ListRow icon="gavel" title={t('compJudgingDeadline')} subtitle={formatDate(c.deadlines.judgingDeadline, locale)} />}
              {c.deadlines.leaderboardPublicationAt && <ListRow icon="leaderboard" title={t('compLeaderboardDate')} subtitle={formatDate(c.deadlines.leaderboardPublicationAt, locale)} />}
              <ListRow icon="groups" title={t('compAthletes', { count: c.participants })} />
            </Card>
            <HeatSchedule id={id} />
          </>
        )}
        {tab === 'categories' &&
          c.categories
            .filter((cat: Json) => cat.active)
            .map((cat: Json) => (
              <Card key={cat.id} style={{ paddingVertical: 4 }}>
                <ListRow title={cat.name} subtitle={[cat.gender, cat.minAge != null ? `${cat.minAge}${cat.maxAge != null ? `-${cat.maxAge}` : '+'}` : null].filter(Boolean).join(' · ')} trailing={<Txt variant="title">{price(cat.price)}</Txt>} />
              </Card>
            ))}
        {tab === 'wods' &&
          c.workouts.map((w: Json) => {
            const s = subs.get(w.id);
            return (
              <Card key={w.id} testID={`wod-${w.number}`} style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Txt variant="title" style={{ flex: 1, fontWeight: '800' }}>{w.name}</Txt>
                  <Txt color={colors.primary} style={{ fontWeight: '700' }}>{t('compMaxPoints', { points: w.maximumPoints })}</Txt>
                </View>
                <Txt>{w.description}</Txt>
                {w.standards ? <Txt variant="small" color={colors.outline}>{w.standards}</Txt> : null}
                {s && <Txt variant="small">{`${statusLabel(t, s.status)}${s.points != null && s.status === 'FINAL' ? ` · ${t('compPoints', { points: Number(s.points) })}` : ''}`}</Txt>}
                {registered && (!s || ['DRAFT', 'SUBMITTED', 'NEEDS_CORRECTION'].includes(s.status)) && (
                  <Button testID={`submit-${w.number}`} kind="tonal" icon="edit-note" label={t('compSubmitScore')} onPress={() => router.push(`/competitions/${id}/wods/${w.id}/submit`)} />
                )}
              </Card>
            );
          })}
        {tab === 'leaderboard' && <CompLeaderboard id={id} categories={c.categories} workouts={c.workouts} />}
        {tab === 'prizes' &&
          (c.prizes.length === 0 ? (
            <EmptyState icon="workspace-premium" message="—" />
          ) : (
            c.prizes.map((p: Json) => (
              <Card key={p.id} style={{ paddingVertical: 4 }}>
                <ListRow
                  icon="military-tech"
                  title={`${p.position === 1 ? '🥇' : p.position === 2 ? '🥈' : p.position === 3 ? '🥉' : `#${p.position}`} ${p.description ?? p.type}`}
                  subtitle={c.categories.find((x: Json) => x.id === p.categoryId)?.name}
                  trailing={p.amount != null ? <Txt variant="title">{formatMoney(p.amount, p.currency ?? c.currency, locale)}</Txt> : null}
                />
              </Card>
            ))
          ))}
      </ScrollView>
      <View style={{ padding: 16, paddingTop: 8 }}>
        {c.myRegistration ? (
          <Button testID="comp-mine-button" kind="outlined" icon="emoji-events" label={c.myRegistration.registrationStatus === 'CONFIRMED' ? t('compMyCompetition') : t('compPaymentPending')} onPress={() => setTab('wods')} />
        ) : c.status === 'REGISTRATION_OPEN' ? (
          <Button testID="comp-register" label={t('compRegister')} onPress={() => router.push(`/competitions/${id}/register`)} />
        ) : null}
      </View>
    </View>
  );
}

// ───────────── Heats ─────────────

/** Heat schedule (§45): the athlete's own heat first, then the running order. Hidden when there are none. */
function HeatSchedule({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const heats = useHeats(id);
  if (!heats.data || heats.data.length === 0) return null;
  const when = (h: Json) => (h.startsAt ? formatDate(h.startsAt, locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  const mine = heats.data.flatMap((h) => h.lanes.filter((l: Json) => l.mine).map((l: Json) => ({ heat: h, lane: l.lane })));
  return (
    <>
      {mine.map(({ heat, lane }) => (
        <Card key={heat.id} testID="my-heat" style={{ backgroundColor: colors.primary + '22', gap: 4 }}>
          <Txt variant="label">{t('compMyHeat')}</Txt>
          <Txt style={displayText(24)}>{`${heat.name} · ${t('compLane', { lane })}`}</Txt>
          <Txt>{[heat.workout?.name, when(heat)].filter(Boolean).join(' · ')}</Txt>
        </Card>
      ))}
      <SectionHeader title={t('compHeats')} />
      <Card style={{ paddingVertical: 4 }}>
        {heats.data.map((h) => (
          <ListRow
            key={h.id}
            icon="schedule"
            title={h.name}
            subtitle={[h.workout?.name, h.category?.name, t('compAthletes', { count: h.lanes.length })].filter(Boolean).join(' · ')}
            trailing={<Txt>{when(h)}</Txt>}
          />
        ))}
      </Card>
    </>
  );
}

// ───────────── Leaderboard ─────────────

export function CompLeaderboard({ id, categories, workouts }: { id: string; categories: Json[]; workouts: Json[] }) {
  const t = useT();
  const { colors } = useTheme();
  const active = categories.filter((c) => c.active);
  const [categoryId, setCategoryId] = useState<string | undefined>(active[0]?.id);
  const [workoutId, setWorkoutId] = useState<string | undefined>(undefined);
  const board = useCompLeaderboard(id, categoryId, workoutId);
  const data = board.data;
  return (
    <View style={{ gap: 8 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {active.map((c) => (
          <Chip key={c.id} testID={`board-cat-${c.id}`} label={c.name} selected={c.id === categoryId} onPress={() => setCategoryId(c.id)} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <Chip label={t('compTotal')} selected={!workoutId} onPress={() => setWorkoutId(undefined)} />
        {workouts.map((w) => (
          <Chip key={w.id} label={w.name} selected={w.id === workoutId} onPress={() => setWorkoutId(w.id)} />
        ))}
      </ScrollView>
      {board.isError ? (
        <ErrorView error={board.error} onRetry={() => board.refetch()} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <Card style={{ backgroundColor: data.provisional ? colors.surfaceHigh : colors.primary + '22' }}>
            <Txt style={{ fontWeight: '700' }}>{data.provisional ? t('compProvisional') : t('compFinal')}</Txt>
          </Card>
          {data.podium && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['gold', 'silver', 'bronze'] as const).map((place, i) => {
                const ids: string[] = data.podium[place];
                const names = data.rows.filter((r: Json) => ids.includes(r.athlete.id)).map((r: Json) => r.athlete.fullName ?? r.athlete.username);
                return (
                  <View key={place} style={{ flex: 1 }}>
                    <StatCard label={['🥇', '🥈', '🥉'][i]}>
                      <Txt variant="title" numberOfLines={2}>{names.join(', ') || '—'}</Txt>
                    </StatCard>
                  </View>
                );
              })}
            </View>
          )}
          <ScrollView horizontal>
            <View>
              <View style={{ flexDirection: 'row', paddingVertical: 6 }}>
                <Txt variant="label" style={{ width: 44 }}>#</Txt>
                <View style={{ width: 140 }} />
                {!workoutId && data.workouts.map((w: Json) => <Txt key={w.id} variant="label" style={{ width: 64, textAlign: 'right' }}>{`W${w.number}`}</Txt>)}
                <Txt variant="label" style={{ width: 72, textAlign: 'right' }}>{t('compTotal')}</Txt>
              </View>
              {data.rows.map((r: Json) => (
                <View key={r.athlete.id} testID={`board-row-${r.athlete.id}`} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.surfaceHigh }}>
                  <Txt style={[displayText(20), { width: 44, color: r.rank <= 3 ? colors.primary : colors.text }]}>{`#${r.rank}`}</Txt>
                  <View style={{ width: 140 }}>
                    <Txt numberOfLines={1} style={{ fontWeight: '600' }}>{r.athlete.fullName ?? r.athlete.username}</Txt>
                    {r.pending > 0 && <Txt variant="small" color={colors.outline}>{t('compPending')}</Txt>}
                  </View>
                  {!workoutId && data.workouts.map((w: Json) => <Txt key={w.id} style={{ width: 64, textAlign: 'right' }}>{r.wodPoints[w.id] != null ? String(r.wodPoints[w.id]) : '—'}</Txt>)}
                  <Txt style={[displayText(20), { width: 72, textAlign: 'right' }]}>{String(workoutId ? r.wodPoints[workoutId] : r.totalPoints)}</Txt>
                </View>
              ))}
            </View>
          </ScrollView>
        </>
      )}
    </View>
  );
}

// ───────────── Registration ─────────────

/** Competition → category → coupon → price → confirmation (§12). The server re-checks everything. */
export function RegisterScreen({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const comp = useCompetition(id);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [quote, setQuote] = useState<Json | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<Json | null>(null);
  if (comp.isError) return <ErrorView error={comp.error} />;
  if (!comp.data) return <Loading />;
  const c = comp.data;
  const category = c.categories.find((x: Json) => x.id === categoryId);
  const money = (p: number) => (p === 0 ? t('compFree') : formatMoney(p, c.currency, locale));

  async function applyCoupon() {
    setCouponError(null);
    try {
      setQuote(await competitionsApi(api).checkCoupon(id, categoryId!, code.trim().toUpperCase()));
    } catch (e) {
      setQuote(null);
      setCouponError(e instanceof ApiError && e.status === 422 ? t('compCouponRefused') : errorMessage(t, e));
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const r = await competitionsApi(api).register(id, categoryId!, quote ? code.trim().toUpperCase() : undefined);
      await qc.invalidateQueries({ queryKey: ['competitions'] });
      setDone(r);
    } catch (e) {
      if (e instanceof ApiError && e.fieldCode('categoryId')) setError(t('compNotEligible'));
      else if (e instanceof ApiError && e.fieldCode('couponCode')) setError(t('compCouponRefused'));
      else if (e instanceof ApiError && e.code === 'PRECONDITION_FAILED') setError(t('compRegistrationClosed'));
      else setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32, backgroundColor: colors.background }}>
        <Icon name={done.registrationStatus === 'CONFIRMED' ? 'check-circle' : 'hourglass-top'} size={64} color={colors.primary} />
        <Txt variant="title" style={{ textAlign: 'center' }}>{done.registrationStatus === 'CONFIRMED' ? t('compRegistered') : t('compPaymentPending')}</Txt>
        <Button label={t('compMyCompetition')} onPress={() => router.replace(`/competitions/${id}`)} />
      </View>
    );
  }

  return (
    <Screen>
      <SectionHeader title={t('compChooseCategory')} />
      {c.categories
        .filter((x: Json) => x.active)
        .map((x: Json) => (
          <Pressable key={x.id} testID={`cat-${x.id}`} accessibilityRole="radio" accessibilityState={{ checked: x.id === categoryId }} onPress={() => { setCategoryId(x.id); setQuote(null); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
            <Icon name={x.id === categoryId ? 'radio-button-checked' : 'radio-button-unchecked'} color={x.id === categoryId ? colors.primary : colors.outline} />
            <Txt style={{ flex: 1 }}>{x.name}</Txt>
            <Txt style={{ fontWeight: '700' }}>{money(x.price)}</Txt>
          </Pressable>
        ))}
      {category && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
            <TextField testID="coupon" style={{ flex: 1 }} label={t('compCoupon')} value={code} onChangeText={setCode} autoCapitalize="characters" error={couponError} />
            <Button testID="coupon-apply" kind="tonal" label={t('compApplyCoupon')} disabled={code.trim().length < 3} onPress={applyCoupon} />
          </View>
          <Card style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row' }}>
              <Txt style={{ flex: 1 }}>{t('compPrice')}</Txt>
              <Txt>{money(quote?.originalPrice ?? category.price)}</Txt>
            </View>
            {quote && (
              <View style={{ flexDirection: 'row' }}>
                <Txt style={{ flex: 1 }}>{t('compDiscount')}</Txt>
                <Txt color={colors.primary}>{`− ${money(quote.discount)}`}</Txt>
              </View>
            )}
            <View style={{ flexDirection: 'row', marginTop: 4 }}>
              <Txt variant="title" style={{ flex: 1 }}>{t('compTotal')}</Txt>
              <Txt testID="final-price" style={displayText(24)}>{money(quote?.finalPrice ?? category.price)}</Txt>
            </View>
          </Card>
        </>
      )}
      {typeof error === 'string' ? <Txt color={colors.error}>{error}</Txt> : <ErrorText error={error} />}
      <Button testID="register-confirm" label={t('compConfirmRegistration')} busy={busy} disabled={!category} onPress={confirm} style={{ marginTop: 8 }} />
    </Screen>
  );
}

// ───────────── Submission ─────────────

/** Score + video for one WOD: only the fields its score type needs (§23). */
export function SubmitScreen({ id, wodId }: { id: string; wodId: string }) {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const comp = useCompetition(id);
  const clientId = useRef(newClientId()).current;
  const [timeS, setTimeS] = useState<number | null>(null);
  const [rounds, setRounds] = useState('');
  const [reps, setReps] = useState('');
  const [value, setValue] = useState('');
  const [capped, setCapped] = useState(false);
  const [video, setVideo] = useState('');
  const [upload, setUpload] = useState<{ mediaId: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!comp.data) return <Loading />;
  const w = comp.data.workouts.find((x: Json) => x.id === wodId);
  if (!w) return <ErrorView error={new ApiError('client', 404, 'NOT_FOUND')} />;
  const type: string = w.scoreType;
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
  const raw: Json =
    type === 'TIME'
      ? capped
        ? { capped: true, reps: num(reps), maxReps: num(value) }
        : { timeS }
      : type === 'ROUNDS_REPS'
        ? { rounds: num(rounds), reps: num(reps), repsPerRound: num(value) }
        : type === 'REPS'
          ? { reps: num(reps) }
          : { value: num(value) };
  const filled = Object.values(raw).every((v) => v === true || (typeof v === 'number' && Number.isFinite(v)));
  const videoOk = video.trim() === '' || youtubeId(video) != null;
  const thumb = youtubeId(video);

  async function chooseVideo() {
    setError(null);
    const picked = await pickVideo(50 * 1024 * 1024);
    if (!picked) return;
    if ('tooLarge' in picked) return setError(new Error(t('compVideoTooLarge')));
    setUploading(true);
    try {
      const r = await competitionsApi(api).uploadVideo(id, picked.file);
      setUpload({ mediaId: r.mediaId, name: picked.file.name });
      setVideo('');
      toast(t('compVideoUploaded'));
    } catch (e) {
      setError(e);
    } finally {
      setUploading(false);
    }
  }

  async function send(submit: boolean) {
    setBusy(true);
    setError(null);
    try {
      await competitionsApi(api).submit(id, wodId, { clientId, raw, notes: notes.trim() || undefined, videoUrl: video.trim() || undefined, videoMediaId: upload?.mediaId, submit });
      await qc.invalidateQueries({ queryKey: compKeys.mine(id) });
      toast(submit ? t('compSubmitted') : t('compSaveDraft'));
      if (router.canGoBack()) router.back();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Txt style={displayText(28)}>{w.name}</Txt>
      <Txt>{w.description}</Txt>
      <Txt color={colors.primary} style={{ fontWeight: '700' }}>{t('compMaxPoints', { points: w.maximumPoints })}</Txt>
      {type === 'TIME' ? (
        <>
          {!capped && <TimeField testID="sub-time" label={t('compScore')} onChange={setTimeS} />}
          <Chip testID="sub-capped" icon="timer-off" label={t('compTimeCap')} selected={capped} onPress={() => setCapped(!capped)} />
          {capped && (
            <>
              <TextField testID="sub-reps" label={t('compReps')} keyboardType="number-pad" value={reps} onChangeText={setReps} />
              <TextField label={t('compTotalReps')} keyboardType="number-pad" value={value} onChangeText={setValue} />
            </>
          )}
        </>
      ) : type === 'ROUNDS_REPS' ? (
        <>
          <TextField testID="sub-rounds" label={t('compRounds')} keyboardType="number-pad" value={rounds} onChangeText={setRounds} />
          <TextField label={t('compRepsPerRound')} keyboardType="number-pad" value={value} onChangeText={setValue} />
          <TextField testID="sub-reps" label={`+ ${t('compReps')}`} keyboardType="number-pad" value={reps} onChangeText={setReps} />
        </>
      ) : type === 'REPS' ? (
        <TextField testID="sub-reps" label={t('compReps')} keyboardType="number-pad" value={reps} onChangeText={setReps} />
      ) : (
        <TextField testID="sub-value" label={`${t('compValue')} (${type})`} keyboardType="decimal-pad" value={value} onChangeText={setValue} />
      )}
      <TextField testID="sub-video" editable={!upload} label={t('compVideoUrl')} placeholder="https://youtu.be/…" value={video} onChangeText={setVideo} autoCapitalize="none" keyboardType="url" error={videoOk ? null : t('compVideoInvalid')} />
      {thumb && (
        <Pressable onPress={() => Linking.openURL(video.trim())}>
          <Image accessibilityLabel={t('judgeWatchVideo')} source={{ uri: `https://i.ytimg.com/vi/${thumb}/hqdefault.jpg` }} style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 12 }} />
        </Pressable>
      )}
      <Txt variant="small" color={colors.outline} style={{ textAlign: 'center' }}>{t('compOr')}</Txt>
      {upload ? (
        <Chip testID="sub-upload-done" icon="movie" label={`${t('compVideoUploaded')} · ${upload.name}`} selected onPress={() => setUpload(null)} />
      ) : (
        <Button testID="sub-upload" kind="outlined" icon="upload" label={t('compUploadVideo')} busy={uploading} disabled={video.trim() !== ''} onPress={chooseVideo} />
      )}
      <TextField label={t('notes')} value={notes} onChangeText={setNotes} multiline maxLength={2000} />
      <ErrorText error={error} />
      <Button testID="sub-send" label={t('compSubmitScore')} busy={busy} disabled={!filled || !videoOk || uploading} onPress={() => send(true)} />
      <Button kind="text" label={t('compSaveDraft')} disabled={busy || uploading || !filled || !videoOk} onPress={() => send(false)} />
    </Screen>
  );
}
