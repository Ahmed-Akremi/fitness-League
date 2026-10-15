import { Platform, useWindowDimensions } from 'react-native';

import type { Json } from '../../../core/api/client';
import { missingForPublication, publicationState, TAB_FOR, type ManageTab } from './logic';

/** Organizer space on a computer (analysis 2026-10-15, lot Web 1): a wide layout in the browser, the phone keeps its tabs. */

export const WIDE_WEB_MIN = 1024;

export const isWideWeb = (os: string, width: number) => os === 'web' && width >= WIDE_WEB_MIN;

/** Read again on every resize: crossing 1024 px switches the layout without a reload. */
export function useWideWeb(): boolean {
  const { width } = useWindowDimensions();
  return isWideWeb(Platform.OS, width);
}

export type MenuSectionKey = 'dashboard' | 'general' | 'participants' | 'planning' | 'leaderboard' | 'messages';
export type MenuSection = { key: MenuSectionKey; tabs: ManageTab[] };

/** Left menu, grouped by stage like the Circle21 portal; a section with one page is a single entry. */
export const ORG_MENU: MenuSection[] = [
  { key: 'dashboard', tabs: ['dashboard'] },
  { key: 'general', tabs: ['general', 'categories', 'coupons', 'team'] },
  { key: 'participants', tabs: ['participants'] },
  { key: 'planning', tabs: ['wods', 'planning'] },
  { key: 'leaderboard', tabs: ['leaderboard'] },
  { key: 'messages', tabs: ['announcements'] },
];

/** Content column: forms stay readable (720 px of fields + padding), figures and tables use the room. */
export const FORM_WIDTH = 752;
export const WIDE_WIDTH = 1200;
const WIDE_TABS: ManageTab[] = ['dashboard', 'participants', 'planning', 'leaderboard'];
export const contentWidth = (tab: ManageTab) => (WIDE_TABS.includes(tab) ? WIDE_WIDTH : FORM_WIDTH);

export type MenuMark = 'todo' | number;

/** Menu marks: « todo » where the publication checklist still misses something (draft or sent back), the number to collect on Participants. */
export function menuMarks(c: Json, toCollect: number): Partial<Record<ManageTab, MenuMark>> {
  const marks: Partial<Record<ManageTab, MenuMark>> = {};
  const state = publicationState(c);
  if (state === 'DRAFT' || state === 'RETURNED') for (const item of missingForPublication(c)) marks[TAB_FOR[item]] = 'todo';
  if (toCollect > 0) marks.participants = toCollect;
  return marks;
}
