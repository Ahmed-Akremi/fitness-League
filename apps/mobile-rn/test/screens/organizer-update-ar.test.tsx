import AsyncStorage from '@react-native-async-storage/async-storage';

import ar from '../../src/core/i18n/ar.json';
import en from '../../src/core/i18n/en.json';
import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';

beforeEach(async () => {
  await AsyncStorage.clear();
});

const keys = new Set(Object.keys(en));
/** Every string the screen shows. */
const texts = (node: unknown, out: string[] = []): string[] => {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((n) => texts(n, out));
  else if (node && typeof node === 'object') texts((node as { children?: unknown }).children, out);
  return out;
};

/** Phase 12: the pages of the organisation update in Arabic (right to left): translated, no key left on screen. */
describe('organisation update pages in Arabic', () => {
  const hybrid = { ...event, eventStyle: 'HYBRID_RACE', hybridTemplate: 'HYROX_STYLE', workouts: [] };
  const pages: [ManageTab, object, keyof typeof ar][] = [
    ['race', hybrid, 'raceChoose'],
    ['waves', hybrid, 'wavesGenerate'],
    ['live', event, 'liveTimer'],
    ['tools', event, 'toolsIntro'],
    ['results', event, 'resSettings'],
    ['messages', event, 'msgCompose'],
    ['tickets', event, 'tkTypes'],
    ['shop', event, 'shProducts'],
  ];

  it.each(pages)('%s', async (tab, c, key) => {
    const backend = orgBackend(c).on('GET', '/competitions/c9/heats', [200, []]).on('GET', '/competitions/c9/staff', [200, []]).on('GET', '/competitions/c9/leaderboard', [200, { rows: [], workouts: [] }]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab={tab} />, backend, { locale: 'ar' });
    expect(await screen.findAllByText(ar[key] as string)).not.toHaveLength(0);
    expect(texts(screen.toJSON()).filter((s) => keys.has(s))).toEqual([]);
  });
});
