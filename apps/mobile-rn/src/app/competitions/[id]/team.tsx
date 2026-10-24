import { useLocalSearchParams } from 'expo-router';

import { TeamScreen } from '../../../features/competitions/team';

export default function CompetitionTeamRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TeamScreen id={id} />;
}
