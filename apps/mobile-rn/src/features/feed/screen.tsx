import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Json } from '../../core/api/client';
import { useLocale, useT, type T } from '../../core/prefs';
import { useApi } from '../../core/services';
import { useTheme } from '../../core/theme';
import { formatDate, formatNumber, localized } from '../../core/utils/format';
import { AvatarBadge, EmptyState, Loading } from '../../core/widgets/common';
import { ErrorView, errorMessage } from '../../core/widgets/error';
import { Card, Chip, Icon, IconButton, ListRow, Menu, TextField, Txt, toast } from '../../core/widgets/kit';
import { ReportSheet, type ReportTarget } from '../moderation/report-sheet';
import { feedApi, useComments } from './api';

const REACTIONS: [string, string][] = [
  ['LIKE', '👍'],
  ['FIRE', '🔥'],
  ['STRONG', '💪'],
];

/** One line describing the activity, in the reader's language. */
export function activityText(t: T, locale: string, item: Json): string {
  const d: Json = item.details ?? {};
  const opponent: Json | undefined = d.opponent;
  switch (item.type) {
    case 'WORKOUT':
      return t('feedWorkout', { sport: localized(d.sport?.name, locale), minutes: Math.round(Number(d.durationS ?? 0) / 60) });
    case 'PR':
      return t('feedPr', { exercise: localized(d.exercise, locale), value: typeof d.value === 'number' ? formatNumber(d.value, locale) : String(d.value ?? '') });
    case 'BADGE':
      return t('feedBadge', { badge: localized(d.badgeName, locale) });
    case 'LEVEL_UP':
      return t('feedLevelUp', { level: String(d.to ?? '') });
    case 'BATTLE_WIN':
      return t('feedBattleWin', { name: opponent?.fullName ?? opponent?.username ?? '' });
    case 'GYM_WAR_WIN':
      return t('feedGymWarWin', { gym: d.gymName ?? '' });
    case 'GOAL_COMPLETED':
      return t('feedGoalCompleted');
    default:
      return '';
  }
}

/** Friends' activity with reactions and comments (docs §3.9). Loads more at the end of the list. */
export function FeedScreen() {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const [items, setItems] = useState<Json[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const busy = useRef(false);

  const load = useCallback(
    async (reset = false, from: string | null = null) => {
      if (busy.current) return;
      busy.current = true;
      setLoading(true);
      setError(null);
      try {
        const page = await feedApi(api).feed(reset ? null : from);
        setItems((prev) => (reset ? page.data : [...prev, ...page.data]));
        setCursor(page.page?.nextCursor ?? null);
        setHasMore(page.page?.hasMore === true);
      } catch (e) {
        setError(e);
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  async function react(index: number, type: string) {
    const item = items[index];
    const repo = feedApi(api);
    try {
      const r = item.myReaction === type ? await repo.unreact(item.id) : await repo.react(item.id, type);
      setItems((list) => list.map((it, i) => (i === index ? { ...it, reactions: r.reactions, myReaction: r.myReaction } : it)));
    } catch (e) {
      toast(errorMessage(t, e));
    }
  }

  let body;
  if (error != null && items.length === 0) body = <ErrorView error={error} onRetry={() => load(true)} />;
  else if (items.length === 0 && loading) body = <Loading />;
  else if (items.length === 0) body = <EmptyState icon="dynamic-feed" message={t('feedEmpty')} actionLabel={t('findAthletes')} onAction={() => router.push('/search')} />;
  else
    body = (
      <FlatList
        testID="feed"
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 24, gap: 10 }}
        onEndReachedThreshold={0.5}
        onEndReached={() => hasMore && !loading && load(false, cursor)}
        ListFooterComponent={hasMore ? <Loading /> : null}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => load(true)} tintColor={colors.primary} />}
        renderItem={({ item, index }) => (
          <FeedCard item={item} onReact={(type) => react(index, type)} onComments={() => setCommentsFor(item.id)} onReport={() => setReport({ targetType: 'USER', targetId: item.user?.id })} />
        )}
      />
    );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {body}
      {commentsFor && (
        <CommentsSheet
          activityId={commentsFor}
          onClose={(count) => {
            // Refresh the count from the thread the sheet left behind.
            if (count != null) setItems((list) => list.map((it) => (it.id === commentsFor ? { ...it, comments: count } : it)));
            setCommentsFor(null);
          }}
        />
      )}
      <ReportSheet target={report} onClose={() => setReport(null)} />
    </View>
  );
}

export function FeedCard({ item, onReact, onComments, onReport }: { item: Json; onReact: (type: string) => void; onComments: () => void; onReport: () => void }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const user: Json = item.user ?? {};
  const name: string = user.fullName ?? user.username ?? '';
  const counts: Json = item.reactions ?? {};
  return (
    <Card testID={`activity-${item.id}`} style={{ gap: 10, paddingBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <AvatarBadge name={name} size={40} />
        <Pressable style={{ flex: 1 }} disabled={!user.username || item.isMine === true} onPress={() => router.push(`/u/${user.username}`)}>
          <Txt variant="title" style={{ fontSize: 15 }}>{name}</Txt>
          <Txt variant="small" color={colors.outline}>{formatDate(item.createdAt, locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Txt>
        </Pressable>
        {item.isMine !== true && <Menu label={t('report')} items={[{ label: t('report'), onPress: onReport }]} />}
      </View>
      <Txt style={{ fontSize: 16 }}>{activityText(t, locale, item)}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {REACTIONS.map(([type, emoji]) => (
          <Chip key={type} testID={`react-${item.id}-${type}`} label={`${emoji} ${counts[type] ?? 0}`} selected={item.myReaction === type} onPress={() => onReact(type)} />
        ))}
        <View style={{ flex: 1 }} />
        <Pressable testID={`comments-${item.id}`} accessibilityRole="button" onPress={onComments} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8 }}>
          <Icon name="chat-bubble-outline" size={18} color={colors.primary} />
          <Txt color={colors.primary}>{String(item.comments ?? 0)}</Txt>
        </Pressable>
      </View>
    </Card>
  );
}

function CommentsSheet({ activityId, onClose }: { activityId: string; onClose: (count: number | null) => void }) {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const thread = useComments(activityId);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const rows: Json[] = thread.data?.data ?? [];
  const nameOf = (c: Json): string => c.user?.fullName ?? c.user?.username ?? '';
  const refresh = () => qc.invalidateQueries({ queryKey: ['comments', activityId] });

  async function send() {
    setBusy(true);
    try {
      await feedApi(api).comment(activityId, text.trim());
      setText('');
      await refresh();
    } catch (e) {
      toast(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  const close = () => onClose(thread.data ? rows.length : null);
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 8 }}>
            <IconButton icon="close" label={t('cancel')} onPress={close} />
          </View>
          <View style={{ flex: 1 }}>
            {thread.isError ? (
              <ErrorView error={thread.error} onRetry={refresh} />
            ) : !thread.data ? (
              <Loading />
            ) : rows.length === 0 ? (
              <Txt style={{ textAlign: 'center', marginTop: 32 }}>{t('noComments')}</Txt>
            ) : (
              <ScrollView contentContainerStyle={{ paddingHorizontal: 8 }}>
                {rows.map((c) => (
                  <ListRow
                    key={c.id}
                    leading={<AvatarBadge name={nameOf(c)} size={32} />}
                    title={nameOf(c)}
                    subtitle={c.body}
                    trailing={
                      c.isMine ? (
                        <IconButton
                          icon="delete-outline"
                          label={t('delete')}
                          onPress={async () => {
                            await feedApi(api).deleteComment(activityId, c.id).catch((e) => toast(errorMessage(t, e)));
                            await refresh();
                          }}
                        />
                      ) : null
                    }
                  />
                ))}
              </ScrollView>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, padding: 12 }}>
            <TextField testID="comment-input" style={{ flex: 1 }} placeholder={t('writeComment')} value={text} onChangeText={setText} maxLength={500} />
            <IconButton icon="send" label={t('sendComment')} color={text.trim() && !busy ? colors.primary : colors.outline} onPress={() => text.trim() && !busy && send()} />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
