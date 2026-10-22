import { useLocalSearchParams } from 'expo-router';

import { ResetPasswordScreen } from '../features/auth/links';

/** Opened from the password reset email: /reset-password?token=… */
export default function ResetPasswordRoute() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  return <ResetPasswordScreen token={token} />;
}
