import { useLocalSearchParams } from 'expo-router';

import { GymWarScreen } from '../../features/gym-wars/screens';

export default function GymWarRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <GymWarScreen id={id} />;
}
