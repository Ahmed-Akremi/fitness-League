import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import type { Json } from '../../core/api/client';
import { useLocale, useT, type T } from '../../core/prefs';
import { useTheme } from '../../core/theme';
import { localized } from '../../core/utils/format';
import { SectionHeader, SkeletonList, XpBar } from '../../core/widgets/common';
import { ErrorView } from '../../core/widgets/error';
import { Icon, Txt, type IconName } from '../../core/widgets/kit';
import { useBadges } from './api';

const categoryLabel = (t: T, c: string) =>
  c === 'PROGRESS'
    ? t('badgeCategoryProgress')
    : c === 'CONSISTENCY'
      ? t('badgeCategoryConsistency')
      : c === 'COMPETITION'
        ? t('badgeCategoryCompetition')
        : c === 'SOCIAL'
          ? t('badgeCategorySocial')
          : c === 'GYM'
            ? t('badgeCategoryGym')
            : t('badgeCategoryElite');

const ICONS: Record<string, IconName> = {
  dumbbell: 'fitness-center',
  'first-step': 'fitness-center',
  trophy: 'emoji-events',
  'trending-up': 'trending-up',
  flag: 'flag',
  flame: 'local-fire-department',
  swords: 'sports-mma',
  bolt: 'bolt',
  medal: 'military-tech',
  diamond: 'diamond',
  crown: 'workspace-premium',
  star: 'star',
  users: 'group',
  building: 'store',
  shield: 'shield',
  target: 'track-changes',
};

export const badgeIcon = (icon?: string): IconName => (icon && ICONS[icon]) || 'verified';

/** Badge collection: earned badges in colour, locked ones greyed with their progress (docs §3.10). */
export function BadgesScreen() {
  const t = useT();
  const { colors } = useTheme();
  const badges = useBadges();
  if (badges.isError) return <ErrorView error={badges.error} onRetry={() => badges.refetch()} />;
  if (!badges.data) return <SkeletonList count={4} height={96} />;
  const all = badges.data;
  const earned = all.filter((b) => b.awardedAt != null).length;
  const categories = new Map<string, Json[]>();
  for (const b of all) categories.set(b.category, [...(categories.get(b.category) ?? []), b]);
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 24 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => badges.refetch()} tintColor={colors.primary} />}>
      <Txt variant="title">{t('badgesEarned', { earned, total: all.length })}</Txt>
      {[...categories.entries()].map(([category, list]) => (
        <View key={category}>
          <SectionHeader title={categoryLabel(t, category)} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {list.map((b) => (
              <BadgeTile key={b.id ?? b.code} badge={b} />
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function BadgeTile({ badge }: { badge: Json }) {
  const locale = useLocale();
  const { colors } = useTheme();
  const [showDescription, setShowDescription] = useState(false);
  const earned = badge.awardedAt != null;
  const p: Json | null = badge.progress ?? null;
  const color = badge.rarity === 'LEGENDARY' ? '#FFC107' : badge.rarity === 'EPIC' ? '#E040FB' : badge.rarity === 'RARE' ? '#40C4FF' : colors.primary;
  const name = localized(badge.name, locale);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityHint={localized(badge.description, locale)}
      onPress={() => setShowDescription(!showDescription)}
      style={{ width: '31.5%', aspectRatio: 0.78, backgroundColor: colors.surface, borderRadius: 16, padding: 8, alignItems: 'center', justifyContent: 'center', gap: 6 }}
    >
      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: earned ? color + '2E' : colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={badgeIcon(badge.icon)} color={earned ? color : colors.outline} />
      </View>
      <Txt variant="small" numberOfLines={showDescription ? 4 : 2} color={earned ? undefined : colors.outline} style={{ textAlign: 'center', fontWeight: '600' }}>
        {showDescription ? localized(badge.description, locale) : name}
      </Txt>
      {!earned && p && !showDescription && (
        <View style={{ alignSelf: 'stretch', gap: 2 }}>
          <XpBar value={Number(p.current) / Number(p.target)} />
          <Txt variant="small" color={colors.outline} style={{ textAlign: 'center', fontSize: 11 }}>{`${p.current}/${p.target}`}</Txt>
        </View>
      )}
    </Pressable>
  );
}
