import { useLocalSearchParams } from 'expo-router';

import { RegisterScreen } from '../../../features/competitions/screens';

export default function CompetitionRegisterRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RegisterScreen id={id} />;
}
