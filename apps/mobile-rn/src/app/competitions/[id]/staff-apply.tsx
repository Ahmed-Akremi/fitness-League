import { useLocalSearchParams } from 'expo-router';

import { StaffApplyScreen } from '../../../features/competitions/organizer/staff-apply';

export default function StaffApplyRoute() {
  const { id, form } = useLocalSearchParams<{ id: string; form: string }>();
  return <StaffApplyScreen id={id} formId={form} />;
}
