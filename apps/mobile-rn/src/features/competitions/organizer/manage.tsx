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
import { GeneralTab } from './general';
import { LeaderboardTab } from './leaderboard';
import type { ManageTab } from './logic';
import { ParticipantsTab } from './participants';
import { PlanningTab } from './planning';
import { TeamTab } from './team';
import { phoneTab, useWideWeb } from './web';
import { OrganizerWeb } from './web-shell';
import { WodsTab } from './wods';

/** Tabs of the organizer space on a phone, in display order (the computer layout groups them, `ORG_MENU`). */
const TABS: ManageTab[] = ['dashboard', 'general', 'categories', 'wods', 'planning', 'participants', 'team', 'leaderboard', 'announcements', 'coupons'];

export function ManageScreen({ id, initialTab = 'dashboard' }: { id: string; initialTab?: ManageTab }) {
  const t = useT();
  const { colors } = useTheme();
  const comp = useCompetition(id);
  const wide = useWideWeb();
  const [tab, setTab] = useState<ManageTab>(initialTab);
  const labels: Record<ManageTab, string> = { dashboard: t('orgTabDashboard'), finances: t('orgMenuFinances'), timetable: t('orgMenuTimetable'), general: t('orgTabGeneral'), categories: t('orgTabCategories'), wods: t('orgTabWods'), planning: t('orgTabPlanning'), participants: t('orgTabParticipants'), team: t('orgTabTeam'), leaderboard: t('orgTabLeaderboard'), announcements: t('orgTabAnnouncements'), coupons: t('orgTabCoupons') };

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
      {shown === 'dashboard' && <DashboardTab c={c} onGo={setTab} />}
      {shown === 'general' && <GeneralTab c={c} />}
      {shown === 'categories' && <CategoriesTab c={c} />}
      {shown === 'wods' && <WodsTab c={c} onGo={setTab} />}
      {shown === 'planning' && <PlanningTab c={c} onGo={setTab} />}
      {shown === 'participants' && <ParticipantsTab c={c} />}
      {shown === 'team' && <TeamTab c={c} />}
      {shown === 'leaderboard' && <LeaderboardTab c={c} onGo={setTab} />}
      {shown === 'announcements' && <AnnouncementsTab c={c} />}
      {shown === 'coupons' && <CouponsTab c={c} />}
    </>
  );

  if (wide) {
    return (
      <>
        {/* The top bar shows the event name: the header keeps the way back. */}
        <Stack.Screen options={{ title: t('orgManage') }} />
        <OrganizerWeb c={c} tab={tab} onTab={setTab}>
          {page}
        </OrganizerWeb>
      </>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: c.title }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
        {TABS.map((k) => (
          <Chip key={k} testID={`org-tab-${k}`} label={labels[k]} selected={shown === k} onPress={() => setTab(k)} />
        ))}
      </ScrollView>
      {page}
    </View>
  );
}
