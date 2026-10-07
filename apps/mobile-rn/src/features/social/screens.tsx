import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Json } from '../../core/api/client';
import { useLocale, useT } from '../../core/prefs';
import { useApi } from '../../core/services';
import { displayText, useTheme } from '../../core/theme';
import { localized } from '../../core/utils/format';
import { AvatarBadge, EmptyState, Loading, SectionHeader, SkeletonList, StatCard } from '../../core/widgets/common';
import { ErrorView, errorMessage } from '../../core/widgets/error';
import { Button, Card, Chip, Dialog, IconButton, ListGroup, ListRow, Menu, Segmented, TextField, Txt, toast, useHeader } from '../../core/widgets/kit';
import { useMe } from '../me/api';
import { ReportSheet, type ReportTarget } from '../moderation/report-sheet';
import { socialApi, socialKeys, useFriendRequests, useFriends, usePublicProfile } from './api';

/** Athlete summary row (id, username, fullName, governorate, level). */
export function AthleteTile({ athlete, trailing }: { athlete: Json; trailing?: React.ReactNode }) {
  const t = useT();
  const name: string = athlete.fullName ?? athlete.username;
  return (
    <ListRow
      testID={`athlete-${athlete.username}`}
      leading={<AvatarBadge name={name} size={42} />}
      title={name}
      subtitle={`@${athlete.username} · ${t('gymLevel')} ${athlete.level ?? 1}`}
      trailing={trailing}
      onPress={() => router.push(`/u/${athlete.username}`)}
    />
  );
}

/** Friends and friend requests (received / sent). */
export function FriendsScreen() {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'friends' | 'requests'>('friends');
  const friends = useFriends();
  const incoming = useFriendRequests('in');
  const outgoing = useFriendRequests('out');
  const repo = socialApi(api);
  useHeader({ headerRight: () => <IconButton icon="person-search" label={t('findAthletes')} onPress={() => router.push('/search')} /> });

  async function act(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (e) {
      toast(errorMessage(t, e));
    }
    await qc.invalidateQueries({ queryKey: socialKeys.friends });
  }

  let body;
  if (tab === 'friends') {
    body = friends.isError ? (
      <ErrorView error={friends.error} onRetry={() => friends.refetch()} />
    ) : !friends.data ? (
      <Loading />
    ) : friends.data.length === 0 ? (
      <EmptyState icon="group-add" message={t('noFriendsYet')} actionLabel={t('findAthletes')} onAction={() => router.push('/search')} />
    ) : (
      friends.data.map((f) => (
        <AthleteTile
          key={f.id}
          athlete={f}
          trailing={
            <Menu
              label={t('friends')}
              items={[
                { label: t('challenge'), onPress: () => router.push(`/battles/new?opponent=${f.id}`) },
                { label: t('unfriend'), onPress: () => act(() => repo.unfriend(f.id)) },
              ]}
            />
          }
        />
      ))
    );
  } else if (incoming.isError || outgoing.isError) {
    body = <ErrorView error={incoming.error ?? outgoing.error} onRetry={() => Promise.all([incoming.refetch(), outgoing.refetch()])} />;
  } else if (!incoming.data || !outgoing.data) {
    body = <Loading />;
  } else if (incoming.data.length === 0 && outgoing.data.length === 0) {
    body = <EmptyState icon="inbox" message={t('noRequests')} />;
  } else {
    body = (
      <>
        {incoming.data.length > 0 && <SectionHeader title={t('received')} />}
        {incoming.data.map((a) => (
          <AthleteTile
            key={a.id}
            athlete={a}
            trailing={
              <View style={{ flexDirection: 'row' }}>
                <IconButton icon="check" label={t('accept')} onPress={() => act(() => repo.answer(a.id, true))} />
                <IconButton icon="close" label={t('decline')} onPress={() => act(() => repo.answer(a.id, false))} />
              </View>
            }
          />
        ))}
        {outgoing.data.length > 0 && <SectionHeader title={t('sent')} />}
        {outgoing.data.map((a) => (
          <AthleteTile key={a.id} athlete={a} trailing={<Txt color={colors.outline}>{t('pending')}</Txt>} />
        ))}
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { key: 'friends', label: t('friends') },
            { key: 'requests', label: t('requests') },
          ]}
        />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 24 }}>{body}</ScrollView>
    </View>
  );
}

/** Athlete search (≥ 2 characters, debounced). */
export function SearchScreen() {
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
      .catch((error) => live && setResults({ q, error }));
    return () => {
      live = false;
    };
  }, [q, api]);

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
        <TextField testID="search-input" icon="search" placeholder={t('searchAthletesHint')} value={text} onChangeText={setText} autoFocus autoCapitalize="none" />
      </View>
      {q.length < 2 ? (
        <EmptyState icon="person-search" message={t('searchAthletesHint')} />
      ) : results == null || results.q !== q ? (
        <Loading />
      ) : 'error' in results ? (
        <ErrorView error={results.error} />
      ) : results.rows.length === 0 ? (
        <EmptyState icon="search-off" message={t('noAthleteFound')} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 8 }}>
          {results.rows.map((a) => (
            <AthleteTile key={a.id} athlete={a} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/** Public athlete profile: division, level, season LP, gym; friend / challenge / follow / block. */
export function PublicProfileScreen({ username }: { username: string }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const profile = usePublicProfile(username);
  const myId = useMe().data?.id;
  const [busy, setBusy] = useState(false);
  const [following, setFollowing] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const p = profile.data;
  const isMe = p != null && p.id === myId;
  const repo = socialApi(api);

  async function act(action: () => Promise<unknown>, popAfter = false) {
    setBusy(true);
    try {
      await action();
      await Promise.all([qc.invalidateQueries({ queryKey: socialKeys.profile(username) }), qc.invalidateQueries({ queryKey: socialKeys.friends })]);
      if (popAfter && router.canGoBack()) router.back();
    } catch (e) {
      toast(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  useHeader(
    {
      title: `@${username}`,
      headerRight:
        p && !isMe
          ? () => (
              <Menu
                testID="profile-menu"
                label={t('report')}
                items={[
                  {
                    label: following ? t('unfollow') : t('follow'),
                    onPress: async () => {
                      await act(() => repo.follow(p.id, !following));
                      setFollowing(!following);
                    },
                  },
                  { label: t('block'), onPress: () => setBlocking(true) },
                  { label: t('report'), testID: 'profile-report', onPress: () => setReport({ targetType: 'USER', targetId: p.id }) },
                ]}
              />
            )
          : undefined,
    },
    [p?.id, isMe, following],
  );

  if (profile.isError) return <ErrorView error={profile.error} onRetry={() => profile.refetch()} />;
  if (!p) return <SkeletonList count={3} height={110} />;
  const name: string = p.fullName ?? p.username;
  const division: string | null = p.division ?? null;

  let action = null;
  if (!isMe) {
    switch (p.friendship) {
      case 'FRIENDS':
        action = <Button icon="sports-mma" label={t('challenge')} onPress={() => router.push(`/battles/new?opponent=${p.id}`)} />;
        break;
      case 'REQUEST_SENT':
        action = <Button label={t('requestSent')} disabled />;
        break;
      case 'REQUEST_RECEIVED':
        action = <Button testID="profile-accept" label={t('accept')} disabled={busy} onPress={() => act(() => repo.answer(p.id, true))} />;
        break;
      default:
        action = <Button testID="profile-add-friend" icon="person-add-alt-1" label={t('addFriend')} disabled={busy} onPress={() => act(() => repo.sendRequest(p.id))} />;
    }
  }

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <View style={{ alignItems: 'center', gap: 8 }}>
          <AvatarBadge name={name} division={division} size={96} />
          <Txt style={displayText(30)}>{name}</Txt>
          {division && <Chip icon="shield" label={division} />}
          {p.bio ? <Txt style={{ textAlign: 'center' }}>{p.bio}</Txt> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {(
            [
              [t('gymLevel'), p.level],
              [t('seasonLp'), p.seasonLp],
              [t('followers'), p.followers],
            ] as [string, unknown][]
          ).map(([label, value]) => (
            <View key={label} style={{ flex: 1 }}>
              <StatCard label={label}>
                <Txt style={displayText(28)}>{String(value ?? 0)}</Txt>
              </StatCard>
            </View>
          ))}
        </View>
        {p.gym && (
          <ListGroup>
            <ListRow icon="fitness-center" title={p.gym.name} chevron onPress={() => router.push(`/gyms/${p.gym.id}`)} />
          </ListGroup>
        )}
        {p.governorate && (
          <ListGroup>
            <ListRow icon="place" title={localized(p.governorate.name, locale)} />
          </ListGroup>
        )}
      </ScrollView>
      {action && <View style={{ padding: 16, paddingTop: 8 }}>{action}</View>}
      <Dialog
        visible={blocking}
        title={t('block')}
        message={t('blockConfirm')}
        confirmLabel={t('block')}
        cancelLabel={t('cancel')}
        destructive
        onCancel={() => setBlocking(false)}
        onConfirm={() => {
          setBlocking(false);
          void act(() => repo.block(p.id), true);
        }}
      />
      <ReportSheet target={report} onClose={() => setReport(null)} />
    </SafeAreaView>
  );
}
