import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import type { Json } from '../../core/api/client';
import { useLocale, useT } from '../../core/prefs';
import { useApi } from '../../core/services';
import { useTheme } from '../../core/theme';
import { formatDate } from '../../core/utils/format';
import { EmptyState, Loading } from '../../core/widgets/common';
import { ErrorView } from '../../core/widgets/error';
import { CountBadge, Icon, IconButton, Txt, useHeader } from '../../core/widgets/kit';
import { notificationIcon, notificationRoute, notificationsApi, notificationText, unreadKey, useUnreadCount } from './api';

/** Bell with the unread count; opens the notifications list. */
export function NotificationBell() {
  const t = useT();
  const count = useUnreadCount().data ?? 0;
  return (
    <Pressable testID="notification-bell" accessibilityRole="button" accessibilityLabel={t('notifications')} onPress={() => router.push('/notifications')} hitSlop={8} style={{ padding: 8 }}>
      <Icon name="notifications-none" />
      <CountBadge count={count} />
    </Pressable>
  );
}

/** In-app notifications: unread first highlighted, tap opens the related screen. */
export function NotificationsScreen() {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const page = useQuery({ queryKey: ['notifications', 'list'], queryFn: () => notificationsApi(api).list(), staleTime: 0 });

  const reload = () => Promise.all([qc.invalidateQueries({ queryKey: unreadKey }), page.refetch()]);

  async function open(n: Json) {
    if (n.read !== true) await notificationsApi(api).markRead([n.id]).catch(() => {});
    const route = notificationRoute(n);
    void reload();
    if (route) router.push(route as never);
  }

  useHeader({
    title: t('notifications'),
    headerRight: () => (
      <IconButton
        icon="done-all"
        label={t('markAllRead')}
        onPress={async () => {
          await notificationsApi(api).markRead().catch(() => {});
          void reload();
        }}
      />
    ),
  });

  if (page.isError) return <ErrorView error={page.error} onRetry={reload} />;
  if (!page.data) return <Loading />;
  const rows: Json[] = page.data.data ?? [];
  if (rows.length === 0) return <EmptyState icon="notifications-off" message={t('noNotifications')} />;
  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      data={rows}
      keyExtractor={(n) => n.id}
      refreshControl={<RefreshControl refreshing={false} onRefresh={reload} tintColor={colors.primary} />}
      ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.surfaceHigh, marginStart: 72 }} />}
      renderItem={({ item: n }) => {
        const unread = n.read !== true;
        const tint = unread ? colors.primary : colors.outline;
        return (
          <Pressable testID={`notification-${n.id}`} accessibilityRole="button" onPress={() => open(n)} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: tint + '29', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={notificationIcon(n.type)} color={tint} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt style={{ fontWeight: unread ? '700' : '400' }}>{notificationText(t, locale, n)}</Txt>
              <Txt variant="small" color={colors.outline}>{formatDate(n.createdAt, locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Txt>
            </View>
            {unread && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} />}
          </Pressable>
        );
      }}
    />
  );
}
