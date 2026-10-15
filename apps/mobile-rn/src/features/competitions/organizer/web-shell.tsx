import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { StatusPill } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Txt } from '../../../core/widgets/kit';
import { statusLabelForCompetition } from '../screens';
import { useRegistrations } from './api';
import type { ManageTab } from './logic';
import { toCollect } from './logic-b';
import { usePublication } from './publication';
import { contentWidth, menuMarks, ORG_MENU, type MenuMark, type MenuSectionKey } from './web';

const MENU_WIDTH = 248;

/** Organizer space on a computer (analysis 2026-10-15, lot Web 1): left menu grouped like Circle21, top bar, centered content column. */
export function OrganizerWeb({ c, tab, onTab, children }: { c: Json; tab: ManageTab; onTab: (tab: ManageTab) => void; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.background }}>
      <OrgMenu c={c} tab={tab} onTab={onTab} />
      <View style={{ flex: 1 }}>
        <TopBar c={c} />
        <View testID="org-content" style={{ flex: 1, width: '100%', maxWidth: contentWidth(tab), alignSelf: 'center' }}>
          {children}
        </View>
      </View>
    </View>
  );
}

function OrgMenu({ c, tab, onTab }: { c: Json; tab: ManageTab; onTab: (tab: ManageTab) => void }) {
  const t = useT();
  const { colors } = useTheme();
  const regs = useRegistrations(c.id);
  const marks = menuMarks(c, toCollect(regs.data ?? []).length);
  const label: Record<ManageTab, string> = {
    dashboard: t('orgTabDashboard'),
    general: t('orgMenuEventInfo'),
    categories: t('orgTabCategories'),
    coupons: t('orgTabCoupons'),
    team: t('orgTabTeam'),
    participants: t('orgTabParticipants'),
    wods: t('orgTabWods'),
    planning: t('orgMenuHeats'),
    leaderboard: t('orgTabLeaderboard'),
    announcements: t('orgTabAnnouncements'),
  };
  const section: Partial<Record<MenuSectionKey, string>> = { general: t('orgTabGeneral'), planning: t('orgTabPlanning') };
  return (
    <ScrollView
      testID="org-menu"
      accessibilityLabel={t('orgMenuLabel')}
      style={{ width: MENU_WIDTH, flexGrow: 0, borderRightWidth: 1, borderRightColor: colors.border }}
      contentContainerStyle={{ padding: space.md, gap: space.xs }}
    >
      {ORG_MENU.map((s) => (
        <View key={s.key} style={{ gap: 2, marginTop: s.tabs.length > 1 ? space.sm : 0 }}>
          {s.tabs.length > 1 ? (
            <Txt variant="label" color={colors.outline} style={{ paddingHorizontal: space.sm, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }}>
              {section[s.key] ?? ''}
            </Txt>
          ) : null}
          {s.tabs.map((k) => (
            <MenuItem key={k} tab={k} label={label[k]} selected={tab === k} mark={marks[k]} indent={s.tabs.length > 1} onPress={() => onTab(k)} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

function MenuItem({ tab, label, selected, mark, indent, onPress }: { tab: ManageTab; label: string; selected: boolean; mark?: MenuMark; indent: boolean; onPress: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const spoken = mark === 'todo' ? `${label}, ${t('orgMarkTodo')}` : mark ? `${label}, ${mark}` : label;
  return (
    <Pressable
      testID={`org-menu-${tab}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={spoken}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        minHeight: 40,
        paddingVertical: space.sm,
        paddingLeft: indent ? space.lg : space.sm,
        paddingRight: space.sm,
        borderRadius: 10,
        backgroundColor: selected ? colors.surfaceHigh : pressed ? colors.surface : 'transparent',
      })}
    >
      <Txt style={{ flex: 1, fontWeight: selected ? '700' : '400' }} color={selected ? colors.primary : colors.text}>
        {label}
      </Txt>
      {mark === 'todo' ? (
        <View testID={`org-mark-${tab}`} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error }} />
      ) : mark ? (
        <Txt testID={`org-mark-${tab}`} variant="small" color={colors.onPrimary} style={{ backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 8, overflow: 'hidden' }}>
          {String(mark)}
        </Txt>
      ) : null}
    </Pressable>
  );
}

function TopBar({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const p = usePublication(c);
  const pill = {
    DRAFT: t('orgPillDraft'),
    REQUESTED: t('orgPillRequested'),
    RETURNED: t('orgPillReturned'),
    PUBLISHED: statusLabelForCompetition(t, c.status),
    CANCELLED: t('orgPillCancelled'),
  }[p.state];
  const pillColor = p.state === 'PUBLISHED' ? colors.primary : p.state === 'RETURNED' || p.state === 'CANCELLED' ? colors.error : colors.outline;
  const format = ({ ONSITE: t('orgFormatOnsite'), ONLINE: t('orgFormatOnline'), HYBRID: t('orgFormatHybrid') } as Record<string, string>)[c.format];
  const from = c.deadlines?.registrationStart;
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: space.xl, paddingVertical: space.md, gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
        <View style={{ flex: 1, gap: space.xs }}>
          <Txt testID="org-top-title" variant="headline" numberOfLines={1}>
            {c.title}
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm }}>
            <StatusPill testID="org-top-status" label={pill} color={pillColor} />
            {format ? <StatusPill label={format} color={colors.outline} /> : null}
            {from && c.registrationEnd ? (
              <Txt variant="small" color={colors.outline}>
                {t('orgTopDates', { from: formatDate(from, locale), to: formatDate(c.registrationEnd, locale) })}
              </Txt>
            ) : null}
          </View>
        </View>
        <Button testID="org-top-preview" kind="outlined" icon="visibility" label={t('orgPreview')} onPress={() => router.push(`/competitions/${c.id}`)} />
        {p.state === 'PUBLISHED' ? (
          <Button testID="org-top-share" icon="share" label={t('orgShare')} onPress={p.share} />
        ) : p.state === 'DRAFT' || p.state === 'RETURNED' ? (
          <Button testID="org-top-request" label={t('orgRequestPublication')} busy={p.busy} disabled={!p.canRequest} onPress={p.request} />
        ) : null}
      </View>
      <ErrorText error={p.error} />
    </View>
  );
}
