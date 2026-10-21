import { useLocalSearchParams } from 'expo-router';

import { JudgeLaneScreen } from '../../../../features/competitions/judge/screens';

export default function CompetitionJudgeLaneRoute() {
  const { id, heatId } = useLocalSearchParams<{ id: string; heatId: string }>();
  return <JudgeLaneScreen id={id} heatId={heatId} />;
}
