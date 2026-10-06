import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { Image, Linking, Pressable, RefreshControl, ScrollView, Share, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';

import type { Json } from '../../core/api/client';
import { ApiError } from '../../core/api/errors';
import { useLocale, useT, type T } from '../../core/prefs';
import { useApi } from '../../core/services';
import { displayText, radius, space, useTheme } from '../../core/theme';
import { formatDate } from '../../core/utils/format';
import { newClientId } from '../../core/utils/ids';
import { EmptyState, Loading, SectionHeader, SkeletonList, StatCard, StatusPill, TimeField } from '../../core/widgets/common';
import { ErrorText, ErrorView, errorMessage } from '../../core/widgets/error';
import { Button, Card, Chip, Icon, ListGroup, ListRow, Screen, Segmented, TextField, Txt, toast, type IconName } from '../../core/widgets/kit';
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
    <Card testID={`comp-${c.id}`} onPress={() => router.push(`/competitions/${c.id}`)} style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Icon name="emoji-events" color={colors.primary} />
        <Txt variant="title" style={{ flex: 1, fontWeight: '800' }}>{c.title}</Txt>
      </View>
      {c.shortDescription ? <Txt variant="small" color={colors.outline} numberOfLines={2}>{c.shortDescription}</Txt> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: space.xs }}>
        <Meta icon="event" text={formatDate(c.eventStart, locale)} />
        <Meta icon="place" text={c.city ?? c.location ?? '—'} />
        <Meta icon="payments" text={c.registrationPrice === 0 ? t('compFree') : formatMoney(c.registrationPrice, c.currency, locale)} />
        <Meta icon="groups" text={t('compAthletes', { count: c.participants })} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <StatusPill label={statusLabelForCompetition(t, c.status)} color={c.status === 'REGISTRATION_OPEN' ? colors.primary : colors.outline} />
        {c.status === 'REGISTRATION_OPEN' && <Txt variant="small" color={colors.outline}>{t('compDeadline', { date: formatDate(c.registrationEnd, locale) })}</Txt>}
      </View>
    </Card>
  );
}

/** Small icon + text pair (date, place, price…) on competition cards. */
function Meta({ icon, text }: { icon: IconName; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      <Icon name={icon} size={16} color={colors.outline} />
      <Txt variant="small">{text}</Txt>
    </View>
  );
}

function statusLabelForCompetition(t: T, s: string) {
  if (s === 'REGISTRATION_OPEN') return t('compFilterOpen');
  if (s === 'FINAL_LEADERBOARD' || s === 'FINISHED') return t('compFilterFinished');
  if (s === 'DRAFT' || s === 'REGISTRATION_CLOSED') return t('compFilterUpcoming');
  return t('compFilterActive');
}

// ───────────── Detail ─────────────

type Tab = 'info' | 'wods' | 'leaderboard';

/** Shown when the organizer has not uploaded a banner for this competition. */
const DEFAULT_COVER = require('../../../assets/competition-cover.jpg');
const LOGO = require('../../../assets/icon.png');

export function CompetitionScreen({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const comp = useCompetition(id);
  const [tab, setTab] = useState<Tab>('info');
  const { width } = useWindowDimensions();
  const scroll = useRef<ScrollView>(null);
  const anchors = useRef<Record<string, number>>({});
  const registered = comp.data?.myRegistration?.registrationStatus === 'CONFIRMED';
  const mine = useMySubmissions(id, registered);
  if (comp.isError) return <ErrorView error={comp.error} onRetry={() => comp.refetch()} />;
  if (!comp.data) return <SkeletonList count={4} height={100} />;
  const c = comp.data;
  const subs = new Map<string, Json>((mine.data ?? []).map((s) => [s.workout.id, s]));
  const price = (p: number) => (p === 0 ? t('compFree') : formatMoney(p, c.currency, locale));
  const place = c.location ?? c.city;
  const categories = c.categories.filter((cat: Json) => cat.active);
  const anchor = (key: string) => (e: LayoutChangeEvent) => (anchors.current[key] = e.nativeEvent.layout.y);
  const goTo = (key: string) => scroll.current?.scrollTo({ y: anchors.current[key] ?? 0, animated: true });
  const share = () => Share.share({ message: `${c.title} · ${formatDate(c.eventStart, locale)}${place ? ` · ${place}` : ''}` });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: c.title }} />
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.surfaceHigh }}>
        {([['info', t('compEventInfo')], ['wods', t('compWods')], ['leaderboard', t('leaderboard')]] as const).map(([key, label]) => (
          <Pressable key={key} testID={`comp-tab-${key}`} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderBottomWidth: 3, borderBottomColor: tab === key ? colors.primary : 'transparent' }}>
            <Txt variant="title" color={tab === key ? colors.primary : colors.text}>{label}</Txt>
          </Pressable>
        ))}
      </View>
      <ScrollView ref={scroll} contentContainerStyle={{ paddingBottom: 96 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => comp.refetch()} tintColor={colors.primary} />}>
        {tab === 'info' && (
          <>
            {/* Explicit size: react-native-web ignores aspectRatio on an Image and renders the picture at its own height. */}
            <Image testID="comp-cover" source={c.coverUrl ? { uri: c.coverUrl } : DEFAULT_COVER} accessibilityIgnoresInvertColors style={{ width, height: (width * 596) / 1440 }} resizeMode="cover" />
            <View style={{ padding: 16, gap: 16 }}>
              <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
                <View style={{ width: 96, height: 96, borderRadius: 48, overflow: 'hidden', backgroundColor: colors.surfaceHigh }}>
                  <Image source={LOGO} style={{ width: '100%', height: '100%' }} />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    <Tag label={statusLabelForCompetition(t, c.status)} />
                    {c.countryCode ? <Tag label={c.countryCode} /> : null}
                  </View>
                  <Txt style={[displayText(26), { textTransform: 'uppercase' }]}>{c.title}</Txt>
                  <Txt variant="small" color={colors.outline} style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{[place?.toLowerCase().includes(String(c.format).toLowerCase()) ? null : c.format, formatDate(c.eventStart, locale), place].filter(Boolean).join(' · ')}</Txt>
                  <Pressable testID="comp-share" accessibilityRole="button" onPress={share} style={{ flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 6, backgroundColor: colors.surfaceHigh, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 }}>
                    <Icon name="share" size={18} />
                    <Txt>{t('compShare')}</Txt>
                  </Pressable>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Tile icon="place" label={t('compLocation')} onPress={place ? () => Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(place)}`) : undefined} />
                <Tile icon="category" label={t('compCategories')} onPress={categories.length ? () => goTo('categories') : undefined} />
                <Tile icon="emoji-events" label={t('compPrizes')} onPress={c.prizes.length ? () => goTo('prizes') : undefined} />
                <Tile icon="fitness-center" label={t('compWods')} onPress={() => setTab('wods')} />
              </View>

              {c.myRegistration && (
                <View testID="comp-role" style={{ borderRadius: radius.card, overflow: 'hidden', borderWidth: 1, borderColor: colors.primary }}>
                  <View style={{ backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 14 }}>
                    <Txt variant="title" color={colors.onPrimary}>{t('compIAmAthlete')}</Txt>
                  </View>
                  <View style={{ padding: 12, gap: 10, backgroundColor: colors.surface }}>
                    <Txt color={colors.outline}>{t('compMyActions')}</Txt>
                    <ActionRow done={registered} title={t('compRegistration')} subtitle={registered ? t('compAllSet') : t('compPaymentPending')} />
                    {registered && <ActionRow done={c.workouts.length > 0 && c.workouts.every((w: Json) => subs.has(w.id))} title={t('compSubmitScore')} subtitle={t('compScoresSent', { done: subs.size, total: c.workouts.length })} onPress={() => setTab('wods')} />}
                  </View>
                </View>
              )}

              {c.description ? (
                <Card>
                  <Txt>{c.description}</Txt>
                </Card>
              ) : null}
              <ListGroup>
                <ListRow icon="person" title={t('compOrganizer')} subtitle={c.organizer?.fullName ?? c.organizer?.username} />
                <ListRow icon="payments" title={t('compPrice')} subtitle={price(c.registrationPrice)} />
                <ListRow icon="event" title={t('compDeadline', { date: formatDate(c.deadlines.registrationEnd, locale) })} />
                {c.deadlines.scoreSubmissionDeadline && <ListRow icon="timer" title={t('compSubmissionDeadline')} subtitle={formatDate(c.deadlines.scoreSubmissionDeadline, locale)} />}
                {c.deadlines.judgingDeadline && <ListRow icon="gavel" title={t('compJudgingDeadline')} subtitle={formatDate(c.deadlines.judgingDeadline, locale)} />}
                {c.deadlines.leaderboardPublicationAt && <ListRow icon="leaderboard" title={t('compLeaderboardDate')} subtitle={formatDate(c.deadlines.leaderboardPublicationAt, locale)} />}
                <ListRow icon="groups" title={t('compAthletes', { count: c.participants })} />
              </ListGroup>
              <HeatSchedule id={id} />

              {categories.length > 0 && (
                <View onLayout={anchor('categories')} style={{ gap: space.md }}>
                  <SectionHeader title={t('compCategories')} />
                  <ListGroup inset={space.sm}>
                    {categories.map((cat: Json) => (
                      <ListRow key={cat.id} title={cat.name} subtitle={[cat.gender, cat.minAge != null ? `${cat.minAge}${cat.maxAge != null ? `-${cat.maxAge}` : '+'}` : null].filter(Boolean).join(' · ')} trailing={<Txt variant="title">{price(cat.price)}</Txt>} />
                    ))}
                  </ListGroup>
                </View>
              )}

              {c.prizes.length > 0 && (
                <View onLayout={anchor('prizes')} style={{ gap: space.md }}>
                  <SectionHeader title={t('compPrizes')} />
                  <ListGroup>
                    {c.prizes.map((p: Json) => (
                      <ListRow
                        key={p.id}
                        icon="military-tech"
                        title={`${p.position === 1 ? '🥇' : p.position === 2 ? '🥈' : p.position === 3 ? '🥉' : `#${p.position}`} ${p.description ?? p.type}`}
                        subtitle={c.categories.find((x: Json) => x.id === p.categoryId)?.name}
                        trailing={p.amount != null ? <Txt variant="title">{formatMoney(p.amount, p.currency ?? c.currency, locale)}</Txt> : null}
                      />
                    ))}
                  </ListGroup>
                </View>
              )}
            </View>
          </>
        )}
        {tab === 'wods' && (
          <View style={{ padding: 16, gap: 12 }}>
            {c.workouts.length === 0 ? (
              <EmptyState icon="fitness-center" message="—" />
            ) : (
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
                    {w.scoreType === 'MOVEMENT_REPS' && (w.movements ?? []).length > 0 ? (
                      <Txt variant="small" color={colors.outline}>{w.movements.map((m: Json) => `${m.name} · ${t('compPointsPerRep', { points: m.pointsPerRep })}`).join('  ·  ')}</Txt>
                    ) : null}
                    {s && <Txt variant="small">{`${statusLabel(t, s.status)}${s.points != null && s.status === 'FINAL' ? ` · ${t('compPoints', { points: Number(s.points) })}` : ''}`}</Txt>}
                    {registered && (!s || ['DRAFT', 'SUBMITTED', 'NEEDS_CORRECTION'].includes(s.status)) && (
                      <Button testID={`submit-${w.number}`} kind="tonal" icon="edit-note" label={t('compSubmitScore')} onPress={() => router.push(`/competitions/${id}/wods/${w.id}/submit`)} />
                    )}
                  </Card>
                );
              })
            )}
          </View>
        )}
        {tab === 'leaderboard' && (
          <View style={{ padding: 16 }}>
            <CompLeaderboard id={id} categories={c.categories} workouts={c.workouts} />
          </View>
        )}
      </ScrollView>
      {!c.myRegistration && c.status === 'REGISTRATION_OPEN' && (
        <View style={{ padding: 16, paddingTop: 8 }}>
          <Button testID="comp-register" label={t('compRegister')} onPress={() => router.push(`/competitions/${id}/register`)} />
        </View>
      )}
    </View>
  );
}

function Tag({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ borderWidth: 1, borderColor: colors.outline, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Txt variant="small">{label}</Txt>
    </View>
  );
}

/** Quick-access square; greyed out when there is nothing behind it. */
function Tile({ icon, label, onPress }: { icon: IconName; label: string; onPress?: () => void }) {
  const { colors } = useTheme();
  const fg = onPress ? colors.text : colors.outline;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !onPress }} disabled={!onPress} onPress={onPress} style={({ pressed }) => ({ flex: 1, aspectRatio: 0.95, alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, backgroundColor: colors.surface, opacity: pressed ? 0.8 : onPress ? 1 : 0.6 })}>
      <Icon name={icon} size={28} color={fg} />
      <Txt variant="small" color={fg} numberOfLines={1}>{label}</Txt>
    </Pressable>
  );
}

function ActionRow({ done, title, subtitle, onPress }: { done: boolean; title: string; subtitle: string; onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.surfaceHigh }}>
      <Icon name={done ? 'check-circle' : 'radio-button-unchecked'} size={28} color={done ? colors.success : colors.outline} />
      <View style={{ flex: 1 }}>
        <Txt variant="title">{title}</Txt>
        <Txt color={colors.outline}>{subtitle}</Txt>
      </View>
      {onPress && <Icon name="chevron-right" color={colors.outline} />}
    </Pressable>
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
      <ListGroup>
        {heats.data.map((h) => (
          <ListRow
            key={h.id}
            icon="schedule"
            title={h.name}
            subtitle={[h.workout?.name, h.category?.name, t('compAthletes', { count: h.lanes.length })].filter(Boolean).join(' · ')}
            trailing={<Txt>{when(h)}</Txt>}
          />
        ))}
      </ListGroup>
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
                <Txt variant="label" style={{ width: 72, textAlign: 'right' }}>{t('compTotal')}</Txt>
                {!workoutId && data.workouts.map((w: Json) => <Txt key={w.id} variant="label" style={{ width: 64, textAlign: 'right' }}>{`W${w.number}`}</Txt>)}
              </View>
              {data.rows.map((r: Json) => (
                <View key={r.athlete.id} testID={`board-row-${r.athlete.id}`} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.surfaceHigh }}>
                  <Txt style={[displayText(20), { width: 44, color: r.rank <= 3 ? colors.primary : colors.text }]}>{`#${r.rank}`}</Txt>
                  <View style={{ width: 140 }}>
                    <Txt numberOfLines={1} style={{ fontWeight: '600' }}>{r.athlete.fullName ?? r.athlete.username}</Txt>
                    {r.pending > 0 && <Txt variant="small" color={colors.outline}>{t('compPending')}</Txt>}
                  </View>
                  {/* Total first: it decides the rank and must be visible without scrolling. */}
                  <Txt style={[displayText(20), { width: 72, textAlign: 'right', color: colors.primary }]}>{String((workoutId ? r.wodPoints[workoutId] : r.totalPoints) ?? '—')}</Txt>
                  {!workoutId && data.workouts.map((w: Json) => <Txt key={w.id} style={{ width: 64, textAlign: 'right' }}>{r.wodPoints[w.id] != null ? String(r.wodPoints[w.id]) : '—'}</Txt>)}
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

/** Score + YouTube link for one WOD: only the fields its score type needs (§23). The link is required to submit. */
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
  const [moveReps, setMoveReps] = useState<Record<number, string>>({});
  const [capped, setCapped] = useState(false);
  const [video, setVideo] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!comp.data) return <Loading />;
  const w = comp.data.workouts.find((x: Json) => x.id === wodId);
  if (!w) return <ErrorView error={new ApiError('client', 404, 'NOT_FOUND')} />;
  const type: string = w.scoreType;
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
  const movements: { name: string; pointsPerRep: number }[] = (w.movements ?? []).filter((m: Json) => typeof m === 'object');
  const counts = movements.map((_, i) => num(moveReps[i] ?? ''));
  // Same formula as the server (Σ reps × points per rep); the athlete never types the score.
  const computed = counts.every((c) => c != null && Number.isInteger(c) && c >= 0) ? Math.round(movements.reduce((sum, m, i) => sum + m.pointsPerRep * (counts[i] as number), 0) * 100) / 100 : null;
  const raw: Json =
    type === 'MOVEMENT_REPS'
      ? { movementReps: counts }
      : type === 'TIME'
      ? capped
        ? { capped: true, reps: num(reps), maxReps: num(value) }
        : { timeS }
      : type === 'ROUNDS_REPS'
        ? { rounds: num(rounds), reps: num(reps), repsPerRound: num(value) }
        : type === 'REPS'
          ? { reps: num(reps) }
          : { value: num(value) };
  const filled = type === 'MOVEMENT_REPS' ? computed != null && movements.length > 0 : Object.values(raw).every((v) => v === true || (typeof v === 'number' && Number.isFinite(v)));
  const videoOk = video.trim() === '' || youtubeId(video) != null;
  const thumb = youtubeId(video);

  async function send(submit: boolean) {
    setBusy(true);
    setError(null);
    try {
      await competitionsApi(api).submit(id, wodId, { clientId, raw, notes: notes.trim() || undefined, videoUrl: video.trim() || undefined, submit });
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
      {type === 'MOVEMENT_REPS' ? (
        <>
          {movements.map((m, i) => (
            <TextField key={i} testID={`sub-move-${i}`} label={`${m.name} · ${t('compPointsPerRep', { points: m.pointsPerRep })}`} placeholder={t('compReps')} keyboardType="number-pad" value={moveReps[i] ?? ''} onChangeText={(v) => setMoveReps({ ...moveReps, [i]: v })} />
          ))}
          <Card testID="sub-computed" style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Txt variant="title">{t('compComputedScore')}</Txt>
              <Txt variant="small" color={colors.outline}>{t('compComputedHint')}</Txt>
            </View>
            <Txt style={displayText(28)} color={colors.primary}>{computed == null ? '—' : t('compPoints', { points: Math.min(computed, w.maximumPoints) })}</Txt>
          </Card>
        </>
      ) : type === 'TIME' ? (
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
      <TextField testID="sub-video" label={t('compVideoUrl')} placeholder="https://youtu.be/…" value={video} onChangeText={setVideo} autoCapitalize="none" keyboardType="url" error={videoOk ? null : t('compVideoInvalid')} />
      {thumb && (
        <Pressable onPress={() => Linking.openURL(video.trim())}>
          <Image accessibilityLabel={t('judgeWatchVideo')} source={{ uri: `https://i.ytimg.com/vi/${thumb}/hqdefault.jpg` }} style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 12 }} />
        </Pressable>
      )}
      <TextField label={t('notes')} value={notes} onChangeText={setNotes} multiline maxLength={2000} />
      <ErrorText error={error} />
      {!thumb && <Txt variant="small" color={colors.outline}>{t('compVideoRequired')}</Txt>}
      <Button testID="sub-send" label={t('compSubmitScore')} busy={busy} disabled={!filled || !thumb} onPress={() => send(true)} />
      <Button kind="text" label={t('compSaveDraft')} disabled={busy || !filled || !videoOk} onPress={() => send(false)} />
    </Screen>
  );
}
