import { useLocalSearchParams } from 'expo-router';

import { VerifyEmailScreen } from '../features/auth/links';

/** Opened from the verification email: /verify-email?token=… */
export default function VerifyEmailRoute() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  return <VerifyEmailScreen token={token} />;
}
