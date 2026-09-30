import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ApiError } from '../../core/api/errors';
import { config } from '../../core/config';
import { useLocale, useT } from '../../core/prefs';
import { displayText, useTheme } from '../../core/theme';
import { localized } from '../../core/utils/format';
import { Loading } from '../../core/widgets/common';
import { ErrorText, ErrorView } from '../../core/widgets/error';
import { Button, Checkbox, Icon, Screen, TextField, Txt } from '../../core/widgets/kit';
import { DateField, Select } from '../../core/widgets/pickers';
import { useCities, useGovernorates } from '../reference/api';
import { useAuth } from './api';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function LoginScreen() {
  const t = useT();
  const { colors } = useTheme();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const emailError = submitted && !email.includes('@') ? t('invalidEmail') : null;
  const passwordError = submitted && !password ? t('required') : null;

  async function submit() {
    setSubmitted(true);
    if (!email.includes('@') || !password) return;
    setBusy(true);
    setError(null);
    try {
      await auth.login(email.trim(), password);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center', gap: 12, paddingTop: 32 }}>
        <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="bolt" size={40} color="#0E0F12" />
        </View>
        <Txt style={[displayText(36), { color: colors.primary, marginTop: 8 }]}>{config.appName.toUpperCase()}</Txt>
        <Txt color={colors.outline} style={{ fontSize: 16, marginBottom: 28 }}>{t('appTagline')}</Txt>
        <TextField testID="login-email" label={t('email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" error={emailError} />
        <TextField testID="login-password" label={t('password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" error={passwordError} onSubmitEditing={submit} />
        <ErrorText error={error} />
        <Button testID="login-submit" label={t('login')} onPress={submit} busy={busy} style={{ marginTop: 12 }} />
        <Button kind="text" label={t('forgotPassword')} onPress={() => router.push('/forgot-password')} />
        <Button kind="text" label={t('noAccount')} onPress={() => router.push('/register')} />
      </View>
    </Screen>
  );
}

/** Password reset request. Always shows the same confirmation, whatever the account state (no enumeration). */
export function ForgotPasswordScreen() {
  const t = useT();
  const { colors } = useTheme();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const valid = EMAIL.test(email.trim());

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await auth.forgotPassword(email.trim());
      setSent(true);
    } catch (e) {
      // Only a network problem is worth showing; any server answer gets the neutral confirmation.
      if (e instanceof ApiError && e.status == null) setError(e);
      else setSent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      {sent ? (
        <View style={{ alignItems: 'center', gap: 16, paddingTop: 24 }}>
          <Icon name="mark-email-read" size={64} color={colors.primary} />
          <Txt variant="title" style={{ textAlign: 'center', fontWeight: '500' }}>{t('resetLinkSent')}</Txt>
        </View>
      ) : (
        <>
          <TextField testID="forgot-email" label={t('email')} icon="alternate-email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <ErrorText error={error} />
          <Button testID="forgot-submit" label={t('sendLink')} onPress={send} busy={busy} disabled={!valid} style={{ marginTop: 8 }} />
        </>
      )}
    </Screen>
  );
}

export function RegisterScreen() {
  const t = useT();
  const { colors } = useTheme();
  const locale = useLocale();
  const auth = useAuth();
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [dob, setDob] = useState<Date | null>(null);
  const [governorateId, setGovernorateId] = useState<string | null>(null);
  const [cityId, setCityId] = useState<string | null>(null);
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [health, setHealth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const govs = useGovernorates();
  const cities = useCities(governorateId);

  const serverField = (field: string) => (error instanceof ApiError && error.fieldCode(field) ? t('errorValidation') : null);
  const errors = {
    username: !/^[a-z0-9_.]{3,20}$/.test(username) ? t('usernameRule') : null,
    fullName: fullName.trim().length < 2 ? t('required') : null,
    email: !email.includes('@') ? t('invalidEmail') : null,
    password: password.length < 10 ? t('passwordTooShort') : null,
    dob: dob == null ? t('required') : null,
    governorate: governorateId == null ? t('required') : null,
    city: cityId == null ? t('required') : null,
  };
  const show = (e: string | null) => (submitted ? e : null);

  async function submit() {
    setSubmitted(true);
    if (Object.values(errors).some(Boolean) || !terms || !privacy) return;
    setBusy(true);
    setError(null);
    try {
      await auth.register({ username: username.trim(), fullName: fullName.trim(), email: email.trim(), password, dateOfBirth: dob!, governorateId: governorateId!, cityId: cityId!, healthDataConsent: health, locale });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const now = new Date();
  return (
    <Screen>
      <TextField testID="reg-username" label={t('username')} placeholder={t('usernameRule')} value={username} onChangeText={setUsername} autoCapitalize="none" error={show(errors.username) ?? serverField('username')} />
      <TextField testID="reg-fullname" label={t('fullName')} value={fullName} onChangeText={setFullName} error={show(errors.fullName)} />
      <TextField testID="reg-email" label={t('email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" error={show(errors.email) ?? serverField('email')} />
      <TextField testID="reg-password" label={t('password')} placeholder={t('passwordTooShort')} value={password} onChangeText={setPassword} secureTextEntry error={show(errors.password)} />
      <DateField
        testID="reg-dob"
        label={t('dateOfBirth')}
        placeholder={t('dateOfBirthHint')}
        value={dob}
        onChange={setDob}
        minimumDate={new Date(now.getFullYear() - 100, 0, 1)}
        maximumDate={now}
        error={show(errors.dob)}
      />
      {govs.isError ? (
        <ErrorView error={govs.error} onRetry={() => govs.refetch()} />
      ) : govs.data ? (
        <Select
          testID="reg-governorate"
          label={t('governorate')}
          value={governorateId}
          options={govs.data.map((g) => ({ value: g.id, label: localized(g.name, locale) }))}
          onChange={(v) => {
            setGovernorateId(v);
            setCityId(null);
          }}
          error={show(errors.governorate)}
        />
      ) : (
        <Loading />
      )}
      {governorateId &&
        (cities.isError ? (
          <ErrorView error={cities.error} />
        ) : cities.data ? (
          <Select testID="reg-city" label={t('city')} value={cityId} options={cities.data.map((c) => ({ value: c.id, label: localized(c.name, locale) }))} onChange={setCityId} error={show(errors.city)} />
        ) : (
          <Loading />
        ))}
      <Checkbox testID="reg-terms" label={t('acceptTerms')} value={terms} onChange={setTerms} />
      {submitted && !terms ? <Txt variant="small" color={colors.error}>{t('required')}</Txt> : null}
      <Checkbox testID="reg-privacy" label={t('acceptPrivacy')} value={privacy} onChange={setPrivacy} />
      {submitted && !privacy ? <Txt variant="small" color={colors.error}>{t('required')}</Txt> : null}
      <Checkbox label={t('acceptHealth')} value={health} onChange={setHealth} />
      <ErrorText error={error} />
      <Button testID="reg-submit" label={t('register')} onPress={submit} busy={busy} style={{ marginTop: 8 }} />
      <Button kind="text" label={t('haveAccount')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))} />
    </Screen>
  );
}
