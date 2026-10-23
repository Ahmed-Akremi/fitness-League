import { useLocalSearchParams } from 'expo-router';

import { DisplayScreen } from '../../../features/competitions/displays/screens';

export default function DisplayRoute() {
  const { id, kind, ...params } = useLocalSearchParams<{ id: string; kind: string; [key: string]: string }>();
  return <DisplayScreen id={id} kind={kind} params={params} />;
}
