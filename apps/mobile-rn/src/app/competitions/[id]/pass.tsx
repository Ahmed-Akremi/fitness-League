import { useLocalSearchParams } from 'expo-router';

import { PassScreen } from '../../../features/competitions/pass';

export default function CompetitionPassRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PassScreen id={id} />;
}
