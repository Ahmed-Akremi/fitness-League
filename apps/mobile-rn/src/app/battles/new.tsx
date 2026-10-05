import { useLocalSearchParams } from 'expo-router';

import { NewBattleScreen } from '../../features/battles/screens';

export default function NewBattleRoute() {
  const { opponent } = useLocalSearchParams<{ opponent?: string }>();
  return <NewBattleScreen opponentId={opponent} />;
}
