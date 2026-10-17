import { useLocalSearchParams } from 'expo-router';

import { ManageScreen } from '../../../features/competitions/organizer/manage';

export default function CompetitionManageRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ManageScreen id={id} />;
}
