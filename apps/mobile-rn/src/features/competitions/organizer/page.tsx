import type { ReactNode } from 'react';

import { useT, type T } from '../../../core/prefs';
import { Button } from '../../../core/widgets/kit';
import { PageHeader, SquareButton } from '../../../core/widgets/web';
import type { ManageTab } from './logic';
import { useWideWeb } from './web';

/** The name of each page on a computer: the same in the menu and in the page's header row. */
export const pageTitle = (t: T, tab: ManageTab): string =>
  ({
    dashboard: t('orgMenuOverview'),
    finances: t('orgMenuFinances'),
    general: t('orgMenuEventInfo'),
    settings: t('orgTabSettings'),
    categories: t('orgTabCategories'),
    pricing: t('orgTabPricing'),
    forms: t('orgTabForms'),
    coupons: t('orgTabCoupons'),
    team: t('orgTabTeam'),
    participants: t('orgTabParticipants'),
    wods: t('orgTabWods'),
    planning: t('orgMenuHeats'),
    timetable: t('orgMenuTimetable'),
    leaderboard: t('orgTabLeaderboard'),
    announcements: t('orgTabAnnouncements'),
  })[tab];

/** The header row that starts every page on a computer (Circle21 refs 01, 12, 20): the page's name, its actions on the right. Nothing on a phone. */
export function OrgPageHeader({ tab, actions }: { tab: ManageTab; actions?: ReactNode }) {
  const t = useT();
  const wide = useWideWeb();
  if (!wide) return null;
  return <PageHeader testID="org-page-header" title={pageTitle(t, tab)} actions={actions} />;
}

/** « Exporter (CSV) »: a labelled square icon in the header row on a computer, the outlined button on a phone. */
export function ExportButton({ testID, disabled, onPress }: { testID: string; disabled: boolean; onPress: () => void }) {
  const t = useT();
  const wide = useWideWeb();
  return wide ? (
    <SquareButton testID={testID} icon="file-download" label={t('orgExport')} disabled={disabled} onPress={onPress} />
  ) : (
    <Button testID={testID} kind="outlined" icon="file-download" label={t('orgExport')} disabled={disabled} onPress={onPress} />
  );
}
