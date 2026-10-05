import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { useLocale, useT } from '../../core/prefs';
import { useApi } from '../../core/services';
import { displayText, useTheme } from '../../core/theme';
import { formatNumber, localized } from '../../core/utils/format';
import { AvatarBadge, EmptyState, GymLogo, Loading, MovementBadge } from '../../core/widgets/common';
import { ErrorView } from '../../core/widgets/error';
import { Card, Icon, Segmented, Txt } from '../../core/widgets/kit';
import { LeaguesTab } from '../leagues/screens';
import { useMe } from '../me/api';
import { leagueApi, type LeagueRow, type LeagueScope, type ScopeTarget } from './api';

type Tab = LeagueScope | 'leagues';

export function LeagueScreen() {
  const t = useT();
  const { colors } = useTheme();
  const me = useMe().data;
  const governorateId = me?.profile?.governorate?.id ?? null;
  const gym = me?.profile?.gym ?? null;
  const [scope, setScope] = useState<Tab>('national');
  // Tabs keep their list (and scroll position) once visited, like Flutter's keep-alive TabBarView.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set(['national']));

  const select = (s: Tab) => {
    setScope(s);
    setVisited((v) => new Set(v).add(s));
  };

  const content = (s: Tab) => {
    switch (s) {
      case 'leagues':
        return <LeaguesTab />;
      case 'region':
        return governorateId ? <LeaderboardList scope="region" target={{ governorateId }} myId={me?.id} /> : null;
      case 'gym':
        return gym ? (
          <View style={{ flex: 1 }}>
            <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <GymLogo name={gym.name} size={44} />
                <Txt variant="title" style={{ flex: 1, fontWeight: '800' }}>{gym.name}</Txt>
              </Card>
            </View>
            <LeaderboardList scope="gym" target={{ gymId: gym.id }} myId={me?.id} />
          </View>
        ) : (
          <EmptyState icon="fitness-center" message={t('noGym')} />
        );
      default:
        return <LeaderboardList scope={s} myId={me?.id} />;
    }
  };

  const scopes: Tab[] = ['national', 'region', 'gym', 'friends', 'leagues'];
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View>
        <Segmented
          value={scope}
          onChange={select}
          options={[
            { key: 'national', label: t('leagueGlobal') },
            { key: 'region', label: t('leagueRegion') },
            { key: 'gym', label: t('leagueGym') },
            { key: 'friends', label: t('leagueFriends') },
            { key: 'leagues', label: t('leaguesTab') },
          ]}
        />
      </View>
      {scopes.map((s) =>
        visited.has(s) ? (
          <View key={s} style={{ flex: 1, display: s === scope ? 'flex' : 'none' }}>
            {content(s)}
          </View>
        ) : null,
      )}
    </View>
  );
}

export function LeaderboardList({ scope, target = {}, myId }: { scope: LeagueScope; target?: ScopeTarget; myId?: string }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const [rows, setRows] = useState<LeagueRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const busy = useRef(false);
  const { governorateId, gymId } = target;

  const load = useCallback(
    async ({ reset = false, aroundMe = false, from = null as string | null } = {}) => {
      if (busy.current) return;
      busy.current = true;
      setLoading(true);
      setError(null);
      const repo = leagueApi(api);
      const tgt = { governorateId, gymId };
      try {
        const page = aroundMe ? await repo.aroundMe(scope, tgt) : await repo.page(scope, tgt, reset ? null : from);
        setRows((prev) => (reset || aroundMe ? page.data : [...prev, ...page.data]));
        setCursor(page.page.nextCursor);
        setHasMore(page.page.hasMore);
      } catch (e) {
        setError(e);
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    [api, scope, governorateId, gymId],
  );

  useEffect(() => {
    void load({ reset: true });
  }, [load]);

  if (error != null && rows.length === 0) return <ErrorView error={error} onRetry={() => load({ reset: true })} />;
  if (rows.length === 0 && loading) return <Loading />;
  if (rows.length === 0) return <EmptyState icon="emoji-events" message={scope === 'friends' ? t('emptyFriends') : t('emptyLeague')} />;

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        testID="leaderboard"
        data={rows}
        keyExtractor={(r) => r.athlete.id}
        contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 88, gap: 8 }}
        onEndReachedThreshold={0.5}
        onEndReached={() => hasMore && !loading && load({ from: cursor })}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => load({ reset: true })} tintColor={colors.primary} />}
        renderItem={({ item: r }) => {
          const mine = r.athlete.id === myId;
          const medal = r.rank === 1 ? '#FFD166' : r.rank === 2 ? '#C0C4CC' : r.rank === 3 ? '#E09F6B' : colors.text;
          const subtitle = [r.gym?.name, localized(r.governorate?.name, locale), t('level', { level: r.level })].filter(Boolean).join(' · ');
          return (
            <View
              testID={`rank-${r.athlete.id}`}
              accessible
              accessibilityLabel={`#${r.rank}, ${r.athlete.fullName}, ${r.lp} LP`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                padding: 12,
                borderRadius: 20,
                backgroundColor: mine ? colors.primary + '24' : colors.surface,
                borderWidth: r.rank <= 3 ? 1 : 0,
                borderColor: medal + '99',
              }}
            >
              <Txt style={[displayText(22), { width: 44, color: medal }]}>#{r.rank}</Txt>
              <AvatarBadge name={r.athlete.fullName} division={r.division} size={40} />
              <View style={{ flex: 1 }}>
                <Txt numberOfLines={1} style={{ fontSize: 16, fontWeight: '600' }}>{r.athlete.fullName}</Txt>
                <Txt variant="small" color={colors.outline} numberOfLines={1}>{subtitle}</Txt>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Txt style={displayText(20)}>{`${formatNumber(r.lp, locale)} LP`}</Txt>
                {r.movement != null && <MovementBadge movement={r.movement} />}
              </View>
            </View>
          );
        }}
      />
      {myId && (
        <Pressable
          testID={`jump-${scope}`}
          accessibilityRole="button"
          accessibilityLabel={t('jumpToMe')}
          onPress={() => load({ aroundMe: true })}
          style={{ position: 'absolute', end: 16, bottom: 16, width: 48, height: 48, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 4 }}
        >
          <Icon name="my-location" color={colors.onPrimary} />
        </Pressable>
      )}
    </View>
  );
}
