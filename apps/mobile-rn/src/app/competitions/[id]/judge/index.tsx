import { useLocalSearchParams } from 'expo-router';

import { JudgeHomeScreen } from '../../../../features/competitions/judge/screens';

export default function CompetitionJudgeRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <JudgeHomeScreen id={id} />;
}
