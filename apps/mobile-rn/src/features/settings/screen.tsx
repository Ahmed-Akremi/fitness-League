import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../core/api/client';
import { setAuthStatus } from '../../core/auth/session';
import type { Locale } from '../../core/i18n';
import { useLocale, usePrefs, useT, type ThemeMode } from '../../core/prefs';
import { useApi } from '../../core/services';
import { space, useTheme } from '../../core/theme';
import { SectionHeader } from '../../core/widgets/common';
import { errorMessage } from '../../core/widgets/error';
import { Dialog, IconButton, ListGroup, ListRow, Screen, Segmented, SwitchRow, toast } from '../../core/widgets/kit';
import { Select } from '../../core/widgets/pickers';
import { useAuth } from '../auth/api';
import { meApi, meKey, useMe } from '../me/api';

/** Settings: preferences (language, theme, training days), notifications, privacy, data export, account deletion, sign out. */
export function SettingsScreen() {
  const t = useT();
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
      <ListGroup>
        <ListRow icon="download" title={t('exportData')} onPress={exportData} />
        <ListRow icon="delete-forever" danger title={t('deleteAccount')} onPress={() => setDeleting(true)} />
        <ListRow testID="logout" icon="logout" title={t('logout')} onPress={() => auth.logout()} />
      </ListGroup>
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

export function PreferencesSection() {
  const t = useT();
  const api = useApi();
  const qc = useQueryClient();
  const locale = useLocale();
  const themeMode = usePrefs((s) => s.themeMode);
  const planned = useMe().data?.profile?.plannedTrainingDaysPerWeek ?? 3;
  return (
    <View style={{ gap: 12 }}>
      <Select
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
      <Segmented<ThemeMode>
        value={themeMode}
        onChange={(m) => usePrefs.getState().setThemeMode(m)}
        options={[
          { key: 'dark', label: t('themeDark') },
          { key: 'light', label: t('themeLight') },
          { key: 'system', label: t('themeSystem') },
        ]}
      />
      <Select
        label={t('trainingDaysPerWeek')}
        value={String(planned)}
        options={[1, 2, 3, 4, 5, 6].map((d) => ({ value: String(d), label: String(d) }))}
        onChange={async (v) => {
          await meApi(api).updateProfile({ plannedTrainingDaysPerWeek: Number(v) }).catch((e) => toast(errorMessage(t, e)));
          await qc.invalidateQueries({ queryKey: meKey });
        }}
      />
    </View>
  );
}

/** Privacy switches saved with PATCH /me/settings (optimistic, rolled back on error). */
export function PrivacySection() {
  const t = useT();
  const api = useApi();
  const settings: Json = useMe().data?.settings ?? {};
  const [overrides, setOverrides] = useState<Json>({});
  const value = (k: string) => (k in overrides ? overrides[k] : settings[k]);

  async function set(key: string, v: unknown) {
    const had = key in overrides;
    const previous = overrides[key];
    setOverrides((o) => ({ ...o, [key]: v }));
    try {
      await meApi(api).updateSettings({ [key]: v });
    } catch (e) {
      setOverrides((o) => {
        const next = { ...o };
        if (had) next[key] = previous;
        else delete next[key];
        return next;
      });
      toast(errorMessage(t, e));
    }
  }

  return (
    <View style={{ gap: space.md }}>
      <Select
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
    </View>
  );
}

const CATEGORIES = ['SOCIAL', 'BATTLES', 'COMPETITION', 'CHALLENGES', 'BADGES', 'GYM'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Push switches per category and quiet hours (the in-app list always keeps everything). */
export function NotificationSettingsSection() {
  const t = useT();
  const api = useApi();
  const loaded = useQuery({ queryKey: ['notification-prefs'], queryFn: () => api.get<Json>('/me/notification-preferences') });
  const [saved, setSaved] = useState<Json | null>(null);
  const [editing, setEditing] = useState<'start' | 'end' | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const prefs = saved ?? loaded.data;
  const { colors } = useTheme();

  async function save(body: Json) {
    try {
      setSaved(await api.put<Json>('/me/notification-preferences', body));
    } catch (e) {
      toast(errorMessage(t, e));
    }
  }

  if (!prefs) return null;
  const categories: Json = prefs.categories ?? {};
  const quiet: Json | null = prefs.quietHours ?? null;
  const label = (c: string) =>
    c === 'SOCIAL' ? t('pushSocial') : c === 'BATTLES' ? t('pushBattles') : c === 'COMPETITION' ? t('gymWars') : c === 'CHALLENGES' ? t('challenges') : c === 'BADGES' ? t('badges') : t('pushGym');

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
          onPress={() => setEditing('start')}
          trailing={quiet == null ? null : <IconButton icon="close" label={t('delete')} color={colors.outline} onPress={() => save({ quietHours: null })} />}
        />
      </ListGroup>
      {/* Quiet hours: start then end, typed as HH:MM (24 h). */}
      <Dialog
        visible={editing != null}
        title={t('quietHours')}
        input={{ label: editing === 'end' ? '→ HH:MM' : 'HH:MM →', initial: editing === 'end' ? quiet?.end ?? '07:00' : quiet?.start ?? '22:00', valid: (s) => HHMM.test(s.trim()), testID: 'quiet-input' }}
        confirmLabel={editing === 'start' ? t('continueLabel') : t('save')}
        cancelLabel={t('cancel')}
        onCancel={() => setEditing(null)}
        onConfirm={(text) => {
          if (editing === 'start') {
            setStart(text.trim());
            setEditing('end');
          } else {
            setEditing(null);
            void save({ quietHours: { start, end: text.trim() } });
          }
        }}
      />
    </View>
  );
}
