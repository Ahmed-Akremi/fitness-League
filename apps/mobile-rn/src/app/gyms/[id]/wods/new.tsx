import { useLocalSearchParams } from 'expo-router';

import { CreateWodScreen } from '../../../../features/gym-wods/screens';

export default function CreateWodRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CreateWodScreen gymId={id} />;
}
