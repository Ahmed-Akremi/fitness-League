import { useLocalSearchParams } from 'expo-router';

import { ChallengeScreen } from '../../features/challenges/screens';

export default function ChallengeRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChallengeScreen id={id} />;
}
