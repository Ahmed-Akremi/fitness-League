import { useLocalSearchParams } from 'expo-router';

import { BattleScreen } from '../../features/battles/screens';

export default function BattleRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <BattleScreen id={id} />;
}
