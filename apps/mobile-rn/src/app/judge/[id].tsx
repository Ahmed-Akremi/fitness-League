import { useLocalSearchParams } from 'expo-router';

import { JudgeReviewScreen } from '../../features/competitions/judge';

export default function JudgeReviewRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <JudgeReviewScreen id={id} />;
}
