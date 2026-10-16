import type { T } from '../../../core/prefs';
import type { ManageTab } from './logic';

/** The name of each page on a computer: the same in the menu and in the page's header row. */
export const pageTitle = (t: T, tab: ManageTab): string =>
  ({
    dashboard: t('orgMenuOverview'),
    finances: t('orgMenuFinances'),
    general: t('orgMenuEventInfo'),
    categories: t('orgTabCategories'),
    coupons: t('orgTabCoupons'),
    team: t('orgTabTeam'),
    participants: t('orgTabParticipants'),
    wods: t('orgTabWods'),
    planning: t('orgMenuHeats'),
    timetable: t('orgMenuTimetable'),
    leaderboard: t('orgTabLeaderboard'),
    announcements: t('orgTabAnnouncements'),
  })[tab];
