import { Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { ApiError } from '../../../core/api/errors';
import { useT } from '../../../core/prefs';
import { useTheme } from '../../../core/theme';
import { EmptyState, Loading } from '../../../core/widgets/common';
import { ErrorView } from '../../../core/widgets/error';
import { Chip } from '../../../core/widgets/kit';
import { useCompetition } from '../api';
import { AnnouncementsTab } from './announcements';
import { CategoriesTab } from './categories';
import { CouponsTab } from './coupons';
import { DashboardTab } from './dashboard';
import { FinancesTab } from './finances';
import { GeneralTab } from './general';
import { LeaderboardTab } from './leaderboard';
import type { ManageTab } from './logic';
import { ParticipantsTab } from './participants';
import { PlanningTab } from './planning';
import { ScheduleTab } from './schedule';
import { SettingsTab } from './settings';
import { TeamTab } from './team';
import { phoneTab, useWideWeb, type Go } from './web';
import { OrganizerWeb } from './web-shell';
import { WodsTab } from './wods';

/** Tabs of the organizer space on a phone, in display order (the computer layout groups them, `ORG_MENU`). */
const TABS: ManageTab[] = ['dashboard', 'general', 'settings', 'categories', 'wods', 'planning', 'participants', 'team', 'leaderboard', 'announcements', 'coupons'];

export function ManageScreen({ id, initialTab = 'dashboard' }: { id: string; initialTab?: ManageTab }) {
  const t = useT();
  const { colors } = useTheme();
  const comp = useCompetition(id);
  const wide = useWideWeb();
  const [tab, setTab] = useState<ManageTab>(initialTab);
  const [focus, setFocus] = useState<{ categoryId: string } | null>(null);
  /** Opens a page; only the overview's categories open Participants already filtered. */
  const go: Go = (next, f) => {
    setFocus(f ?? null);
    setTab(next);
  };
  const labels: Record<ManageTab, string> = { dashboard: t('orgTabDashboard'), finances: t('orgMenuFinances'), timetable: t('orgMenuTimetable'), general: t('orgTabGeneral'), settings: t('orgTabSettings'), categories: t('orgTabCategories'), wods: t('orgTabWods'), planning: t('orgTabPlanning'), participants: t('orgTabParticipants'), team: t('orgTabTeam'), leaderboard: t('orgTabLeaderboard'), announcements: t('orgTabAnnouncements'), coupons: t('orgTabCoupons') };

  // The server answers 404 (a draft) or 403 to anyone who is not on the staff.
  if (comp.error instanceof ApiError && (comp.error.status === 404 || comp.error.status === 403)) return <EmptyState icon="lock" message={t('orgOnly')} />;
  if (comp.isError) return <ErrorView error={comp.error} onRetry={() => comp.refetch()} />;
  const c = comp.data;
  if (!c) return <Loading />;
  if (!(c.myRoles ?? []).includes('ORGANIZER')) return <EmptyState icon="lock" message={t('orgOnly')} />;
  // Finances and the time table exist only on a computer: a narrow window shows the nearest phone tab, and the page comes back when it widens.
  const shown = wide ? tab : phoneTab(tab);
  const page = (
    <>
      {shown === 'dashboard' && <DashboardTab c={c} onGo={go} />}
      {shown === 'finances' && <FinancesTab c={c} />}
      {shown === 'general' && <GeneralTab c={c} />}
      {shown === 'settings' && <SettingsTab c={c} />}
      {shown === 'categories' && <CategoriesTab c={c} />}
      {shown === 'wods' && <WodsTab c={c} onGo={go} />}
      {shown === 'planning' && <PlanningTab c={c} onGo={go} />}
      {shown === 'timetable' && <ScheduleTab c={c} onGo={go} />}
      {/* Keyed on the category: a new « filtered on » opens a fresh list. */}
      {shown === 'participants' && <ParticipantsTab key={focus?.categoryId ?? 'all'} c={c} initialCategoryId={focus?.categoryId ?? null} />}
      {shown === 'team' && <TeamTab c={c} />}
      {shown === 'leaderboard' && <LeaderboardTab c={c} onGo={go} />}
      {shown === 'announcements' && <AnnouncementsTab c={c} />}
      {shown === 'coupons' && <CouponsTab c={c} />}
    </>
  );

  if (wide) {
    return (
      <>
        {/* The top bar shows the event name and has its own way back (Circle21's compact header). */}
        <Stack.Screen options={{ title: t('orgManage'), headerShown: false }} />
        <OrganizerWeb c={c} tab={shown} onTab={go}>
          {page}
        </OrganizerWeb>
      </>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* headerShown again: the stack keeps the computer layout's « hidden » when the window narrows. */}
      <Stack.Screen options={{ title: c.title, headerShown: true }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
        {TABS.map((k) => (
          <Chip key={k} testID={`org-tab-${k}`} label={labels[k]} selected={shown === k} onPress={() => go(k)} />
        ))}
      </ScrollView>
      {page}
    </View>
  );
}
