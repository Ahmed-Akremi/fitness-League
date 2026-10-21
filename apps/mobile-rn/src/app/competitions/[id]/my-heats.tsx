import { useLocalSearchParams } from 'expo-router';

import { MyHeatsScreen } from '../../../features/competitions/my-heats';

export default function CompetitionMyHeatsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MyHeatsScreen id={id} />;
}
