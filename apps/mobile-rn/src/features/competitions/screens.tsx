import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import { Image, Linking, Pressable, RefreshControl, ScrollView, Share, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';

import type { Json } from '../../core/api/client';
import { ApiError } from '../../core/api/errors';
import { useLocale, useT, type T } from '../../core/prefs';
import { useApi } from '../../core/services';
import { displayText, radius, space, useTheme } from '../../core/theme';
import { formatDate } from '../../core/utils/format';
import { newClientId } from '../../core/utils/ids';
import { EmptyState, Loading, SectionHeader, SkeletonList, StatCard, StatusPill, TimeField } from '../../core/widgets/common';
import { ErrorText, ErrorView } from '../../core/widgets/error';
import { Button, Card, Chip, Icon, ListGroup, ListRow, Screen, Segmented, TextField, Txt, toast, type IconName } from '../../core/widgets/kit';
import { compKeys, competitionsApi, formatMoney, useCompetition, useCompetitions, useCompLeaderboard, useHeats, useMySubmissions, youtubeId, type CompFilter } from './api';
import { useMe } from '../me/api';
import { FloorJudgeCard } from './judge/screens';
import { appealRuleOf, appealState, athleteName, myRow, searchBoard } from './logic-board';
import { defaultDay, hasMine, heatsOfDay, heatState, lanesWithEmpty, matchingLanes } from './logic-heats-day';
import { heatDays } from './organizer/logic-b';
import { ageRange, cheapestPrice, earlyBirdPercent, registrationLine, whoCanJoin, workoutFormat } from './logic-event-page';
import { activeFilters, countriesOf, daysToRegister, EMPTY_DISCOVER, filterEvents, flagOf, toggle, typeOf, type Discover, type EventFormat, type EventType, type When } from './logic-discover';
import { CompetitionAnnouncements } from './organizer/announcements';
import { useLocalList } from './organizer/roster';
import { ShopLink } from './organizer/shop';
import { publicationState } from './organizer/logic';

const statusLabel = (t: T, s: string) => (t as (k: string) => string)(`compStatus${s}`);

// ───────────── List ─────────────

export function CompetitionsScreen() {
  const t = useT();
  const { colors } = useTheme();
  const [filter, setFilter] = useState<CompFilter>('ALL');
  const [mine, setMine] = useState(false);
  const [d, setD] = useState<Discover>(EMPTY_DISCOVER);
  const [open, setOpen] = useState(false);
  const list = useCompetitions(filter, mine);
  const countries = countriesOf(list.data ?? []);
  const shown = list.data ? filterEvents(list.data, d, Date.now()) : null;
  const active = activeFilters(d);
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <TextField testID="comp-search" icon="search" placeholder={t('discoverSearch')} value={d.q} onChangeText={(q) => setD({ ...d, q })} autoCapitalize="none" returnKeyType="search" />
          </View>
          <Pressable
            testID="comp-filters"
            accessibilityRole="button"
            accessibilityLabel={t('discoverFilters')}
            accessibilityState={{ expanded: open }}
            onPress={() => setOpen(!open)}
            style={({ pressed }) => ({ width: 48, height: 48, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center', backgroundColor: open || active ? colors.primary : colors.surfaceHigh, opacity: pressed ? 0.8 : 1 })}
          >
            <Icon name="tune" color={open || active ? colors.onPrimary : colors.text} />
            {active ? (
              <View style={{ position: 'absolute', top: 4, end: 4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
                <Txt variant="small" style={{ fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] }} color={colors.primary}>{String(active)}</Txt>
              </View>
            ) : null}
          </Pressable>
        </View>
        {open ? <FiltersPanel d={d} onChange={setD} countries={countries} /> : null}
      </View>
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
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 }}>
        <Chip testID="comp-my-events" icon="event-available" label={t('myEventsTitle')} onPress={() => router.push('/competitions/mine')} />
        <Chip testID="comp-mine" icon="person" label={t('competitionsMine')} selected={mine} onPress={() => setMine(!mine)} />
        <Chip testID="comp-create" icon="add" label={t('createEvent')} onPress={() => router.push('/competitions/new')} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => list.refetch()} tintColor={colors.primary} />}>
        {list.isError ? (
          <ErrorView error={list.error} onRetry={() => list.refetch()} />
        ) : !shown ? (
          <SkeletonList count={3} height={240} />
        ) : list.data!.length === 0 ? (
          <EmptyState icon="emoji-events" message={t('compNone')} />
        ) : shown.length === 0 ? (
          <EmptyState icon="search-off" message={t('discoverNoMatch')} actionLabel={t('discoverClear')} onAction={() => setD(EMPTY_DISCOVER)} />
        ) : (
          <>
            {d.q.trim() || active ? <Txt testID="comp-count" variant="small" color={colors.outline}>{t('discoverCount', { count: shown.length })}</Txt> : null}
            {shown.map((c) => (
              <CompetitionCard key={c.id} c={c} />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** Type, format, country and dates; several values of one kind add up (« on site » or « online »). */
function FiltersPanel({ d, onChange, countries }: { d: Discover; onChange: (d: Discover) => void; countries: string[] }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const group = (title: string, children: ReactNode) => (
    <View style={{ gap: space.xs }}>
      <Txt variant="label" color={colors.outline}>{title}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>{children}</View>
    </View>
  );
  const types: { key: EventType; label: string; icon: IconName }[] = [
    { key: 'FUNCTIONAL', label: t('discoverTypeFunctional'), icon: 'fitness-center' },
    { key: 'HYBRID', label: t('discoverTypeHybrid'), icon: 'directions-run' },
  ];
  const formats: { key: EventFormat; label: string }[] = [
    { key: 'ONSITE', label: t('orgFormatOnsite') },
    { key: 'ONLINE', label: t('orgFormatOnline') },
    { key: 'HYBRID', label: t('orgFormatHybrid') },
  ];
  const whens: { key: When; label: string }[] = [
    { key: 'ANY', label: t('discoverWhenAny') },
    { key: 'MONTH', label: t('discoverWhenMonth') },
    { key: 'QUARTER', label: t('discoverWhenQuarter') },
  ];
  return (
    <Card testID="comp-filter-panel" style={{ gap: space.md, padding: space.md }}>
      {group(t('discoverType'), types.map((x) => <Chip key={x.key} testID={`comp-type-${x.key}`} icon={x.icon} label={x.label} selected={d.types.includes(x.key)} onPress={() => onChange({ ...d, types: toggle(d.types, x.key) })} />))}
      {group(t('discoverFormat'), formats.map((x) => <Chip key={x.key} testID={`comp-format-${x.key}`} label={x.label} selected={d.formats.includes(x.key)} onPress={() => onChange({ ...d, formats: toggle(d.formats, x.key) })} />))}
      {countries.length > 1 ? group(t('discoverCountry'), countries.map((code) => <Chip key={code} testID={`comp-country-${code}`} label={`${flagOf(code)} ${countryName(code, locale)}`} selected={d.countries.includes(code)} onPress={() => onChange({ ...d, countries: toggle(d.countries, code) })} />)) : null}
      {group(t('discoverWhen'), whens.map((x) => <Chip key={x.key} testID={`comp-when-${x.key}`} label={x.label} selected={d.when === x.key} onPress={() => onChange({ ...d, when: x.key })} />))}
      {activeFilters(d) ? <Button testID="comp-filters-clear" kind="text" icon="close" label={t('discoverClear')} onPress={() => onChange({ ...EMPTY_DISCOVER, q: d.q })} /> : null}
    </Card>
  );
}

/** The country's name in the language shown, the code when the device cannot name it. */
function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** An event as Circle21 shows it: the cover first, the date on it, then what an athlete decides on. */
function CompetitionCard({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const start = new Date(c.eventStart);
  const left = daysToRegister(c, Date.now());
  const open = c.status === 'REGISTRATION_OPEN';
  const format = ({ ONSITE: t('orgFormatOnsite'), ONLINE: t('orgFormatOnline'), HYBRID: t('orgFormatHybrid') } as Record<string, string>)[c.format];
  const place = [c.city ?? c.location, c.countryCode ? `${flagOf(c.countryCode)}` : null].filter(Boolean).join(' ');
  return (
    <Pressable
      testID={`comp-${c.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${c.title}, ${formatDate(c.eventStart, locale)}`}
      onPress={() => router.push(c.status === 'DRAFT' ? `/competitions/${c.id}/manage` : `/competitions/${c.id}`)}
      style={({ pressed }) => ({ borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.9 : 1 })}
    >
      {/* The box sets the shape; the image fills it (on the web an image keeps its own height otherwise). */}
      <View style={{ width: '100%', aspectRatio: 2.2, backgroundColor: colors.surfaceHigh }}>
        <Image source={c.coverUrl ? { uri: c.coverUrl } : DEFAULT_COVER} accessibilityIgnoresInvertColors resizeMode="cover" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, width: '100%', height: '100%' }} />
        {/* The date block, readable on any cover. */}
        <View style={{ position: 'absolute', top: space.md, start: space.md, minWidth: 52, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 12, alignItems: 'center', backgroundColor: colors.background }}>
          <Txt style={[displayText(26), { lineHeight: 26 }]} color={colors.text}>{formatDate(start, locale, { day: 'numeric' })}</Txt>
          <Txt variant="small" style={{ fontWeight: '800', textTransform: 'uppercase', fontSize: 11, letterSpacing: 0.6 }} color={colors.primary}>{formatDate(start, locale, { month: 'short' })}</Txt>
        </View>
        <View style={{ position: 'absolute', top: space.md, end: space.md }}>
          <View style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: open ? colors.primary : colors.background }}>
            <Txt variant="small" style={{ fontWeight: '800', fontSize: 12 }} color={open ? colors.onPrimary : colors.text}>{c.status === 'DRAFT' ? draftLabel(t, c) : statusLabelForCompetition(t, c.status)}</Txt>
          </View>
        </View>
      </View>
      <View style={{ padding: space.lg, gap: space.sm }}>
        <Txt variant="title" style={{ fontWeight: '800' }} numberOfLines={2}>{c.title}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: space.xs }}>
          {place ? <Meta icon="place" text={place} /> : null}
          {format ? <Meta icon={c.format === 'ONLINE' ? 'videocam' : 'stadium'} text={format} /> : null}
          <Meta icon={typeOf(c) === 'HYBRID' ? 'directions-run' : 'fitness-center'} text={typeOf(c) === 'HYBRID' ? t('discoverTypeHybrid') : t('discoverTypeFunctional')} />
        </View>
        {c.shortDescription ? <Txt variant="small" color={colors.outline} numberOfLines={2}>{c.shortDescription}</Txt> : null}
        {c.status !== 'DRAFT' ? <RegistrationLineText c={c} /> : null}
        <View style={{ height: 1, backgroundColor: colors.border, marginVertical: space.xs }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Txt variant="small" color={colors.outline}>{t('discoverFrom')}</Txt>
            <Txt style={{ fontWeight: '800', fontVariant: ['tabular-nums'] }} color={colors.primary}>{c.registrationPrice === 0 ? t('compFree') : formatMoney(c.registrationPrice, c.currency, locale)}</Txt>
          </View>
          <Meta icon="groups" text={t('compAthletes', { count: c.participants ?? 0 })} />
          {left != null ? (
            <View style={{ paddingVertical: 4, paddingHorizontal: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceHigh }}>
              <Txt variant="small" style={{ fontWeight: '700' }} color={left <= 7 ? colors.warning : colors.text}>{left === 0 ? t('discoverClosesToday') : t('discoverClosesIn', { count: left })}</Txt>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

/** Circle21's registration line: open until …, starts …, or closed. */
function RegistrationLineText({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const line = registrationLine(c, Date.now());
  const day = (iso: string) => formatDate(iso, locale, { day: 'numeric', month: 'short' });
  const text = line.kind === 'OPEN' ? (line.until ? t('evRegOpenUntil', { date: day(line.until) }) : t('evOpen')) : line.kind === 'STARTS' ? t('evRegStarts', { date: day(line.from) }) : t('evRegClosed');
  return (
    <View testID={`comp-reg-line-${c.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      <Icon name={line.kind === 'OPEN' ? 'how-to-reg' : line.kind === 'STARTS' ? 'event-available' : 'block'} size={16} color={line.kind === 'OPEN' ? colors.primary : colors.outline} />
      <Txt variant="small" style={{ fontWeight: '600' }} color={line.kind === 'OPEN' ? colors.text : colors.outline}>{text}</Txt>
    </View>
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

export function statusLabelForCompetition(t: T, s: string) {
  if (s === 'REGISTRATION_OPEN') return t('compFilterOpen');
  if (s === 'FINAL_LEADERBOARD' || s === 'FINISHED') return t('compFilterFinished');
  if (s === 'DRAFT' || s === 'REGISTRATION_CLOSED') return t('compFilterUpcoming');
  return t('compFilterActive');
}

/** Only organizers see drafts: the card tells where the publication stands. */
function draftLabel(t: T, c: Json) {
  const s = publicationState(c);
  return s === 'REQUESTED' ? t('orgCardRequested') : s === 'RETURNED' ? t('orgCardReturned') : t('orgCardDraft');
}

// ───────────── Detail ─────────────

type Tab = 'info' | 'wods' | 'leaderboard' | 'schedule';

/** Shown when the organizer has not uploaded a banner for this competition. */
export const DEFAULT_COVER = require('../../../assets/competition-cover.jpg');
const LOGO = require('../../../assets/icon.png');

/**
 * The event page, laid out like Circle21's: the cover with the title on it, the key facts, quick actions, then
 * sticky tabs (Event Info · WODs · Leaderboard · Schedule) and « Register now » pinned at the bottom.
 */
export function CompetitionScreen({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const comp = useCompetition(id);
  const sponsors = useLocalList(id, 'sponsors');
  const [tab, setTab] = useState<Tab>('info');
  const { width } = useWindowDimensions();
  const scroll = useRef<ScrollView>(null);
  const anchors = useRef<Record<string, number>>({});
  const heroHeight = useRef(0);
  const registered = comp.data?.myRegistration?.registrationStatus === 'CONFIRMED';
  const mine = useMySubmissions(id, registered);
  if (comp.isError) return <ErrorView error={comp.error} onRetry={() => comp.refetch()} />;
  if (!comp.data) return <SkeletonList count={4} height={100} />;
  const c = comp.data;
  const now = Date.now();
  const subs = new Map<string, Json>((mine.data ?? []).map((s) => [s.workout.id, s]));
  const price = (p: number) => (p === 0 ? t('compFree') : formatMoney(p, c.currency, locale));
  const place = c.location ?? c.city;
  const onsite = c.format !== 'ONLINE';
  const categories: Json[] = (c.categories ?? []).filter((cat: Json) => cat.active);
  const anchor = (key: string) => (e: LayoutChangeEvent) => (anchors.current[key] = e.nativeEvent.layout.y);
  // The section lands just under the sticky tabs.
  const goTo = (key: string) => {
    setTab('info');
    requestAnimationFrame(() => scroll.current?.scrollTo({ y: heroHeight.current + (anchors.current[key] ?? 0), animated: true }));
  };
  const share = () => Share.share({ message: `${c.title} · ${formatDate(c.eventStart, locale)}${place ? ` · ${place}` : ''}` });
  const directions = onsite && place ? () => Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(place)}`) : undefined;
  const canRegister = !c.myRegistration && c.status === 'REGISTRATION_OPEN';
  const join = whoCanJoin(c);
  const genders: Record<string, string> = { MALE: t('orgGenderMale'), FEMALE: t('orgGenderFemale'), MIXED: t('orgGenderMixed') };
  const tiers = Object.values(colors.tier);
  const contact: { key: string; icon: IconName; label: string; url: string }[] = [
    c.contactEmail ? { key: 'email', icon: 'mail', label: t('evEmail'), url: `mailto:${c.contactEmail}` } : null,
    c.website ? { key: 'website', icon: 'language', label: t('evWebsite'), url: c.website } : null,
    c.instagram ? { key: 'instagram', icon: 'photo-camera', label: 'Instagram', url: c.instagram.startsWith('http') ? c.instagram : `https://instagram.com/${c.instagram.replace(/^@/, '')}` } : null,
    c.facebook ? { key: 'facebook', icon: 'thumb-up', label: 'Facebook', url: c.facebook } : null,
  ].filter((x): x is { key: string; icon: IconName; label: string; url: string } => !!x);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: c.title }} />
      {(c.myRoles ?? []).includes('ORGANIZER') ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <Button testID="comp-manage" kind="outlined" icon="tune" label={t('orgManage')} onPress={() => router.push(`/competitions/${c.id}/manage`)} />
        </View>
      ) : null}
      <ScrollView ref={scroll} stickyHeaderIndices={[1]} contentContainerStyle={{ paddingBottom: canRegister ? 128 : 40 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => comp.refetch()} tintColor={colors.primary} />}>
        <View onLayout={(e) => (heroHeight.current = e.nativeEvent.layout.height)}>
          <EventHero c={c} width={width} now={now} price={price} />
          {/* Quick actions: every part of the event one tap away. */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.sm }}>
            {categories.length ? <ActionPill testID="comp-go-divisions" icon="category" label={t('evDivisions')} onPress={() => goTo('divisions')} /> : null}
            <ActionPill testID="comp-go-wods" icon="fitness-center" label={t('compWods')} onPress={() => setTab('wods')} />
            <ActionPill testID="comp-go-leaderboard" icon="leaderboard" label={t('leaderboard')} onPress={() => setTab('leaderboard')} />
            <ActionPill testID="comp-go-schedule" icon="schedule" label={t('evSchedule')} onPress={() => setTab('schedule')} />
            {c.rulebookUrl ? <ActionPill testID="comp-rulebook" icon="menu-book" label={t('evRulebook')} onPress={() => Linking.openURL(c.rulebookUrl)} /> : null}
            {directions ? <ActionPill testID="comp-directions" icon="directions" label={t('evDirections')} onPress={directions} /> : null}
            {c.videoUrl ? <ActionPill testID="comp-video" icon="play-circle" label={t('evVideo')} onPress={() => Linking.openURL(c.videoUrl)} /> : null}
            <ActionPill testID="comp-share" icon="share" label={t('compShare')} onPress={share} />
          </ScrollView>
        </View>

        {/* Tabs at their natural width, scrolling sideways when the screen is narrow. */}
        <View style={{ backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.surfaceHigh }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.sm, flexGrow: 1 }}>
            {([['info', t('compEventInfo')], ['wods', t('compWods')], ['leaderboard', t('leaderboard')], ['schedule', t('evSchedule')]] as const).map(([key, label]) => (
              <Pressable key={key} testID={`comp-tab-${key}`} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingHorizontal: space.md, borderBottomWidth: 3, borderBottomColor: tab === key ? colors.primary : 'transparent' }}>
                <Txt numberOfLines={1} style={{ fontWeight: '700', fontSize: 15 }} color={tab === key ? colors.primary : colors.text}>{label}</Txt>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View>
          {tab === 'info' && (
            <View style={{ padding: space.lg, gap: space.xl }}>
              <FloorJudgeCard c={c} />

              {c.myRegistration && (
                <View testID="comp-role" style={{ borderRadius: radius.card, overflow: 'hidden', borderWidth: 1, borderColor: colors.primary }}>
                  <View style={{ backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 14 }}>
                    <Txt variant="title" color={colors.onPrimary}>{t('compIAmAthlete')}</Txt>
                  </View>
                  <View style={{ padding: 12, gap: 10, backgroundColor: colors.surface }}>
                    <Txt color={colors.outline}>{t('compMyActions')}</Txt>
                    <ActionRow done={registered} title={t('compRegistration')} subtitle={registered ? t('compAllSet') : t('compPaymentPending')} />
                    {c.myRegistration.teamName ? <Txt testID="my-team">{t('compMyTeam', { name: c.myRegistration.teamName })}</Txt> : null}
                    {c.myRegistration.paymentPlan === 'DEPOSIT' ? <Txt color={colors.outline}>{t('compDepositPlan')}</Txt> : null}
                    {registered && <ActionRow done={c.workouts.length > 0 && c.workouts.every((w: Json) => subs.has(w.id))} title={t('compSubmitScore')} subtitle={t('compScoresSent', { done: subs.size, total: c.workouts.length })} onPress={() => setTab('wods')} />}
                  </View>
                </View>
              )}

              <HeatSchedule id={id} part="mine" />

              {c.description ? (
                <Section title={t('evDetails')}>
                  <ReadMore text={c.description} />
                </Section>
              ) : null}

              {categories.length > 0 && (
                <View onLayout={anchor('divisions')}>
                  <Section title={t('evWhoCanJoin')}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                      {join.individuals ? <Tag icon="person" label={t('evIndividuals')} /> : null}
                      {join.teams ? <Tag icon="groups" label={t('evTeams')} /> : null}
                      <Tag icon="category" label={t('evDivisionsCount', { count: categories.length })} />
                    </View>
                    <ListGroup inset={space.lg}>
                      {categories.map((cat: Json, i: number) => {
                        const early = typeof cat.earlyPrice === 'number' && cat.earlyUntil && Date.parse(cat.earlyUntil) > now;
                        return (
                          <ListRow
                            key={cat.id}
                            testID={`comp-div-${cat.id}`}
                            leading={<View style={{ width: 6, alignSelf: 'stretch', minHeight: 36, borderRadius: 3, backgroundColor: tiers[i % tiers.length] }} />}
                            title={cat.name}
                            subtitle={[genders[cat.gender] ?? cat.gender, ageRange(cat), cat.level, cat.type === 'TEAM' ? t('evTeam') : null].filter(Boolean).join(' · ')}
                            trailing={
                              <View style={{ alignItems: 'flex-end' }}>
                                <Txt variant="title" style={{ fontVariant: ['tabular-nums'] }}>{price(early ? cat.earlyPrice : cat.price)}</Txt>
                                {early ? <Txt variant="small" style={{ textDecorationLine: 'line-through' }} color={colors.outline}>{price(cat.price)}</Txt> : null}
                              </View>
                            }
                          />
                        );
                      })}
                    </ListGroup>
                  </Section>
                </View>
              )}

              <Section title={t('evKeyDates')}>
                <ListGroup>
                  <ListRow icon="event" title={t('evEventDates')} subtitle={dateRange(c.eventStart, c.eventEnd, locale)} />
                  <ListRow icon="how-to-reg" title={t('compDeadline', { date: formatDate(c.deadlines.registrationEnd, locale) })} />
                  {c.deadlines.scoreSubmissionDeadline && <ListRow icon="timer" title={t('compSubmissionDeadline')} subtitle={formatDate(c.deadlines.scoreSubmissionDeadline, locale)} />}
                  {c.deadlines.judgingDeadline && <ListRow icon="gavel" title={t('compJudgingDeadline')} subtitle={formatDate(c.deadlines.judgingDeadline, locale)} />}
                  {c.deadlines.leaderboardPublicationAt && <ListRow icon="leaderboard" title={t('compLeaderboardDate')} subtitle={formatDate(c.deadlines.leaderboardPublicationAt, locale)} />}
                </ListGroup>
              </Section>

              {c.prizes.length > 0 && (
                <View onLayout={anchor('prizes')}>
                  <Section title={t('compPrizes')}>
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
                  </Section>
                </View>
              )}

              <Section title={t('evOrganizedBy')}>
                <Card style={{ gap: space.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                    <View style={{ width: 48, height: 48, borderRadius: 24, overflow: 'hidden', backgroundColor: colors.surfaceHigh }}>
                      <Image source={LOGO} style={{ width: '100%', height: '100%' }} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Txt variant="title">{c.organizerName || c.organizer?.fullName || c.organizer?.username || '—'}</Txt>
                      <Txt variant="small" color={colors.outline}>{t('compOrganizer')}</Txt>
                    </View>
                  </View>
                  {contact.length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                      {contact.map((x) => (
                        <ActionPill key={x.key} testID={`comp-contact-${x.key}`} icon={x.icon} label={x.label} onPress={() => Linking.openURL(x.url)} />
                      ))}
                    </View>
                  ) : null}
                </Card>
              </Section>

              {(sponsors.data ?? []).length ? (
                <Section title={t('evSponsoredBy')}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                    {(sponsors.data ?? []).map((s) => (
                      <Tag key={s.id} icon="verified" label={s.name} />
                    ))}
                  </View>
                </Section>
              ) : null}

              {directions ? (
                <Section title={t('compLocation')}>
                  <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                    <Icon name="place" color={colors.primary} />
                    <Txt style={{ flex: 1 }}>{place}</Txt>
                    <Button kind="text" icon="directions" label={t('evDirections')} onPress={directions} />
                  </Card>
                </Section>
              ) : null}

              <CompetitionAnnouncements id={id} />
              <ShopLink id={id} />
            </View>
          )}
          {tab === 'wods' && (
            <View style={{ padding: 16, gap: 12 }}>
              {c.workouts.length === 0 ? (
                <EmptyState icon="fitness-center" message={t('evWodsNone')} />
              ) : (
                c.workouts.map((w: Json) => {
                  const s = subs.get(w.id);
                  const fmt = workoutFormat(w.scoreType);
                  return (
                    <Card key={w.id} testID={`wod-${w.number}`} style={{ gap: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                        <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceHigh }}>
                          <Txt style={displayText(18)} color={colors.primary}>{String(w.number)}</Txt>
                        </View>
                        <Txt variant="title" style={{ flex: 1, fontWeight: '800' }}>{w.name}</Txt>
                        <Txt color={colors.primary} style={{ fontWeight: '700' }}>{t('compMaxPoints', { points: w.maximumPoints })}</Txt>
                      </View>
                      <Txt variant="small" style={{ fontWeight: '700' }} color={colors.outline}>{[t(`evFormat${fmt}`), w.timeCapS ? t('evTimeCap', { min: Math.round(w.timeCapS / 60) }) : null].filter(Boolean).join(' · ')}</Txt>
                      <Txt>{w.description}</Txt>
                      {w.standards ? <Txt variant="small" color={colors.outline}>{w.standards}</Txt> : null}
                      {w.scoreType === 'MOVEMENT_REPS' && (w.movements ?? []).length > 0 ? (
                        <Txt variant="small" color={colors.outline}>{w.movements.map((m: Json) => `${m.name} · ${t('compPointsPerRep', { points: m.pointsPerRep })}`).join('  ·  ')}</Txt>
                      ) : null}
                      {w.videoUrl ? <Button kind="text" icon="play-circle" label={t('evWodVideo')} onPress={() => Linking.openURL(w.videoUrl)} /> : null}
                      {s && <Txt variant="small">{`${statusLabel(t, s.status)}${s.points != null && s.status === 'FINAL' ? ` · ${t('compPoints', { points: Number(s.points) })}` : ''}`}</Txt>}
                      {registered && (!s || ['DRAFT', 'SUBMITTED', 'NEEDS_CORRECTION'].includes(s.status)) && (
                        <Button testID={`submit-${w.number}`} kind="tonal" icon="edit-note" label={t('compSubmitScore')} onPress={() => router.push(`/competitions/${id}/wods/${w.id}/submit`)} />
                      )}
                      {registered && appealState(appealRuleOf(c), s, now) === 'OPEN' ? (
                        <Button testID={`appeal-${w.number}`} kind="text" icon="gavel" label={t('appealOpen')} onPress={() => router.push(`/competitions/${id}/wods/${w.id}/appeal`)} />
                      ) : null}
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
          {tab === 'schedule' && (
            <View style={{ padding: 16, gap: 12 }}>
              <HeatSchedule id={id} part="all" />
            </View>
          )}
        </View>
      </ScrollView>
      {canRegister && (
        <View pointerEvents="box-none" style={{ position: 'absolute', start: 0, end: 0, bottom: 0 }}>
          <Fade />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.lg, paddingTop: space.xs, backgroundColor: colors.background }}>
            <View>
              <Txt variant="small" color={colors.outline}>{t('discoverFrom')}</Txt>
              <Txt style={{ fontWeight: '800', fontVariant: ['tabular-nums'] }} color={colors.primary}>{price(cheapestPrice(c, now))}</Txt>
            </View>
            <View style={{ flex: 1 }}>
              <Button testID="comp-register" icon="how-to-reg" label={t('evRegisterNow')} onPress={() => router.push(`/competitions/${id}/register`)} />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

/** « 14 – 16 Oct 2026 », or one date when the event lasts a day. */
function dateRange(start: string, end: string | null | undefined, locale: string): string {
  const a = formatDate(start, locale, { day: 'numeric', month: 'short', year: 'numeric' });
  if (!end || formatDate(end, locale, { dateStyle: 'medium' }) === formatDate(start, locale, { dateStyle: 'medium' })) return a;
  return `${formatDate(start, locale, { day: 'numeric', month: 'short' })} – ${formatDate(end, locale, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

/** The cover with the title over its lower part, then three facts. */
function EventHero({ c, width, now, price }: { c: Json; width: number; now: number; price: (p: number) => string }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const place = c.location ?? c.city;
  const early = earlyBirdPercent(c, now);
  const line = registrationLine(c, now);
  const format = ({ ONSITE: t('orgFormatOnsite'), ONLINE: t('orgFormatOnline'), HYBRID: t('orgFormatHybrid') } as Record<string, string>)[c.format];
  const third =
    early != null
      ? { testID: 'fact-early', value: `−${early}%`, label: t('evEarlyBird') }
      : line.kind === 'OPEN'
        ? { testID: 'fact-registration', value: line.daysLeft != null ? String(line.daysLeft) : t('evOpen'), label: line.daysLeft != null ? t('evDaysLeft') : t('evRegistration') }
        : line.kind === 'STARTS'
          ? { testID: 'fact-registration', value: formatDate(line.from, locale, { day: 'numeric', month: 'short' }), label: t('evRegistrationStarts') }
          : { testID: 'fact-registration', value: t('evClosed'), label: t('evRegistration') };
  // The banner's own shape (organizers upload 1440 × 596), so nothing of it is cut; it stops growing on a large screen.
  const height = Math.min(Math.round((width * 596) / 1440), 340);
  return (
    <View>
      <View style={{ width: '100%', height, backgroundColor: colors.surfaceHigh }}>
        <Image testID="comp-cover" source={c.coverUrl ? { uri: c.coverUrl } : DEFAULT_COVER} accessibilityIgnoresInvertColors resizeMode="cover" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, width: '100%', height: '100%' }} />
        {/* A soft edge into the page; the title sits below, readable whatever the cover shows. */}
        <View style={{ position: 'absolute', start: 0, end: 0, bottom: 0, height: '35%' }}>
          <Fade fill />
        </View>
        <View style={{ position: 'absolute', start: space.lg, bottom: space.md, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Pill label={statusLabelForCompetition(t, c.status)} strong={c.status === 'REGISTRATION_OPEN'} />
          {format ? <Pill label={format} /> : null}
          <Pill label={typeOf(c) === 'HYBRID' ? t('discoverTypeHybrid') : t('discoverTypeFunctional')} />
        </View>
      </View>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, gap: 4 }}>
        <Txt accessibilityRole="header" style={[displayText(30), { textTransform: 'uppercase' }]}>{c.title}</Txt>
        <Txt variant="small" style={{ fontWeight: '600' }} color={colors.outline}>{[dateRange(c.eventStart, c.eventEnd, locale), place, c.countryCode ? flagOf(c.countryCode) : null].filter(Boolean).join(' · ')}</Txt>
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm, padding: space.lg }}>
        <Fact testID="fact-athletes" value={String(c.participants ?? 0)} label={t('evAthletes')} />
        <Fact testID="fact-fees" value={price(cheapestPrice(c, now))} label={t('evFees')} />
        <Fact testID={third.testID} value={third.value} label={third.label} accent={early != null || (line.kind === 'OPEN' && line.daysLeft != null && line.daysLeft <= 7)} />
      </View>
    </View>
  );
}

/** A fade from transparent to the page colour, in bands (no gradient module in the app). */
function Fade({ fill }: { fill?: boolean }) {
  const { colors } = useTheme();
  return (
    <View pointerEvents="none" style={fill ? { flex: 1 } : { height: 32 }}>
      {['00', '33', '66', '99', 'CC'].map((a) => (
        <View key={a} style={{ flex: 1, backgroundColor: `${colors.background}${a}` }} />
      ))}
    </View>
  );
}

function Fact({ value, label, accent, testID }: { value: string; label: string; accent?: boolean; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ flex: 1, paddingVertical: space.md, paddingHorizontal: space.sm, borderRadius: 14, alignItems: 'center', gap: 2, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <Txt style={[displayText(24), { lineHeight: 26 }]} numberOfLines={1} adjustsFontSizeToFit color={accent ? colors.primary : colors.text}>{value}</Txt>
      <Txt variant="small" style={{ textAlign: 'center' }} numberOfLines={2} color={colors.outline}>{label}</Txt>
    </View>
  );
}

function Pill({ label, strong }: { label: string; strong?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ paddingVertical: 3, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: strong ? colors.primary : `${colors.background}CC` }}>
      <Txt variant="small" style={{ fontWeight: '800', fontSize: 12 }} color={strong ? colors.onPrimary : colors.text}>{label}</Txt>
    </View>
  );
}

/** A rounded quick action (« Workouts », « Rulebook », « Get directions »…). */
function ActionPill({ icon, label, onPress, testID }: { icon: IconName; label: string; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} hitSlop={{ top: 2, bottom: 2 }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.surfaceHigh, opacity: pressed ? 0.8 : 1 })}>
      <Icon name={icon} size={18} color={colors.primary} />
      <Txt style={{ fontWeight: '700', fontSize: 14 }}>{label}</Txt>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.md }}>
      <SectionHeader title={title} />
      {children}
    </View>
  );
}

/** A long description folded to six lines, with « Read more ». */
function ReadMore({ text }: { text: string }) {
  const t = useT();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const long = text.length > 280 || text.split('\n').length > 6;
  return (
    <Card style={{ gap: space.sm }}>
      <Txt numberOfLines={open || !long ? undefined : 6}>{text}</Txt>
      {long ? <Button testID="comp-read-more" kind="text" label={open ? t('evReadLess') : t('evReadMore')} onPress={() => setOpen(!open)} style={{ alignSelf: 'flex-start' }} /> : null}
    </Card>
  );
}

function Tag({ label, icon }: { label: string; icon?: IconName }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
      {icon ? <Icon name={icon} size={16} color={colors.outline} /> : null}
      <Txt variant="small" style={{ fontWeight: '600' }}>{label}</Txt>
    </View>
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
function HeatSchedule({ id, part }: { id: string; part: 'mine' | 'all' }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const heats = useHeats(id);
  if (!heats.data) return part === 'all' ? <SkeletonList count={3} height={56} /> : null;
  if (heats.data.length === 0) return part === 'all' ? <EmptyState icon="schedule" message={t('evScheduleNone')} /> : null;
  const when = (h: Json) => (h.startsAt ? formatDate(h.startsAt, locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  const mine = heats.data.flatMap((h) => h.lanes.filter((l: Json) => l.mine).map((l: Json) => ({ heat: h, lane: l.lane })));
  return (
    <>
      {mine.map(({ heat, lane }) => (
        <Card key={heat.id} testID="my-heat" onPress={() => router.push(`/competitions/${id}/my-heats`)} style={{ backgroundColor: colors.primary + '22', gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Txt variant="label" style={{ flex: 1 }}>{t('compMyHeat')}</Txt>
            <Txt variant="small" color={colors.primary}>{t('myHeatOpen')}</Txt>
            <Icon name="chevron-right" color={colors.primary} />
          </View>
          <Txt style={displayText(24)}>{`${heat.name} · ${t('compLane', { lane })}`}</Txt>
          <Txt>{[heat.workout?.name, when(heat)].filter(Boolean).join(' · ')}</Txt>
        </Card>
      ))}
      {part === 'all' ? <HeatsOfDay heats={heats.data} /> : null}
    </>
  );
}

/**
 * Circle21's « Heats of the day »: one day at a time, « Show only my heats », a search for a heat or an athlete, and
 * each heat opening on its lanes (« Empty lane » included). Searching opens the heats that match.
 */
function HeatsOfDay({ heats }: { heats: Json[] }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const days = heatDays(heats);
  const [day, setDay] = useState<string | null>(() => defaultDay(days, Date.now()));
  const [mineOnly, setMineOnly] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string[]>([]);
  const now = Date.now();
  const shown = heatsOfDay(heats, { day: days.length > 1 ? day : null, mineOnly, q });
  const anyMine = heats.some(hasMine);
  const time = (iso: string) => formatDate(iso, locale, { hour: '2-digit', minute: '2-digit' });
  return (
    <>
      <SectionHeader title={t('compHeats')} />
      <TextField testID="heats-search" icon="search" placeholder={t('heatsSearch')} value={q} onChangeText={setQ} autoCapitalize="none" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {anyMine ? <Chip testID="heats-mine" icon="person" label={t('heatsMineOnly')} selected={mineOnly} onPress={() => setMineOnly(!mineOnly)} /> : null}
        {days.length > 1
          ? days.map((d) => <Chip key={d} testID={`heats-day-${d}`} label={formatDate(`${d}T12:00:00`, locale, { weekday: 'short', day: 'numeric', month: 'short' })} selected={day === d} onPress={() => setDay(d)} />)
          : null}
      </ScrollView>
      {shown.length === 0 ? (
        <EmptyState icon="search-off" message={q.trim() ? t('heatsNotFound', { name: q.trim() }) : t('heatsNoneThatDay')} />
      ) : (
        shown.map((h) => {
          const state = heatState(h, now);
          const expanded = open.includes(h.id) || !!q.trim() || mineOnly;
          const hits = matchingLanes(h, q);
          const mine = hasMine(h);
          return (
            <View key={h.id} testID={`heat-${h.id}`} style={{ borderRadius: 14, borderWidth: mine ? 2 : 1, borderColor: mine ? colors.primary : colors.border, backgroundColor: colors.surface, overflow: 'hidden' }}>
              <Pressable
                testID={`heat-toggle-${h.id}`}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => setOpen(open.includes(h.id) ? open.filter((x) => x !== h.id) : [...open, h.id])}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, opacity: pressed ? 0.85 : 1 })}
              >
                <View style={{ width: 72, alignItems: 'center' }}>
                  <Txt numberOfLines={1} adjustsFontSizeToFit style={[displayText(18), { lineHeight: 22 }]} color={state === 'DONE' ? colors.outline : colors.text}>{h.startsAt ? time(h.startsAt) : '—'}</Txt>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt style={{ fontWeight: '800' }} color={state === 'DONE' ? colors.outline : colors.text}>{h.name}</Txt>
                  <Txt variant="small" color={colors.outline} numberOfLines={1}>{[h.workout?.name, h.category?.name, t('heatsLanesUsed', { used: (h.lanes ?? []).length, count: h.laneCount ?? (h.lanes ?? []).length })].filter(Boolean).join(' · ')}</Txt>
                </View>
                {state === 'LIVE' ? (
                  <View style={{ paddingVertical: 2, paddingHorizontal: 6, borderRadius: 2, backgroundColor: colors.error }}>
                    <Txt variant="small" style={{ fontWeight: '900', fontSize: 11, letterSpacing: 0.8 }} color={colors.background}>{t('heatsLive')}</Txt>
                  </View>
                ) : state === 'DONE' ? (
                  <Txt variant="small" color={colors.outline}>{t('heatsDone')}</Txt>
                ) : null}
                <Icon name={expanded ? 'expand-less' : 'expand-more'} color={colors.outline} />
              </Pressable>
              {expanded ? (
                <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
                  {lanesWithEmpty(h).map(({ lane, entry }) => {
                    const hit = hits.includes(lane) || !!entry?.mine;
                    return (
                      <View key={lane} testID={`heat-${h.id}-lane-${lane}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.md, backgroundColor: hit ? `${colors.primary}1A` : 'transparent' }}>
                        <View style={{ width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceHigh }}>
                          <Txt style={{ fontWeight: '800', fontVariant: ['tabular-nums'] }}>{String(lane)}</Txt>
                        </View>
                        <Txt style={{ flex: 1, fontWeight: entry?.mine ? '800' : '500' }} color={entry ? colors.text : colors.outline}>
                          {entry ? `${entry.athlete?.fullName || entry.athlete?.username || entry.teamName || '—'}${entry.mine ? ` · ${t('heatsYou')}` : ''}` : t('heatsEmptyLane')}
                        </Txt>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })
      )}
    </>
  );
}

// ───────────── Leaderboard ─────────────

export function CompLeaderboard({ id, categories, workouts }: { id: string; categories: Json[]; workouts: Json[] }) {
  const t = useT();
  const { colors } = useTheme();
  const me = useMe();
  const active = categories.filter((c) => c.active);
  const [categoryId, setCategoryId] = useState<string | undefined>(active[0]?.id);
  const [workoutId, setWorkoutId] = useState<string | undefined>(undefined);
  const [q, setQ] = useState('');
  const board = useCompLeaderboard(id, categoryId, workoutId);
  const data = board.data;
  const division = active.find((c) => c.id === categoryId)?.name ?? '';
  const rows: Json[] = data ? searchBoard(data.rows ?? [], q) : [];
  const mine = data ? myRow(data.rows ?? [], me.data?.id) : null;
  return (
    <View style={{ gap: 10 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {active.map((c) => (
          <Chip key={c.id} testID={`board-cat-${c.id}`} label={c.name} selected={c.id === categoryId} onPress={() => setCategoryId(c.id)} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <Chip testID="board-overall" label={t('boardOverall')} selected={!workoutId} onPress={() => setWorkoutId(undefined)} />
        {workouts.map((w) => (
          <Chip key={w.id} testID={`board-wod-${w.id}`} label={w.name} selected={w.id === workoutId} onPress={() => setWorkoutId(w.id)} />
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <TextField testID="board-search" icon="search" placeholder={t('boardSearch')} value={q} onChangeText={setQ} autoCapitalize="none" />
        </View>
        {mine ? <Button testID="board-find-me" kind="tonal" icon="person-pin" label={t('boardFindMe')} onPress={() => setQ(athleteName(mine))} /> : null}
      </View>
      {board.isError ? (
        <ErrorView error={board.error} onRetry={() => board.refetch()} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <View testID="board-status" style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: 14, backgroundColor: data.provisional ? colors.surfaceHigh : `${colors.primary}22` }}>
            <Icon name={data.provisional ? 'hourglass-top' : 'verified'} size={20} color={data.provisional ? colors.warning : colors.primary} />
            <View style={{ flex: 1 }}>
              <Txt style={{ fontWeight: '800' }}>{data.provisional ? t('boardUnofficial') : t('boardOfficial')}</Txt>
              {data.provisional ? <Txt variant="small" color={colors.outline}>{t('compProvisional')}</Txt> : null}
            </View>
          </View>
          {data.podium && !q.trim() && (
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
          {(data.rows ?? []).length === 0 ? (
            <EmptyState icon="leaderboard" message={t('boardNoScores')} />
          ) : rows.length === 0 ? (
            <EmptyState icon="search-off" message={t('boardNotFound', { name: q.trim(), division })} />
          ) : (
            <ScrollView horizontal>
              <View>
                <View style={{ flexDirection: 'row', paddingVertical: 6 }}>
                  <Txt variant="label" style={{ width: 44 }}>#</Txt>
                  <View style={{ width: 150 }} />
                  <Txt variant="label" style={{ width: 72, textAlign: 'right' }}>{workoutId ? t('boardPoints') : t('compTotal')}</Txt>
                  {!workoutId && data.workouts.map((w: Json) => <Txt key={w.id} variant="label" style={{ width: 64, textAlign: 'right' }}>{`W${w.number}`}</Txt>)}
                </View>
                {rows.map((r: Json) => {
                  const isMe = !!me.data?.id && r.athlete.id === me.data.id;
                  return (
                    <View key={r.athlete.id} testID={`board-row-${r.athlete.id}`} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: isMe ? 6 : 0, borderRadius: isMe ? 10 : 0, borderTopWidth: isMe ? 0 : 1, borderTopColor: colors.surfaceHigh, backgroundColor: isMe ? `${colors.primary}1F` : 'transparent' }}>
                      <Txt style={[displayText(20), { width: 44, color: r.rank <= 3 ? colors.primary : colors.text }]}>{`#${r.rank}`}</Txt>
                      <View style={{ width: 150, gap: 2 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Txt numberOfLines={1} style={{ fontWeight: isMe ? '800' : '600', flexShrink: 1 }}>{athleteName(r)}</Txt>
                          {isMe ? (
                            <View style={{ paddingHorizontal: 6, borderRadius: 999, backgroundColor: colors.primary }}>
                              <Txt variant="small" style={{ fontWeight: '800', fontSize: 11 }} color={colors.onPrimary}>{t('boardYou')}</Txt>
                            </View>
                          ) : null}
                        </View>
                        {r.pending > 0 && <Txt variant="small" color={colors.outline}>{t('compPending')}</Txt>}
                      </View>
                      {/* Total first: it decides the rank and must be visible without scrolling. */}
                      <Txt style={[displayText(20), { width: 72, textAlign: 'right', color: colors.primary }]}>{String((workoutId ? r.wodPoints[workoutId] : r.totalPoints) ?? '—')}</Txt>
                      {!workoutId && data.workouts.map((w: Json) => <Txt key={w.id} style={{ width: 64, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{r.wodPoints[w.id] != null ? String(r.wodPoints[w.id]) : '—'}</Txt>)}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
}

// ───────────── Registration ─────────────

/** Competition → category → coupon → price → confirmation (§12). The server re-checks everything. */
/** Registration lives in `register.tsx` (phase 4 of the organisation update). */
export { RegisterScreen } from './register';

// ───────────── Submission ─────────────

/** Score + YouTube link for one WOD: only the fields its score type needs (§23). The link is required to submit. */
export function SubmitScreen({ id, wodId }: { id: string; wodId: string }) {
  const t = useT();
  const locale = useLocale();
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
      toast(submit ? t('subSentToast', { wod: w.name }) : t('compSaveDraft'));
      if (router.canGoBack()) router.back();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const fmt = workoutFormat(type);
  const closed = !!w.submissionDeadline && Date.parse(w.submissionDeadline) < Date.now();
  const deadline = w.submissionDeadline ? formatDate(w.submissionDeadline, locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Screen>
        <View style={{ gap: 4 }}>
          <Txt style={displayText(28)}>{w.name}</Txt>
          <Txt variant="small" style={{ fontWeight: '700' }} color={colors.outline}>{[t(`evFormat${fmt}`), w.timeCapS ? t('evTimeCap', { min: Math.round(w.timeCapS / 60) }) : null, t('compMaxPoints', { points: w.maximumPoints })].filter(Boolean).join(' · ')}</Txt>
        </View>
        <ReadMoreText text={w.description} />
        {deadline ? (
          <View testID="sub-deadline" style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: 14, backgroundColor: colors.surfaceHigh }}>
            <Icon name={closed ? 'event-busy' : 'event'} size={18} color={closed ? colors.error : colors.primary} />
            <Txt variant="small" style={{ flex: 1 }} color={closed ? colors.error : colors.text}>{closed ? t('subDeadlinePassed', { date: deadline }) : t('subDeadline', { date: deadline })}</Txt>
          </View>
        ) : null}

        <SubSection n={1} title={t('subYourScore')}>
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
              <View style={{ gap: space.sm }}>
                <Choice testID="sub-finished" label={t('subFinishedInCap')} selected={!capped} onPress={() => setCapped(false)} />
                <Choice testID="sub-capped" label={t('subNotFinishedInCap')} selected={capped} onPress={() => setCapped(true)} />
              </View>
              {!capped && <TimeField testID="sub-time" label={t('compScore')} onChange={setTimeS} />}
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
            <TextField testID="sub-value" label={t('compValue')} keyboardType="decimal-pad" value={value} onChangeText={setValue} />
          )}
        </SubSection>

        <SubSection n={2} title={t('subYourVideo')}>
          <Txt variant="small" color={colors.outline}>{t('subVideoHint')}</Txt>
          <TextField testID="sub-video" label={t('compVideoUrl')} placeholder="https://youtu.be/…" value={video} onChangeText={setVideo} autoCapitalize="none" keyboardType="url" error={videoOk ? null : t('compVideoInvalid')} />
          {thumb && (
            <Pressable accessibilityRole="link" accessibilityLabel={t('judgeWatchVideo')} onPress={() => Linking.openURL(video.trim())} style={{ borderRadius: 12, overflow: 'hidden' }}>
              <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surfaceHigh }}>
                <Image source={{ uri: `https://i.ytimg.com/vi/${thumb}/hqdefault.jpg` }} accessibilityIgnoresInvertColors style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, width: '100%', height: '100%' }} />
                <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.background}B3` }}>
                    <Icon name="play-arrow" size={32} color={colors.text} />
                  </View>
                </View>
              </View>
            </Pressable>
          )}
          {!thumb && <Txt variant="small" color={colors.outline}>{t('compVideoRequired')}</Txt>}
        </SubSection>

        <TextField label={t('notes')} value={notes} onChangeText={setNotes} multiline maxLength={2000} />
        <ErrorText error={error} />
      </Screen>
      <View style={{ gap: space.xs, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background }}>
        <Button testID="sub-send" icon="send" label={t('subSendForReview')} busy={busy} disabled={!filled || !thumb} onPress={() => send(true)} />
        <Button kind="text" label={t('compSaveDraft')} disabled={busy || !filled || !videoOk} onPress={() => send(false)} />
      </View>
    </View>
  );
}

/** A numbered part of the score form (« 1 · Your score », « 2 · Your video »). */
function SubSection({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary }}>
          <Txt style={{ fontWeight: '800', fontSize: 13 }} color={colors.onPrimary}>{String(n)}</Txt>
        </View>
        <Txt variant="title">{title}</Txt>
      </View>
      {children}
    </View>
  );
}

/** One of two exclusive answers, as a full-width radio row. */
function Choice({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, paddingHorizontal: space.md, borderRadius: 14, borderWidth: selected ? 2 : 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 })}>
      <Icon name={selected ? 'radio-button-checked' : 'radio-button-unchecked'} color={selected ? colors.primary : colors.outline} />
      <Txt style={{ flex: 1, fontWeight: selected ? '700' : '500' }}>{label}</Txt>
    </Pressable>
  );
}

/** The workout's text folded to five lines. */
function ReadMoreText({ text }: { text: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const long = (text ?? '').length > 220 || (text ?? '').split('\n').length > 5;
  return (
    <View style={{ gap: 2 }}>
      <Txt numberOfLines={open || !long ? undefined : 5}>{text}</Txt>
      {long ? <Button kind="text" label={open ? t('evReadLess') : t('evReadMore')} onPress={() => setOpen(!open)} style={{ alignSelf: 'flex-start' }} /> : null}
    </View>
  );
}
