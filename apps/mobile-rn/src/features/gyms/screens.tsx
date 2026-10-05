import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, ScrollView, View } from 'react-native';

import type { Json, UploadFile } from '../../core/api/client';
import { useLocale, useT } from '../../core/prefs';
import { useApi } from '../../core/services';
import { displayText, useTheme } from '../../core/theme';
import { formatDate, localized } from '../../core/utils/format';
import { pickImage, type PickResult } from '../../core/utils/pick-image';
import { AvatarBadge, EmptyState, GymLogo, Loading, RankRow, SectionHeader, SkeletonList, SportChip, StatCard } from '../../core/widgets/common';
import { ErrorText, ErrorView, errorMessage } from '../../core/widgets/error';
import { Button, Card, Dialog, Icon, IconButton, ListRow, Menu, Screen, Segmented, TextField, Txt, toast, useHeader } from '../../core/widgets/kit';
import { Select } from '../../core/widgets/pickers';
import { GymWarsSection } from '../gym-wars/screens';
import { GymWodsSection } from '../gym-wods/screens';
import { meKey } from '../me/api';
import { ReportSheet, type ReportTarget } from '../moderation/report-sheet';
import { useCities, useGovernorates, useSports } from '../reference/api';
import { gymKeys, gymsApi, useGym } from './api';

/** Sports worth a filter chip, in display order. */
const FILTER_SPORTS = ['CROSSFIT', 'HYROX', 'BODYBUILDING', 'POWERLIFTING', 'FUNCTIONAL', 'RUNNING'];

/** Gym directory: search, sport and governorate filters, infinite paging (spec §6). */
export function GymsScreen() {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const sports = useSports().data ?? [];
  const govs = useGovernorates().data ?? [];
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [sport, setSport] = useState<string | null>(null);
  const [gov, setGov] = useState<string>('');
  const [items, setItems] = useState<Json[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  useHeader({ headerRight: () => <IconButton icon="add-business" label={t('addMyGym')} onPress={() => router.push('/gyms/new')} /> });

  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(id);
  }, [text]);

  const load = useCallback(
    async (reset: boolean, from: string | null) => {
      if (busy.current && !reset) return;
      const gen = reset ? ++generation.current : generation.current;
      busy.current = true;
      setLoading(true);
      if (reset) {
        setItems([]);
        setError(null);
      }
      try {
        const page = await gymsApi(api).list({ q, sport, governorateId: gov || null, cursor: reset ? null : from });
        if (gen !== generation.current) return; // a newer search replaced this one
        setItems((prev) => (reset ? page.data : [...prev, ...page.data]));
        setCursor(page.page?.nextCursor ?? null);
        setHasMore(page.page?.hasMore === true);
      } catch (e) {
        if (gen === generation.current) setError(e);
      } finally {
        if (gen === generation.current) {
          busy.current = false;
          setLoading(false);
        }
      }
    },
    [api, q, sport, gov],
  );

  useEffect(() => {
    void load(true, null);
  }, [load]);

  let body;
  if (items.length === 0 && error != null) body = <ErrorView error={error} onRetry={() => load(true, null)} />;
  else if (items.length === 0 && (loading || hasMore)) body = <SkeletonList />;
  else if (items.length === 0) body = <EmptyState icon="storefront" message={t('gymsEmpty')} />;
  else
    body = (
      <FlatList
        testID="gyms"
        data={items}
        keyExtractor={(g) => g.id}
        contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 10, paddingBottom: 24 }}
        onEndReachedThreshold={0.5}
        onEndReached={() => hasMore && !loading && load(false, cursor)}
        ListFooterComponent={hasMore ? <Loading /> : null}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => load(true, null)} tintColor={colors.primary} />}
        renderItem={({ item }) => <GymCard gym={item} />}
      />
    );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <TextField testID="gym-search" icon="search" placeholder={t('gymsSearchHint')} value={text} onChangeText={setText} returnKeyType="search" />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
        {FILTER_SPORTS.flatMap((code) => sports.filter((s) => s.code === code)).map((s) => (
          <SportChip key={s.id} testID={`gym-sport-${s.code}`} code={s.code!} name={s.name} selected={sport === s.code} onPress={() => setSport(sport === s.code ? null : s.code!)} />
        ))}
      </ScrollView>
      <View style={{ paddingHorizontal: 16 }}>
        <Select
          testID="gym-governorate"
          label={t('gymsGovernorate')}
          value={gov}
          options={[{ value: '', label: t('gymsAllGovernorates') }, ...govs.map((g) => ({ value: g.id, label: localized(g.name, locale) }))]}
          onChange={setGov}
        />
      </View>
      {body}
    </View>
  );
}

/** Directory card: logo, name + verified badge, city, sports, members. */
export function GymCard({ gym }: { gym: Json }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const sports: Json[] = gym.sports ?? [];
  return (
    <Card testID={`gym-${gym.id}`} onPress={() => router.push(`/gyms/${gym.id}`)} style={{ flexDirection: 'row', gap: 14 }}>
      <GymLogo name={gym.name} url={gym.logoUrl} />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt variant="title" numberOfLines={1} style={{ flexShrink: 1, fontWeight: '800' }}>{gym.name}</Txt>
          {gym.verified === true && <Icon name="verified" size={18} color={colors.primary} />}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name="place" size={14} color={colors.outline} />
          <Txt variant="small" color={colors.outline} numberOfLines={1} style={{ flexShrink: 1 }}>{localized(gym.city, locale)}</Txt>
          <Icon name="groups" size={14} color={colors.outline} />
          <Txt variant="small" color={colors.outline}>{t('gymMembersCount', { count: gym.membersCount ?? 0 })}</Txt>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {sports.slice(0, 3).map((s) => (
            <SportChip key={s.code} code={s.code} name={s.name} />
          ))}
        </View>
      </View>
    </Card>
  );
}

/** Public gym profile: logo, stats, sports, info, WODs, wars, top athletes, membership action (spec §6). */
export function GymProfileScreen({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const gymQuery = useGym(id);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const gym = gymQuery.data;
  const canManage = gym?.canManage === true;
  const repo = gymsApi(api);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await Promise.all([qc.invalidateQueries({ queryKey: gymKeys.detail(id) }), qc.invalidateQueries({ queryKey: meKey })]);
    } catch (e) {
      toast(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  async function pickLogo() {
    const picked = await pickImage(2 * 1024 * 1024);
    if (!picked) return;
    if ('tooLarge' in picked) return toast(t('logoTooLarge'));
    await run(() => repo.uploadLogo(id, picked.file));
  }

  useHeader(
    {
      title: gym?.name ?? '',
      headerRight: gym
        ? () => (
            <View style={{ flexDirection: 'row' }}>
              {canManage && <IconButton icon="photo-camera" label={t('gymChangeLogo')} onPress={() => !busy && pickLogo()} />}
              {!canManage && <Menu label={t('report')} items={[{ label: t('report'), onPress: () => setReport({ targetType: 'GYM', targetId: id }) }]} />}
            </View>
          )
        : undefined,
    },
    [gym?.name, canManage, busy],
  );

  if (gymQuery.isError) return <ErrorView error={gymQuery.error} onRetry={() => gymQuery.refetch()} />;
  if (!gym) return <SkeletonList count={4} height={120} />;
  const membership: Json = gym.myMembership ?? { status: 'NONE' };
  const status: string = membership.status ?? 'NONE';
  const sports: Json[] = gym.sports ?? [];
  const links: Json = gym.socialLinks ?? {};
  const top: Json[] = gym.topAthletes ?? [];

  const action =
    status === 'APPROVED' ? (
      <Button testID="gym-leave" kind="outlined" label={t('gymLeave')} disabled={busy} onPress={() => setLeaving(true)} />
    ) : status === 'PENDING' ? (
      <Button label={t('gymRequestSent')} disabled />
    ) : (
      <Button testID="gym-join" label={t('gymJoin')} busy={busy} onPress={() => run(() => repo.join(id))} />
    );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => gymQuery.refetch()} tintColor={colors.primary} />}>
        <View style={{ alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 24, backgroundColor: colors.primary + '22' }}>
          <GymLogo name={gym.name} url={gym.logoUrl} size={96} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Txt style={displayText(32)}>{gym.name}</Txt>
            {gym.verified === true && <Icon name="verified" color={colors.primary} />}
          </View>
          <Txt color={colors.outline}>{localized(gym.city, locale)}</Txt>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {(
            [
              [t('gymMembersLabel'), String(gym.membersCount ?? 0)],
              [t('gymLevel'), String(gym.level ?? 1)],
              [t('gymRank'), gym.rank == null ? '—' : `#${gym.rank}`],
            ] as [string, string][]
          ).map(([label, value]) => (
            <View key={label} style={{ flex: 1 }}>
              <StatCard label={label}>
                <Txt style={displayText(30)}>{value}</Txt>
              </StatCard>
            </View>
          ))}
        </View>
        {sports.length > 0 && (
          <>
            <SectionHeader title={t('gymSports')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {sports.map((s) => (
                <SportChip key={s.code} code={s.code} name={s.name} />
              ))}
            </View>
          </>
        )}
        {(gym.addressLine || Object.keys(links).length > 0) && (
          <>
            <SectionHeader title={t('gymInfo')} />
            <Card style={{ paddingVertical: 4 }}>
              {gym.addressLine ? <ListRow icon="place" title={gym.addressLine} /> : null}
              {Object.entries(links).map(([k, v]) => (
                <ListRow
                  key={k}
                  icon="link"
                  title={k[0].toUpperCase() + k.slice(1)}
                  subtitle={String(v)}
                  onPress={async () => {
                    await Clipboard.setStringAsync(String(v));
                    toast(t('linkCopied'));
                  }}
                />
              ))}
            </Card>
          </>
        )}
        <GymWodsSection gymId={id} isMember={status === 'APPROVED'} isCoach={membership.role === 'COACH' || canManage} />
        <GymWarsSection gymId={id} canManage={canManage} />
        {top.length > 0 && (
          <>
            <SectionHeader title={t('gymTopAthletes')} />
            {top.map((a, i) => {
              const name: string = a.fullName ?? a.username;
              return <RankRow key={a.username} rank={i + 1} name={name} value={`${a.lp} LP`} leading={<AvatarBadge name={name} size={40} />} onPress={() => router.push(`/u/${a.username}`)} />;
            })}
          </>
        )}
        {canManage && (
          <>
            <Button kind="outlined" icon="group" label={t('gymManageMembers')} onPress={() => router.push(`/gyms/${id}/members`)} style={{ marginTop: 8 }} />
            <Button kind="outlined" icon="insights" label={t('gymDashboard')} onPress={() => router.push(`/gyms/${id}/dashboard`)} />
          </>
        )}
      </ScrollView>
      <View style={{ padding: 16, paddingTop: 8 }}>{action}</View>
      <Dialog
        visible={leaving}
        title={t('gymLeave')}
        message={t('gymLeaveConfirm')}
        confirmLabel={t('gymLeave')}
        cancelLabel={t('cancel')}
        onCancel={() => setLeaving(false)}
        onConfirm={() => {
          setLeaving(false);
          void run(() => repo.leave());
        }}
      />
      <ReportSheet target={report} onClose={() => setReport(null)} />
    </View>
  );
}

const PHONE = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Gym owner: submit a gym for verification (details, sports, proof, photo). A platform admin approves it. */
export function CreateGymScreen({ pick = () => pickImage(2 * 1024 * 1024) }: { pick?: () => Promise<PickResult> }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const govs = useGovernorates().data ?? [];
  const sports = useSports().data ?? [];
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [instagram, setInstagram] = useState('');
  const [proof, setProof] = useState('');
  const [governorateId, setGovernorateId] = useState<string | null>(null);
  const [cityId, setCityId] = useState<string | null>(null);
  const cities = useCities(governorateId).data ?? [];
  const [sportIds, setSportIds] = useState<string[]>([]);
  const [photo, setPhoto] = useState<UploadFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const valid =
    name.trim().length >= 3 &&
    name.trim().length <= 80 &&
    governorateId != null &&
    cityId != null &&
    proof.trim().length >= 10 &&
    (!phone.trim() || PHONE.test(phone.trim())) &&
    (!email.trim() || EMAIL.test(email.trim())) &&
    (!instagram.trim() || instagram.trim().startsWith('https://'));

  async function pickPhoto() {
    const picked = await pick();
    if (!picked) return;
    if ('tooLarge' in picked) return toast(t('logoTooLarge'));
    setPhoto(picked.file);
  }

  /** The gym exists once created: a photo failure never re-submits it, only the photo is retried. */
  async function uploadPhoto(id: string) {
    if (!photo) return;
    try {
      await gymsApi(api).uploadLogo(id, photo);
      await qc.invalidateQueries({ queryKey: gymKeys.mine });
      setPhotoFailed(false);
    } catch {
      setPhotoFailed(true);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const opt = (s: string) => s.trim();
    try {
      const created = await gymsApi(api).create({
        name: opt(name),
        governorateId,
        cityId,
        ...(opt(address) ? { addressLine: opt(address) } : {}),
        ...(opt(phone) ? { contactPhone: opt(phone) } : {}),
        ...(opt(email) ? { contactEmail: opt(email) } : {}),
        ...(opt(instagram) ? { socialLinks: { instagram: opt(instagram) } } : {}),
        ...(sportIds.length ? { sportIds } : {}),
        proofOfOwnership: opt(proof),
      });
      setCreatedId(created.id);
      await qc.invalidateQueries({ queryKey: gymKeys.mine });
      await uploadPhoto(created.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (createdId) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16, backgroundColor: colors.background }}>
        <Icon name="hourglass-top" size={64} color={colors.primary} />
        <Txt variant="title" style={{ textAlign: 'center', fontWeight: '500' }}>{t('gymSubmitted')}</Txt>
        {photoFailed && (
          <>
            <Txt color={colors.error} style={{ textAlign: 'center' }}>{t('gymPhotoFailed')}</Txt>
            <Button testID="gym-photo-retry" kind="outlined" icon="refresh" label={t('retryPhoto')} onPress={() => uploadPhoto(createdId)} />
          </>
        )}
      </View>
    );
  }

  return (
    <Screen>
      <Txt color={colors.outline}>{t('addMyGymIntro')}</Txt>
      <Pressable
        testID="gym-photo"
        accessibilityRole="button"
        accessibilityLabel={t('gymPhoto')}
        disabled={busy}
        onPress={pickPhoto}
        style={{ alignSelf: 'center', width: 112, height: 112, borderRadius: 28, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
      >
        {photo ? (
          <Image source={{ uri: photo.uri }} style={{ width: 112, height: 112 }} />
        ) : (
          <>
            <Icon name="add-a-photo" size={32} />
            <Txt variant="small">{t('gymPhoto')}</Txt>
          </>
        )}
      </Pressable>
      <SectionHeader title={t('gymDetails')} />
      <TextField testID="gym-name" label={t('gymName')} value={name} onChangeText={setName} maxLength={80} />
      <Select
        testID="gym-governorate"
        label={t('gymsGovernorate')}
        value={governorateId}
        options={govs.map((g) => ({ value: g.id, label: localized(g.name, locale) }))}
        onChange={(v) => {
          setGovernorateId(v);
          setCityId(null);
        }}
      />
      <Select testID="gym-city" label={t('city')} value={cityId} options={cities.map((c) => ({ value: c.id, label: localized(c.name, locale) }))} onChange={setCityId} />
      <TextField label={t('gymAddress')} value={address} onChangeText={setAddress} maxLength={200} />
      <SectionHeader title={t('gymSports')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {sports.map((s) => (
          <SportChip key={s.id} code={s.code!} name={s.name} selected={sportIds.includes(s.id)} onPress={() => setSportIds((ids) => (ids.includes(s.id) ? ids.filter((x) => x !== s.id) : [...ids, s.id]))} />
        ))}
      </View>
      <SectionHeader title={t('gymContact')} />
      <TextField label={t('gymPhone')} placeholder="+216…" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <TextField label={t('email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <TextField label="Instagram" placeholder="https://instagram.com/…" value={instagram} onChangeText={setInstagram} keyboardType="url" autoCapitalize="none" />
      <SectionHeader title={t('gymProof')} />
      <TextField testID="gym-proof" label={t('gymProofHint')} value={proof} onChangeText={setProof} maxLength={1000} multiline />
      <ErrorText error={error} />
      <Button testID="gym-submit" label={t('gymSubmit')} busy={busy} disabled={!valid} onPress={submit} style={{ marginTop: 8 }} />
    </Screen>
  );
}

/** Gym admin: membership requests to approve, members to promote to coach or remove. */
export function GymMembersScreen({ id }: { id: string }) {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const repo = gymsApi(api);
  const [tab, setTab] = useState<'requests' | 'members'>('requests');
  const [removing, setRemoving] = useState<Json | null>(null);
  const requests = useQuery({ queryKey: gymKeys.requests(id), queryFn: () => repo.requests(id) });
  const members = useQuery({ queryKey: gymKeys.members(id), queryFn: () => repo.members(id) });

  async function act(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (e) {
      toast(errorMessage(t, e));
    }
    await qc.invalidateQueries({ queryKey: ['gyms', id] });
  }

  const nameOf = (m: Json): string => m.fullName ?? m.username;
  let body;
  if (tab === 'requests') {
    body = requests.isError ? (
      <ErrorView error={requests.error} onRetry={() => requests.refetch()} />
    ) : !requests.data ? (
      <Loading />
    ) : requests.data.length === 0 ? (
      <EmptyState icon="inbox" message={t('noRequests')} />
    ) : (
      requests.data.map((r) => (
        <ListRow
          key={r.userId}
          leading={<AvatarBadge name={nameOf(r)} size={40} />}
          title={nameOf(r)}
          subtitle={`@${r.username}`}
          trailing={
            <View style={{ flexDirection: 'row' }}>
              <IconButton icon="check" label={t('approve')} onPress={() => act(() => repo.decide(id, r.userId, 'approve'))} />
              <IconButton icon="close" label={t('reject')} onPress={() => act(() => repo.decide(id, r.userId, 'reject'))} />
            </View>
          }
        />
      ))
    );
  } else {
    body = members.isError ? (
      <ErrorView error={members.error} onRetry={() => members.refetch()} />
    ) : !members.data ? (
      <Loading />
    ) : (
      ((members.data.data as Json[]) ?? []).map((m) => (
        <ListRow
          key={m.id}
          leading={<AvatarBadge name={nameOf(m)} size={40} />}
          title={nameOf(m)}
          subtitle={m.role === 'COACH' ? t('coach') : `@${m.username}`}
          trailing={
            <Menu
              label={t('memberActions')}
              items={[
                m.role === 'COACH'
                  ? { label: t('removeCoach'), onPress: () => act(() => repo.setCoach(id, m.id, false)) }
                  : { label: t('makeCoach'), onPress: () => act(() => repo.setCoach(id, m.id, true)) },
                { label: t('removeMember'), onPress: () => setRemoving(m) },
              ]}
            />
          }
        />
      ))
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { key: 'requests', label: t('requestsTab') },
            { key: 'members', label: t('membersTab') },
          ]}
        />
      </View>
      <ScrollView contentContainerStyle={{ padding: 8 }}>{body}</ScrollView>
      <Dialog
        visible={removing != null}
        title={t('removeMember')}
        message={removing ? t('removeMemberConfirm', { name: nameOf(removing) }) : ''}
        confirmLabel={t('removeMember')}
        cancelLabel={t('cancel')}
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const m = removing!;
          setRemoving(null);
          void act(() => repo.decide(id, m.id, 'remove'));
        }}
      />
    </View>
  );
}

/** Gym admin dashboard (docs §4.5 P3): members, activity, weekly trend, progress, who needs a nudge, WODs, wars. */
export function GymDashboardScreen({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const dashboard = useQuery({ queryKey: ['gyms', id, 'dashboard'], queryFn: () => api.get<Json>(`/gyms/${id}/dashboard`) });
  if (dashboard.isError) return <ErrorView error={dashboard.error} onRetry={() => dashboard.refetch()} />;
  if (!dashboard.data) return <SkeletonList count={4} height={100} />;
  const d = dashboard.data;
  const m: Json = d.members ?? {};
  const trend: Json[] = d.trend ?? [];
  const top: Json[] = d.topProgress ?? [];
  const nudge: Json[] = d.toNudge ?? [];
  const wods: Json[] = d.wods ?? [];
  const wars: Json = d.wars ?? {};
  const maxActive = trend.reduce((a, w) => Math.max(a, Number(w.activeMembers ?? 0)), 1);
  const stat = (label: string, value: unknown) => (
    <View style={{ flex: 1 }}>
      <StatCard label={label}>
        <Txt style={displayText(28)}>{String(value ?? 0)}</Txt>
      </StatCard>
    </View>
  );
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, gap: 8 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => dashboard.refetch()} tintColor={colors.primary} />}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {stat(t('gymMembersLabel'), m.approved)}
        {stat(t('dashboardPending'), m.pending)}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {stat(t('dashboardActive7'), m.activeLast7Days)}
        {stat(t('dashboardActive28'), m.activeLast28Days)}
      </View>
      <SectionHeader title={t('dashboardTrend')} />
      <View style={{ height: 120, flexDirection: 'row', alignItems: 'flex-end' }}>
        {trend.map((w) => (
          <View key={w.weekStart} accessible accessibilityLabel={`${w.weekStart} · ${w.activeMembers} · ${w.meanScore ?? '—'}`} style={{ flex: 1, alignItems: 'center', paddingHorizontal: 3 }}>
            <Txt variant="small" style={{ fontSize: 11 }}>{String(w.activeMembers)}</Txt>
            <View style={{ alignSelf: 'stretch', height: (80 * Number(w.activeMembers)) / maxActive + 2, backgroundColor: colors.primary, borderRadius: 4, marginTop: 2 }} />
          </View>
        ))}
      </View>
      {top.length > 0 && (
        <>
          <SectionHeader title={t('dashboardTopProgress')} />
          {top.map((p, i) => (
            <RankRow key={i} rank={i + 1} name={p.name ?? ''} value={Number(p.progress).toFixed(0)} />
          ))}
        </>
      )}
      <SectionHeader title={t('dashboardToNudge')} />
      {nudge.length === 0 && <Txt>{t('dashboardNobodyToNudge')}</Txt>}
      {nudge.map((n, i) => (
        <ListRow key={i} icon="notifications-paused" title={n.name ?? ''} subtitle={n.lastWorkoutAt == null ? t('dashboardNeverTrained') : formatDate(n.lastWorkoutAt, locale)} />
      ))}
      {wods.length > 0 && (
        <>
          <SectionHeader title={t('gymWods')} />
          {wods.map((w, i) => (
            <ListRow key={i} title={w.title} trailing={<Txt>{t('dashboardScores', { count: w.scores ?? 0 })}</Txt>} />
          ))}
        </>
      )}
      <SectionHeader title={t('gymWars')} />
      <Txt variant="title">{t('gymWarRecord', { wins: wars.wins ?? 0, losses: wars.losses ?? 0, draws: wars.draws ?? 0 })}</Txt>
    </ScrollView>
  );
}
