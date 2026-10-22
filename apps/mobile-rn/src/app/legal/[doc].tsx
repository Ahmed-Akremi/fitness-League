import { useLocalSearchParams } from 'expo-router';

import { LegalDocScreen } from '../../features/legal/screens';

export default function LegalDocRoute() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  return <LegalDocScreen id={doc} />;
}
