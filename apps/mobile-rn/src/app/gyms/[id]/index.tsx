import { useLocalSearchParams } from 'expo-router';

import { GymProfileScreen } from '../../../features/gyms/screens';

export default function GymProfileRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <GymProfileScreen id={id} />;
}
