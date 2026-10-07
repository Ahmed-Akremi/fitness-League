import { useRef, useState } from 'react';
import { Animated, Image, Pressable, View } from 'react-native';

import { config } from '../../core/config';
import { useLocale, useT } from '../../core/prefs';
import { radius, space, useTheme } from '../../core/theme';
import { timeAgo } from '../../core/utils/format';
import { SectionHeader, useReducedMotion } from '../../core/widgets/common';
import { Button, Card, Icon, LinkButton, Txt } from '../../core/widgets/kit';
import { useNews, useToggleLike, type News } from './api';

const LOGO = require('../../../assets/icon.png');
const HEART = '#FF4D6D';
/** Long texts start folded so the feed stays scannable. */
const FOLDED_LINES = 6;

/** "News" on the home screen: admin posts, newest first, likes only. Hidden when there is nothing to show. */
export function NewsSection() {
  const t = useT();
  const { colors } = useTheme();
  const news = useNews();
  const items = news.data?.pages.flatMap((p) => p.data) ?? [];
  if (news.isError || (news.data && items.length === 0)) return null;
  return (
    <>
      <SectionHeader title={t('newsTitle')} />
      {!news.data ? (
        <View testID="news-loading" style={{ height: 180, borderRadius: radius.card, backgroundColor: colors.surface }} />
      ) : (
        items.map((n) => <NewsCard key={n.id} news={n} />)
      )}
      {news.hasNextPage && <Button kind="tonal" label={t('newsMore')} busy={news.isFetchingNextPage} onPress={() => news.fetchNextPage()} />}
    </>
  );
}

export function NewsCard({ news: n }: { news: News }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const [open, setOpen] = useState(false);
  const long = (n.body?.length ?? 0) > 280 || (n.body?.split('\n').length ?? 0) > FOLDED_LINES;
  // react-native-web ignores aspectRatio on images: the photo height comes from the measured card width.
  const ratio = n.imageWidth && n.imageHeight ? n.imageHeight / n.imageWidth : 9 / 16;
  return (
    <Card testID={`news-${n.id}`} style={{ padding: 0, overflow: 'hidden' }}>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md }}>
          <Image source={LOGO} accessibilityIgnoresInvertColors style={{ width: 40, height: 40, borderRadius: 20 }} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <Txt style={{ fontWeight: '800' }}>{config.appName}</Txt>
              <Icon name="verified" size={16} color={colors.primary} />
            </View>
            <Txt variant="small" color={colors.outline}>{timeAgo(n.createdAt, locale)}</Txt>
          </View>
        </View>
        {n.body ? (
          <View style={{ paddingHorizontal: space.md, paddingBottom: space.md, gap: space.xs }}>
            <Txt numberOfLines={long && !open ? FOLDED_LINES : undefined} style={{ fontSize: 16, lineHeight: 23 }}>{n.body}</Txt>
            {long && !open && <LinkButton label={t('newsReadMore')} onPress={() => setOpen(true)} />}
          </View>
        ) : null}
        {n.imageUrl && width > 0 ? <Image testID={`news-${n.id}-photo`} source={{ uri: n.imageUrl }} accessibilityIgnoresInvertColors resizeMode="cover" style={{ width, height: Math.round(width * ratio), backgroundColor: colors.surfaceHigh }} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingVertical: space.xs }}>
          <LikeButton news={n} />
        </View>
      </View>
    </Card>
  );
}

function LikeButton({ news: n }: { news: News }) {
  const t = useT();
  const { colors } = useTheme();
  const toggle = useToggleLike();
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  function press() {
    if (!n.likedByMe && !reduced) {
      scale.setValue(0.6);
      Animated.spring(scale, { toValue: 1, friction: 3, tension: 160, useNativeDriver: true }).start();
    }
    toggle.mutate(n);
  }
  return (
    <Pressable
      testID={`news-like-${n.id}`}
      accessibilityRole="button"
      accessibilityLabel={n.likedByMe ? t('newsLiked') : t('newsLike')}
      accessibilityState={{ selected: n.likedByMe }}
      onPress={press}
      hitSlop={8}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingVertical: space.sm, borderRadius: radius.pill, opacity: pressed ? 0.7 : 1 })}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Icon name={n.likedByMe ? 'favorite' : 'favorite-border'} color={n.likedByMe ? HEART : colors.outline} size={24} />
      </Animated.View>
      <Txt testID={`news-like-${n.id}-count`} style={{ fontWeight: '700', color: n.likedByMe ? HEART : colors.text }}>{String(n.likeCount)}</Txt>
    </Pressable>
  );
}
