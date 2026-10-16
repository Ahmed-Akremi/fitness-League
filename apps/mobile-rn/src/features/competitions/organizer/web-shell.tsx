import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View, type ViewStyle } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { isFocused, useFocusRing } from '../../../core/focus';
import { space, ThemeScope, useTheme, webDense } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { GymLogo } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Icon, IconButton, Menu, Txt } from '../../../core/widgets/kit';
import { statusLabelForCompetition } from '../screens';
import { useRegistrations } from './api';
import { exportCsv } from './export';
import type { ManageTab } from './logic';
import { csvFileName, csvSeparator, registrationsCsv, toCollect } from './logic-b';
import { pageTitle } from './page';
import { usePublication } from './publication';
import { contentWidth, MENU_ICON, menuMarks, ORG_MENU, type MenuMark, type MenuSectionKey } from './web';

const MENU_WIDTH = 220;
const TOP_BAR_HEIGHT = 56;

/**
 * Organizer space on a computer (lot Web 1, restyled in lot Web 2 after the Circle21 back-office): a compact top bar
 * over the whole width, the grouped menu on the left, the page in a centered column, all in the dense look.
 */
export function OrganizerWeb({ c, tab, onTab, children }: { c: Json; tab: ManageTab; onTab: (tab: ManageTab) => void; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <ThemeScope dense>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <TopBar c={c} onTab={onTab} />
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <OrgMenu c={c} tab={tab} onTab={onTab} />
          <View style={{ flex: 1 }}>
            <View testID="org-content" style={{ flex: 1, width: '100%', maxWidth: contentWidth(tab), alignSelf: 'center' }}>
              {children}
            </View>
          </View>
        </View>
      </View>
    </ThemeScope>
  );
}

function OrgMenu({ c, tab, onTab }: { c: Json; tab: ManageTab; onTab: (tab: ManageTab) => void }) {
  const t = useT();
  const { colors } = useTheme();
  const regs = useRegistrations(c.id);
  const marks = menuMarks(c, toCollect(regs.data ?? []).length);
  const section: Partial<Record<MenuSectionKey, string>> = { dashboard: t('orgTabDashboard'), general: t('orgTabGeneral'), planning: t('orgTabPlanning') };
  return (
    <View testID="org-menu" accessibilityLabel={t('orgMenuLabel')} style={{ width: MENU_WIDTH, borderRightWidth: 1, borderRightColor: colors.border }}>
      <ScrollView contentContainerStyle={{ padding: space.sm, gap: 2 }}>
        {ORG_MENU.map((s) => (
          <View key={s.key} style={{ gap: 2, marginTop: s.tabs.length > 1 ? space.md : 0 }}>
            {s.tabs.length > 1 ? (
              <Txt variant="label" color={colors.outline} style={{ paddingHorizontal: space.sm, paddingBottom: space.xs, fontSize: 12, letterSpacing: 1 }}>
                {section[s.key] ?? ''}
              </Txt>
            ) : null}
            {s.tabs.map((k) => (
              <MenuItem key={k} tab={k} label={pageTitle(t, k)} selected={tab === k} mark={marks[k]} onPress={() => onTab(k)} />
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function MenuItem({ tab, label, selected, mark, onPress }: { tab: ManageTab; label: string; selected: boolean; mark?: MenuMark; onPress: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const ring = useFocusRing();
  const spoken = mark === 'todo' ? `${label}, ${t('orgMarkTodo')}` : mark ? `${label}, ${mark}` : label;
  return (
    <Pressable
      testID={`org-menu-${tab}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={spoken}
      onPress={onPress}
      style={(state) => {
        // react-native-web passes `hovered` too.
        const hovered = (state as { hovered?: boolean }).hovered;
        const item: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: 10, height: 36, paddingHorizontal: space.md, borderRadius: webDense.radius.field, backgroundColor: selected ? colors.surfaceHigh : hovered || state.pressed ? colors.surface : 'transparent' };
        return [item, ring(isFocused(state))];
      }}
    >
      {/* Circle21's active item: a 3 px bar in the accent on the leading edge (the web layout is not mirrored). */}
      {selected ? <View testID="org-menu-active" style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, backgroundColor: colors.primary }} /> : null}
      <Icon name={MENU_ICON[tab]} size={18} color={selected ? colors.primary : colors.outline} />
      <Txt numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: selected ? '700' : '400' }}>
        {label}
      </Txt>
      {mark === 'todo' ? (
        <View testID={`org-mark-${tab}`} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error }} />
      ) : mark ? (
        <Txt testID={`org-mark-${tab}`} variant="small" color={colors.onPrimary} style={{ backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 8, overflow: 'hidden', fontSize: 12 }}>
          {String(mark)}
        </Txt>
      ) : null}
    </Pressable>
  );
}

function TopBar({ c, onTab }: { c: Json; onTab: (tab: ManageTab) => void }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const p = usePublication(c);
  const regs = useRegistrations(c.id);
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
  const rows: Json[] = regs.data ?? [];
  // The rarer actions: an empty list is not exported (lot 1 rule), so the export appears once there is someone.
  const more = [
    { testID: 'org-more-checklist', label: t('orgMoreChecklist'), onPress: () => onTab('dashboard') },
    { testID: 'org-more-edit', label: t('orgMoreEdit'), onPress: () => onTab('general') },
    ...(rows.length ? [{ testID: 'org-more-export', label: t('orgMoreExport'), onPress: () => exportCsv(csvFileName(c, 'participants'), registrationsCsv(rows, csvSeparator(locale))) }] : []),
  ];
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ height: TOP_BAR_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minWidth: 0 }}>
          <IconButton testID="org-top-back" icon="arrow-back" label={t('orgBackToEvent')} onPress={() => router.navigate(`/competitions/${c.id}`)} />
          <GymLogo name={c.title} url={c.coverUrl} size={32} round />
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Txt testID="org-top-title" numberOfLines={1} style={{ fontSize: 16, fontWeight: '700', flexShrink: 1 }}>
                {c.title}
              </Txt>
              {p.state !== 'PUBLISHED' ? (
                <View testID="org-top-lock" accessible accessibilityLabel={t('orgUnpublished')}>
                  <Icon name="lock" size={14} color={colors.outline} />
                </View>
              ) : null}
            </View>
            <Txt numberOfLines={1} style={webDense.caption} color={colors.outline}>
              {format ? `${format} · ` : ''}
              <Txt testID="org-top-status" style={[webDense.caption, { fontWeight: '700' }]} color={pillColor}>
                {pill}
              </Txt>
            </Txt>
          </View>
        </View>
        {from && c.registrationEnd ? (
          <Txt testID="org-top-dates" numberOfLines={1} style={{ fontSize: 14, fontWeight: '600' }}>
            {t('orgTopDates', { from: formatDate(from, locale), to: formatDate(c.registrationEnd, locale) })}
          </Txt>
        ) : null}
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.sm }}>
          <Button testID="org-top-preview" kind="outlined" icon="visibility" label={t('orgPreview')} onPress={() => router.push(`/competitions/${c.id}`)} />
          {p.state === 'PUBLISHED' ? (
            <Button testID="org-top-share" icon="share" label={t('orgShare')} onPress={p.share} />
          ) : p.state === 'DRAFT' || p.state === 'RETURNED' ? (
            <Button testID="org-top-request" label={t('orgRequestPublication')} busy={p.busy} disabled={!p.canRequest} onPress={p.request} />
          ) : null}
          <Menu testID="org-top-more" icon="more-horiz" label={t('orgMoreActions')} items={more} />
        </View>
      </View>
      <ErrorText error={p.error} />
    </View>
  );
}
