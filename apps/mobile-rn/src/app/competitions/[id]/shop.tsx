import { useLocalSearchParams } from 'expo-router';

import { PublicShopScreen } from '../../../features/competitions/organizer/shop';

export default function CompetitionShopRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PublicShopScreen id={id} />;
}
