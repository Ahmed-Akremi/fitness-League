import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import type { Json } from '../../core/api/client';
import { useLocale, useT } from '../../core/prefs';
import { displayText, radius, space, useTheme } from '../../core/theme';
import { formatDate } from '../../core/utils/format';
import { SectionHeader, StatusPill } from '../../core/widgets/common';
import { Icon, Txt } from '../../core/widgets/kit';
import { useCompetitions } from '../competitions/api';
import { DEFAULT_COVER, statusLabelForCompetition } from '../competitions/screens';

/** Banner ratio used by competition covers (1440 × 596). */
const COVER_RATIO = 596 / 1440;

/** Home: published, unfinished competitions as full-width banners, one per page. Hidden when there are none. */
export function CompetitionCarousel() {
  const t = useT();
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const list = useCompetitions('CURRENT', false);
  const [index, setIndex] = useState(0);
  const items = list.data ?? [];
  if (items.length === 0) return null;
  // The row bleeds to the screen edges so pages snap to the full width; each banner keeps the screen padding.
  const bannerWidth = windowWidth - 2 * space.lg;
  return (
    <View testID="home-competitions" style={{ gap: space.md }}>
      <SectionHeader title={t('homeCompetitionsTitle')} actionLabel={t('homeSeeAll')} onAction={() => router.push('/competitions')} />
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, marginHorizontal: -space.lg }}
        scrollEventThrottle={32}
        onScroll={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / windowWidth))}
      >
        {items.map((c) => (
          <View key={c.id} style={{ width: windowWidth, paddingHorizontal: space.lg }}>
            <Banner competition={c} width={bannerWidth} />
          </View>
        ))}
      </ScrollView>
      {items.length > 1 && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
          {items.map((c, i) => (
            <View key={c.id} style={{ height: 6, width: i === index ? 18 : 6, borderRadius: 3, backgroundColor: i === index ? colors.primary : colors.surfaceHigh }} />
          ))}
        </View>
      )}
    </View>
  );
}

function Banner({ competition: c, width }: { competition: Json; width: number }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const height = Math.round(width * COVER_RATIO) + 64;
  return (
    <Pressable
      testID={`home-comp-${c.id}`}
      accessibilityRole="button"
      accessibilityLabel={c.title}
      onPress={() => router.push(`/competitions/${c.id}`)}
      style={({ pressed }) => ({ width, height, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.surface, opacity: pressed ? 0.9 : 1 })}
    >
      <Image source={c.coverUrl ? { uri: c.coverUrl } : DEFAULT_COVER} accessibilityIgnoresInvertColors resizeMode="cover" style={{ width, height }} />
      {/* Dark band so white text stays readable on any banner. */}
      <View style={{ position: 'absolute', start: 0, end: 0, bottom: 0, padding: space.md, gap: space.xs, backgroundColor: 'rgba(8,9,12,0.72)' }}>
        <Txt numberOfLines={1} style={[displayText(26), { color: '#FFFFFF', textTransform: 'uppercase' }]}>{c.title}</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
          <StatusPill label={statusLabelForCompetition(t, c.status)} color={c.status === 'REGISTRATION_OPEN' ? colors.primary : '#FFFFFF'} />
          <Icon name="event" size={16} color="#FFFFFFCC" />
          <Txt variant="small" color="#FFFFFFCC">{formatDate(c.eventStart, locale)}</Txt>
          {c.city ? (
            <>
              <Icon name="place" size={16} color="#FFFFFFCC" />
              <Txt variant="small" color="#FFFFFFCC">{c.city}</Txt>
            </>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
