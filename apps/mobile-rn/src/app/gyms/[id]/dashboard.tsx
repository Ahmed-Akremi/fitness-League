import { useLocalSearchParams } from 'expo-router';

import { GymDashboardScreen } from '../../../features/gyms/screens';

export default function GymDashboardRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <GymDashboardScreen id={id} />;
}
