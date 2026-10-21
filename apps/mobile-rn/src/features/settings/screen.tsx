import DateTimePicker from '@react-native-community/datetimepicker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import type { Json } from '../../core/api/client';
import { setAuthStatus } from '../../core/auth/session';
import type { Locale } from '../../core/i18n';
import { useLocale, usePrefs, useT, type ThemeMode } from '../../core/prefs';
import { useApi } from '../../core/services';
import { space, useTheme } from '../../core/theme';
import { SectionHeader } from '../../core/widgets/common';
import { ErrorText, errorMessage } from '../../core/widgets/error';
import { Button, Dialog, IconButton, ListGroup, ListRow, Screen, Segmented, SwitchRow, Txt, toast } from '../../core/widgets/kit';
import { FieldButton, Select } from '../../core/widgets/pickers';
import { authApi, useAuth } from '../auth/api';
import { LEGAL_DOCS, legalDoc } from '../legal/content';
import { meApi, meKey, useMe } from '../me/api';

/**
 * Settings: preferences (language, theme, training days), notifications, privacy, account (email, password, data
 * export, deletion, sign out), legal documents, app version.
 */
export function SettingsScreen() {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const auth = useAuth();
  const [deleting, setDeleting] = useState(false);

  async function exportData() {
    try {
      const data = await meApi(api).exportData();
      toast(`${t('exportData')}: ${((data.workouts as unknown[]) ?? []).length} workouts`);
    } catch (e) {
      toast(errorMessage(t, e));
    }
  }

  async function deleteAccount(password: string) {
    setDeleting(false);
    try {
      await meApi(api).deleteAccount(password);
      await api.clearSession();
      setAuthStatus('signedOut');
    } catch (e) {
      toast(errorMessage(t, e));
    }
  }

  return (
    <Screen>
      <SectionHeader title={t('preferences')} />
      <PreferencesSection />
      <SectionHeader title={t('notifications')} />
      <NotificationSettingsSection />
      <SectionHeader title={t('privacy')} />
      <PrivacySection />
      <SectionHeader title={t('account')} />
      <AccountSection />
      <ListGroup>
        <ListRow icon="download" title={t('exportData')} onPress={exportData} />
        <ListRow icon="delete-forever" danger title={t('deleteAccount')} onPress={() => setDeleting(true)} />
        <ListRow testID="logout" icon="logout" title={t('logout')} onPress={() => auth.logout()} />
      </ListGroup>
      <SectionHeader title={t('legalTitle')} />
      <LegalSection />
      <SectionHeader title={t('aboutApp')} />
      <Txt testID="app-version" color={colors.outline}>{t('appVersionLabel', { version: Constants.expoConfig?.version ?? '—' })}</Txt>
      <Dialog
        visible={deleting}
        title={t('deleteAccount')}
        message={t('deleteAccountWarning')}
        input={{ label: t('password'), secure: true, testID: 'delete-password' }}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        destructive
        onCancel={() => setDeleting(false)}
        onConfirm={deleteAccount}
      />
    </Screen>
  );
}

/** The account's email and whether it is verified; « change the password » mails a reset link to it. */
export function AccountSection() {
  const t = useT();
  const api = useApi();
  const me = useMe().data;
  const { colors } = useTheme();
  const [error, setError] = useState<unknown>(null);
  if (!me) return null;
  const verified = me.emailVerified === true;
  const email: string | undefined = me.email;

  async function call(fn: () => Promise<unknown>, done: string) {
    setError(null);
    try {
      await fn();
      toast(done);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <View style={{ gap: space.sm }}>
      <ListGroup>
        <ListRow
          testID="account-email"
          icon={verified ? 'mark-email-read' : 'mark-email-unread'}
          title={email ?? '—'}
          subtitle={verified ? t('emailVerifiedLabel') : t('emailUnverifiedLabel')}
          trailing={verified ? null : <Button testID="account-resend" kind="text" label={t('resendEmail')} onPress={() => call(() => authApi(api).resendVerification(), t('verifyEmailResent'))} />}
        />
        <ListRow testID="account-password" icon="lock-reset" title={t('changePassword')} subtitle={t('changePasswordHint')} onPress={email ? () => call(() => authApi(api).forgotPassword(email), t('changePasswordSent', { email })) : undefined} />
      </ListGroup>
      <ErrorText testID="account-error" error={error} />
      {verified ? null : <Txt variant="small" color={colors.outline}>{t('emailNotVerified')}</Txt>}
    </View>
  );
}

/** Terms, privacy policy and health data, readable at any time. */
export function LegalSection() {
  const t = useT();
  const locale = useLocale();
  return (
    <ListGroup>
      {LEGAL_DOCS.map((id) => (
        <ListRow key={id} testID={`settings-legal-${id}`} icon="description" title={legalDoc(id, locale)!.title} chevron onPress={() => router.push(`/legal/${id}`)} />
      ))}
    </ListGroup>
  );
}

export function PreferencesSection() {
  const t = useT();
  const api = useApi();
  const qc = useQueryClient();
  const locale = useLocale();
  const themeMode = usePrefs((s) => s.themeMode);
  const planned = useMe().data?.profile?.plannedTrainingDaysPerWeek ?? 3;
  const [error, setError] = useState<unknown>(null);
  return (
    <View style={{ gap: 12 }}>
      <Select
        menu
        testID="settings-language"
        label={t('language')}
        value={locale}
        options={[
          { value: 'fr', label: 'Français' },
          { value: 'en', label: 'English' },
          { value: 'ar', label: 'العربية' },
        ]}
        onChange={(v) => {
          usePrefs.getState().setLocale(v as Locale);
          api.language = v;
          meApi(api).updateSettings({ locale: v }).catch(() => {});
        }}
      />
      {/* Phones follow the system appearance; the web keeps its switch. */}
      {Platform.OS === 'web' && (
        <Segmented<ThemeMode> flush
          value={themeMode}
          onChange={(m) => usePrefs.getState().setThemeMode(m)}
          options={[
            { key: 'dark', label: t('themeDark') },
            { key: 'light', label: t('themeLight') },
            { key: 'system', label: t('themeSystem') },
          ]}
        />
      )}
      <Select
        menu
        testID="settings-days"
        label={t('trainingDaysPerWeek')}
        value={String(planned)}
        options={[1, 2, 3, 4, 5, 6].map((d) => ({ value: String(d), label: String(d) }))}
        onChange={async (v) => {
          setError(null);
          await meApi(api).updateProfile({ plannedTrainingDaysPerWeek: Number(v) }).catch(setError);
          await qc.invalidateQueries({ queryKey: meKey });
        }}
      />
      {/* Save errors stay under their section: a toast would vanish before it is read (HIG Cognitive). */}
      <ErrorText testID="preferences-error" error={error} />
    </View>
  );
}

/** Privacy switches saved with PATCH /me/settings (optimistic, rolled back on error). */
export function PrivacySection() {
  const t = useT();
  const api = useApi();
  const settings: Json = useMe().data?.settings ?? {};
  const [overrides, setOverrides] = useState<Json>({});
  const [error, setError] = useState<unknown>(null);
  const value = (k: string) => (k in overrides ? overrides[k] : settings[k]);

  async function set(key: string, v: unknown) {
    const had = key in overrides;
    const previous = overrides[key];
    setOverrides((o) => ({ ...o, [key]: v }));
    setError(null);
    try {
      await meApi(api).updateSettings({ [key]: v });
    } catch (e) {
      setOverrides((o) => {
        const next = { ...o };
        if (had) next[key] = previous;
        else delete next[key];
        return next;
      });
      setError(e);
    }
  }

  return (
    <View style={{ gap: space.md }}>
      <Select
        menu
        label={t('workoutVisibility')}
        value={value('defaultVisibility') ?? 'FRIENDS'}
        options={[
          { value: 'PUBLIC', label: t('visibilityPublic') },
          { value: 'FRIENDS', label: t('visibilityFriends') },
          { value: 'PRIVATE', label: t('visibilityPrivate') },
        ]}
        onChange={(v) => set('defaultVisibility', v)}
      />
      <ListGroup inset={space.sm}>
        <SwitchRow title={t('showAgeBracket')} value={value('showAgeBracket') === true} onChange={(v) => set('showAgeBracket', v)} />
        <SwitchRow title={t('showOnLeaderboards')} value={value('showOnLeaderboards') !== false} onChange={(v) => set('showOnLeaderboards', v)} />
      </ListGroup>
      <ErrorText testID="privacy-error" error={error} />
    </View>
  );
}

const CATEGORIES = ['SOCIAL', 'BATTLES', 'COMPETITION', 'CHALLENGES', 'BADGES', 'GYM'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const pad = (n: number) => String(n).padStart(2, '0');
const toHHMM = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fromHHMM = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return new Date(2000, 0, 1, h, m);
};

/** Push switches per category and quiet hours (the in-app list always keeps everything). */
export function NotificationSettingsSection() {
  const t = useT();
  const api = useApi();
  const loaded = useQuery({ queryKey: ['notification-prefs'], queryFn: () => api.get<Json>('/me/notification-preferences') });
  const [saved, setSaved] = useState<Json | null>(null);
  const [editing, setEditing] = useState<'start' | 'end' | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => fromHHMM('22:00'));
  const [androidPicker, setAndroidPicker] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const prefs = saved ?? loaded.data;
  const { colors } = useTheme();

  async function save(body: Json) {
    setError(null);
    try {
      setSaved(await api.put<Json>('/me/notification-preferences', body));
    } catch (e) {
      setError(e);
    }
  }

  if (!prefs) return null;
  const categories: Json = prefs.categories ?? {};
  const quiet: Json | null = prefs.quietHours ?? null;
  const label = (c: string) =>
    c === 'SOCIAL' ? t('pushSocial') : c === 'BATTLES' ? t('pushBattles') : c === 'COMPETITION' ? t('gymWars') : c === 'CHALLENGES' ? t('challenges') : c === 'BADGES' ? t('badges') : t('pushGym');

  function edit(step: 'start' | 'end') {
    setDraft(fromHHMM(step === 'end' ? quiet?.end ?? '07:00' : quiet?.start ?? '22:00'));
    setEditing(step);
  }
  function confirm(hhmm: string) {
    if (editing === 'start') {
      setStart(hhmm);
      edit('end');
    } else {
      setEditing(null);
      void save({ quietHours: { start, end: hhmm } });
    }
  }

  return (
    <View>
      <ListGroup inset={space.sm}>
        {CATEGORIES.map((c) => (
          <SwitchRow key={c} testID={`push-${c}`} title={label(c)} value={categories[c] !== false} onChange={(v) => save({ categories: { [c]: v } })} />
        ))}
        <ListRow
          icon="bedtime"
          title={t('quietHours')}
          subtitle={quiet == null ? t('quietHoursOff') : `${quiet.start} – ${quiet.end}`}
          onPress={() => edit('start')}
          trailing={quiet == null ? null : <IconButton icon="close" label={t('delete')} color={colors.outline} onPress={() => save({ quietHours: null })} />}
        />
      </ListGroup>
      <ErrorText testID="notifications-error" error={error} />
      {/* Quiet hours: start then end, picked on a 24-hour clock (HIG: offer choices, not text entry); stored as HH:MM.
          The browser has no time picker: it keeps the HH:MM text field. */}
      <Dialog
        visible={editing != null}
        title={t('quietHours')}
        message={editing === 'end' ? t('quietHoursEnd') : t('quietHoursStart')}
        input={Platform.OS === 'web' ? { label: editing === 'end' ? t('quietHoursEnd') : t('quietHoursStart'), initial: toHHMM(draft), valid: (s) => HHMM.test(s.trim()), testID: 'quiet-input' } : undefined}
        confirmLabel={editing === 'start' ? t('continueLabel') : t('save')}
        cancelLabel={t('cancel')}
        onCancel={() => setEditing(null)}
        onConfirm={(text) => confirm(Platform.OS === 'web' ? text.trim() : toHHMM(draft))}
      >
        {Platform.OS === 'ios' && <DateTimePicker testID="quiet-picker" mode="time" display="spinner" locale="en_GB" value={draft} onChange={(_, d) => d && setDraft(d)} />}
        {Platform.OS === 'android' && (
          <>
            <FieldButton testID="quiet-time" label={editing === 'end' ? t('quietHoursEnd') : t('quietHoursStart')} bare value={toHHMM(draft)} icon="schedule" onPress={() => setAndroidPicker(true)} />
            {androidPicker && (
              <DateTimePicker
                testID="quiet-picker"
                mode="time"
                is24Hour
                value={draft}
                onChange={(e, d) => {
                  setAndroidPicker(false);
                  if (e.type === 'set' && d) setDraft(d);
                }}
              />
            )}
          </>
        )}
      </Dialog>
    </View>
  );
}
