import type { SFSymbol } from 'expo-symbols';

import type { MessageKey } from '../../core/i18n';
import type { IconName } from '../../core/widgets/kit';

/**
 * Bottom bar (spec §19.1): Home · Train · League · Challenges · Profile. One list for the iOS native tabs (filled SF
 * Symbols, HIG Tab bars) and the JavaScript tabs of Android and the web (Material, outlined until selected).
 */
export const TABS: { name: 'index' | 'train' | 'league' | 'goals' | 'profile'; label: MessageKey; sf: SFSymbol; icon: IconName; selectedIcon: IconName }[] = [
  { name: 'index', label: 'navHome', sf: 'house.fill', icon: 'home', selectedIcon: 'home' },
  { name: 'train', label: 'navTrain', sf: 'dumbbell.fill', icon: 'fitness-center', selectedIcon: 'fitness-center' },
  { name: 'league', label: 'navLeague', sf: 'trophy.fill', icon: 'emoji-events', selectedIcon: 'emoji-events' },
  { name: 'goals', label: 'navChallenges', sf: 'flag.fill', icon: 'outlined-flag', selectedIcon: 'flag' },
  { name: 'profile', label: 'navProfile', sf: 'person.fill', icon: 'person-outline', selectedIcon: 'person' },
];
