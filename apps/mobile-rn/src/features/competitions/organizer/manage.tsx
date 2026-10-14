import { Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useT } from '../../../core/prefs';
import { useTheme } from '../../../core/theme';
import { EmptyState, Loading } from '../../../core/widgets/common';
import { ErrorView } from '../../../core/widgets/error';
import { Chip } from '../../../core/widgets/kit';
import { useCompetition } from '../api';
import { CategoriesTab } from './categories';
import { DashboardTab } from './dashboard';
import { GeneralTab } from './general';
import type { ManageTab } from './logic';

/** Tabs of the organizer space, in display order (lot A; lot B adds planning, participants, team, leaderboard, announcements, promo codes). */
const TABS: ManageTab[] = ['dashboard', 'general', 'categories'];

export function ManageScreen({ id, initialTab = 'dashboard' }: { id: string; initialTab?: ManageTab }) {
  const t = useT();
  const { colors } = useTheme();
  const comp = useCompetition(id);
  const [tab, setTab] = useState<ManageTab>(initialTab);
  const labels: Record<ManageTab, string> = { dashboard: t('orgTabDashboard'), general: t('orgTabGeneral'), categories: t('orgTabCategories'), wods: t('orgTabWods') };

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
    </View>
  );
}
