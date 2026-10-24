import { useLocalSearchParams } from 'expo-router';

import { AppealScreen } from '../../../../../features/competitions/appeal';

export default function CompetitionAppealRoute() {
  const { id, wodId } = useLocalSearchParams<{ id: string; wodId: string }>();
  return <AppealScreen id={id} wodId={wodId} />;
}
