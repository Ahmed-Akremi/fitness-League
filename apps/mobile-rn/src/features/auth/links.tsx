import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { ApiError } from '../../core/api/errors';
import { setAuthStatus, useSession } from '../../core/auth/session';
import { useT } from '../../core/prefs';
import { useApi } from '../../core/services';
import { space, useTheme } from '../../core/theme';
import { Loading } from '../../core/widgets/common';
import { ErrorText } from '../../core/widgets/error';
import { Button, Icon, Screen, TextField, Txt, type IconName } from '../../core/widgets/kit';
import { meKey } from '../me/api';
import { authApi } from './api';

/** The API answers an unknown, used or expired link with 422 TOKEN_INVALID. */
const invalidLink = (e: unknown) => e instanceof ApiError && (e.code === 'TOKEN_INVALID' || e.status === 422 || e.status === 400);

/** Same minimum as registration and the API (10 characters). */
export const PASSWORD_MIN = 10;

function Outcome({ icon, color, title, message, children }: { icon: IconName; color: string; title: string; message?: string; children?: React.ReactNode }) {
  return (
    <View style={{ alignItems: 'center', gap: space.md, paddingTop: space.xl }}>
      <Icon name={icon} size={64} color={color} />
      <Txt variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>{title}</Txt>
      {message ? <Txt style={{ textAlign: 'center' }}>{message}</Txt> : null}
      <View style={{ alignSelf: 'stretch', gap: space.sm }}>{children}</View>
    </View>
  );
}

/**
 * /verify-email?token=… (the link of the verification email). Checks the link once on opening; works signed in
 * (the profile is read again so the « email not verified » banner goes) or signed out.
 */
export function VerifyEmailScreen({ token }: { token?: string }) {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const signedIn = useSession((s) => s.status === 'signedIn');
  const [state, setState] = useState<'checking' | 'done' | 'invalid' | 'error'>(token ? 'checking' : 'invalid');
  const [error, setError] = useState<unknown>(null);
  const [resent, setResent] = useState(false);
  const started = useRef(false);

  async function check() {
    if (!token) return;
    setState('checking');
    setError(null);
    try {
      await authApi(api).verifyEmail(token);
      setState('done');
      if (signedIn) await qc.invalidateQueries({ queryKey: meKey });
    } catch (e) {
      if (invalidLink(e)) setState('invalid');
      else {
        setError(e);
        setState('error');
      }
    }
  }

  useEffect(() => {
    // Once: a link is single use, a second call would answer « invalid ».
    if (started.current) return;
    started.current = true;
    void check();
  }, []);

  const next = signedIn ? (
    <Button testID="verify-continue" label={t('continueLabel')} onPress={() => router.replace('/')} />
  ) : (
    <Button testID="verify-login" label={t('login')} onPress={() => router.replace('/login')} />
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: t('verifyEmailTitle') }} />
      {state === 'checking' ? (
        <View style={{ paddingTop: space.xl, gap: space.md, alignItems: 'center' }}>
          <Loading />
          <Txt>{t('verifyEmailChecking')}</Txt>
        </View>
      ) : state === 'done' ? (
        <Outcome icon="mark-email-read" color={colors.success} title={t('verifyEmailDone')} message={t('verifyEmailDoneBody')}>
          {next}
        </Outcome>
      ) : state === 'invalid' ? (
        <Outcome icon="link-off" color={colors.error} title={t('linkInvalid')} message={signedIn ? t('verifyEmailInvalidSignedIn') : t('verifyEmailInvalidSignedOut')}>
          {signedIn ? (
            resent ? (
              <Txt testID="verify-resent" color={colors.primary} style={{ textAlign: 'center' }}>{t('verifyEmailResent')}</Txt>
            ) : (
              <Button testID="verify-resend" label={t('resendEmail')} onPress={() => authApi(api).resendVerification().then(() => setResent(true), setError)} />
            )
          ) : null}
          <ErrorText error={error} />
          {next}
        </Outcome>
      ) : (
        <Outcome icon="cloud-off" color={colors.error} title={t('verifyEmailTitle')}>
          <ErrorText error={error} />
          <Button testID="verify-retry" label={t('retry')} onPress={check} />
        </Outcome>
      )}
    </Screen>
  );
}

/**
 * /reset-password?token=… (the link of the reset email): a new password, typed twice. Every session ends with
 * the reset, so a signed-in phone signs out and goes to the login screen.
 */
export function ResetPasswordScreen({ token }: { token?: string }) {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const signedIn = useSession((s) => s.status === 'signedIn');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'form' | 'done' | 'invalid'>(token ? 'form' : 'invalid');
  const [error, setError] = useState<unknown>(null);
  const tooShort = password.length > 0 && password.length < PASSWORD_MIN;
  const mismatch = confirm.length > 0 && confirm !== password;
  const valid = password.length >= PASSWORD_MIN && confirm === password;

  async function submit() {
    if (!token || !valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await authApi(api).resetPassword(token, password);
      if (signedIn) {
        await api.clearSession();
        setAuthStatus('signedOut');
      }
      setState('done');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TOKEN_INVALID') setState('invalid');
      else setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('resetPasswordTitle') }} />
      {state === 'done' ? (
        <Outcome icon="lock-reset" color={colors.success} title={t('resetPasswordDone')} message={t('resetPasswordDoneBody')}>
          <Button testID="reset-login" label={t('login')} onPress={() => router.replace('/login')} />
        </Outcome>
      ) : state === 'invalid' ? (
        <Outcome icon="link-off" color={colors.error} title={t('linkInvalid')} message={t('resetPasswordInvalid')}>
          {signedIn ? null : <Button testID="reset-again" label={t('sendLink')} onPress={() => router.replace('/forgot-password')} />}
        </Outcome>
      ) : (
        <>
          <Txt color={colors.outline}>{t('resetPasswordHint')}</Txt>
          <TextField testID="reset-password" label={t('newPassword')} placeholder={t('passwordTooShort')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" error={tooShort ? t('passwordTooShort') : null} />
          <TextField testID="reset-confirm" label={t('confirmPassword')} value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" error={mismatch ? t('passwordMismatch') : null} onSubmitEditing={submit} />
          <ErrorText error={error} />
          <Button testID="reset-submit" label={t('resetPasswordSubmit')} busy={busy} disabled={!valid} onPress={submit} style={{ marginTop: space.sm }} />
        </>
      )}
    </Screen>
  );
}
