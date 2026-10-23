import { useLocalSearchParams } from 'expo-router';

import { JudgeRaceScreen } from '../../../../features/competitions/judge/race';

export default function CompetitionJudgeRaceRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <JudgeRaceScreen id={id} />;
}
