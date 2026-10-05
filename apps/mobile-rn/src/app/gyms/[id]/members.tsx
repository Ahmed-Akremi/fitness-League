import { useLocalSearchParams } from 'expo-router';

import { GymMembersScreen } from '../../../features/gyms/screens';

export default function GymMembersRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <GymMembersScreen id={id} />;
}
