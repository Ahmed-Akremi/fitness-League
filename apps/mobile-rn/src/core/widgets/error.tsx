import { View } from 'react-native';

import { ApiError } from '../api/errors';
import { useT, type T } from '../prefs';
import { useTheme } from '../theme';
import { Button, Icon, Txt } from './kit';

/** Maps any error to a clear, translated message (spec §19.6: never expose stack traces). */
export function errorMessage(t: T, error: unknown): string {
  if (!(error instanceof ApiError)) return t('errorGeneric');
  switch (error.kind) {
    case 'network':
      return t('errorNetwork');
    case 'timeout':
      return t('errorTimeout');
    case 'server':
      return t('errorServer');
    case 'unauthenticated':
      return error.code === 'INVALID_CREDENTIALS' ? t('errorInvalidCredentials') : t('errorSession');
    case 'client':
      switch (error.code) {
        case 'ACCOUNT_LOCKED':
          return t('errorAccountLocked');
        case 'JUDGE_ACCOUNT':
          return t('errorJudgeAccount');
        case 'UNDER_AGE':
          return t('errorUnderAge', { age: Number(error.extra.minAgeYears ?? 18) });
        case 'EMAIL_TAKEN':
          return t('errorEmailTaken');
        case 'USERNAME_TAKEN':
          return t('errorUsernameTaken');
        case 'RATE_LIMITED':
          return t('errorRateLimited');
        case 'WORKOUT_REJECTED':
          return t('errorWorkoutRejected');
        case 'VALIDATION_FAILED':
          switch (error.fieldErrors[0]?.code) {
            case 'CALIBRATION':
              return t('errorDuelCalibration');
            case 'NO_RECENT_ACTIVITY':
              return t('errorDuelInactive');
            default:
              return t('errorValidation');
          }
        case 'CONFLICT':
          return error.extra.reason === 'QUEUE_CLOSED' ? t('errorDuelQueueClosed') : t('errorGeneric');
        default:
          return t('errorGeneric');
      }
  }
}

export function ErrorText({ error }: { error: unknown }) {
  const t = useT();
  const { colors } = useTheme();
  if (error == null) return null;
  return <Txt color={colors.error}>{errorMessage(t, error)}</Txt>;
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
      <Icon name="cloud-off" size={40} color={colors.outline} />
      <Txt style={{ textAlign: 'center' }}>{errorMessage(t, error)}</Txt>
      {onRetry && <Button kind="outlined" label={t('retry')} onPress={onRetry} />}
    </View>
  );
}
