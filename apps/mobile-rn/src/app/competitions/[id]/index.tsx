import { useLocalSearchParams } from 'expo-router';

import { CompetitionScreen } from '../../../features/competitions/screens';

export default function CompetitionRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CompetitionScreen id={id} />;
}
