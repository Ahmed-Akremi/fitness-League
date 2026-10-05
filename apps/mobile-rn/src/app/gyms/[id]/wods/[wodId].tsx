import { useLocalSearchParams } from 'expo-router';

import { WodScreen } from '../../../../features/gym-wods/screens';

export default function WodRoute() {
  const { id, wodId } = useLocalSearchParams<{ id: string; wodId: string }>();
  return <WodScreen gymId={id} wodId={wodId} />;
}
