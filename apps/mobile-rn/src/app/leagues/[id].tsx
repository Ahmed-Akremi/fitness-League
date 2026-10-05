import { useLocalSearchParams } from 'expo-router';

import { LeagueDetailScreen } from '../../features/leagues/screens';

export default function LeagueDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <LeagueDetailScreen id={id} />;
}
