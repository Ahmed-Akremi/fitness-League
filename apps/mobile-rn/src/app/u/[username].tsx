import { useLocalSearchParams } from 'expo-router';

import { PublicProfileScreen } from '../../features/social/screens';

export default function PublicProfileRoute() {
  const { username } = useLocalSearchParams<{ username: string }>();
  return <PublicProfileScreen username={username} />;
}
