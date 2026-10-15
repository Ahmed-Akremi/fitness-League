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
import { WodsTab } from './wods';

/** Tabs of the organizer space, in display order. */
const TABS: ManageTab[] = ['dashboard', 'general', 'categories', 'wods', 'planning', 'participants', 'team', 'leaderboard', 'announcements', 'coupons'];

export function ManageScreen({ id, initialTab = 'dashboard' }: { id: string; initialTab?: ManageTab }) {
  const t = useT();
  const { colors } = useTheme();
  const comp = useCompetition(id);
  const [tab, setTab] = useState<ManageTab>(initialTab);
  const labels: Record<ManageTab, string> = { dashboard: t('orgTabDashboard'), general: t('orgTabGeneral'), categories: t('orgTabCategories'), wods: t('orgTabWods'), planning: t('orgTabPlanning'), participants: t('orgTabParticipants'), team: t('orgTabTeam'), leaderboard: t('orgTabLeaderboard'), announcements: t('orgTabAnnouncements'), coupons: t('orgTabCoupons') };

  // The server answers 404 (a draft) or 403 to anyone who is not on the staff.
  if (comp.error instanceof ApiError && (comp.error.status === 404 || comp.error.status === 403)) return <EmptyState icon="lock" message={t('orgOnly')} />;
  if (comp.isError) return <ErrorView error={comp.error} onRetry={() => comp.refetch()} />;
  const c = comp.data;
  if (!c) return <Loading />;
  if (!(c.myRoles ?? []).includes('ORGANIZER')) return <EmptyState icon="lock" message={t('orgOnly')} />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: c.title }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
        {TABS.map((k) => (
          <Chip key={k} testID={`org-tab-${k}`} label={labels[k]} selected={tab === k} onPress={() => setTab(k)} />
        ))}
      </ScrollView>
      {tab === 'dashboard' && <DashboardTab c={c} onGo={setTab} />}
      {tab === 'general' && <GeneralTab c={c} />}
      {tab === 'categories' && <CategoriesTab c={c} />}
      {tab === 'wods' && <WodsTab c={c} onGo={setTab} />}
      {tab === 'planning' && <PlanningTab c={c} onGo={setTab} />}
      {tab === 'participants' && <ParticipantsTab c={c} />}
      {tab === 'team' && <TeamTab c={c} />}
      {tab === 'leaderboard' && <LeaderboardTab c={c} onGo={setTab} />}
      {tab === 'announcements' && <AnnouncementsTab c={c} />}
      {tab === 'coupons' && <CouponsTab c={c} />}
    </View>
  );
}
