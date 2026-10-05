import { useLocalSearchParams } from 'expo-router';

import { SubmitScreen } from '../../../../../features/competitions/screens';

export default function CompetitionSubmitRoute() {
  const { id, wodId } = useLocalSearchParams<{ id: string; wodId: string }>();
  return <SubmitScreen id={id} wodId={wodId} />;
}
