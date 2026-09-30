import { useLocalSearchParams } from 'expo-router';

import { WorkoutDetailScreen } from '../../features/workouts/screens';

export default function WorkoutDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WorkoutDetailScreen id={id} />;
}
