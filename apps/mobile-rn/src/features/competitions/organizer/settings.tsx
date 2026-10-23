import { useRef, useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { SectionHeader } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Chip, Screen, SwitchRow, TextField, Txt, toast } from '../../../core/widgets/kit';
import { DateField } from '../../../core/widgets/pickers';
import { organizerApi, useRefreshCompetition } from './api';
import { LocalBadge } from './local-badge';
import { parseEmails, settingsBody, settingsDraft, settingsProblems, type SettingsDraft } from './logic-event';
import { OrgPageHeader } from './page';

/** Phase 2: registration and appeal settings of the event. Kept on the device for now (`competition.settings`). */
export function SettingsTab({ c }: { c: Json }) {
  const t = useT();
  const api = useApi();
  const { colors } = useTheme();
  const refresh = useRefreshCompetition();
  const [d, setD] = useState<SettingsDraft>(() => settingsDraft(c));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const sending = useRef(false);
  const problems = settingsProblems(d);
  const set = (patch: Partial<SettingsDraft>) => setD({ ...d, ...patch });
  const has = (p: (typeof problems)[number]) => problems.includes(p);
  const emails = parseEmails(d.emails);

  async function save() {
    if (sending.current || problems.length) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await organizerApi(api).update(c.id, { settings: settingsBody(d) });
      toast(t('orgSaved'));
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const hint = (text: string) => <Txt variant="small" color={colors.error}>{text}</Txt>;
  return (
    <>
      <OrgPageHeader tab="settings" />
      <Screen>
        <View style={{ alignSelf: 'flex-start' }}>
          <LocalBadge />
        </View>

        <SectionHeader title={t('orgSetCount')} />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Chip testID="org-set-count-SHOW" label={t('orgSetCountShow')} selected={d.countVisibility === 'SHOW'} onPress={() => set({ countVisibility: 'SHOW' })} />
          <Chip testID="org-set-count-HIDE" label={t('orgSetCountHide')} selected={d.countVisibility === 'HIDE'} onPress={() => set({ countVisibility: 'HIDE' })} />
        </View>
        <TextField testID="org-set-max-individuals" label={t('orgSetMaxIndividuals')} value={d.maxIndividuals} onChangeText={(v) => set({ maxIndividuals: v })} keyboardType="number-pad" />
        {has('MAX_INDIVIDUALS') && hint(t('orgSetMaxInvalid'))}
        <TextField testID="org-set-max-teams" label={t('orgSetMaxTeams')} value={d.maxTeams} onChangeText={(v) => set({ maxTeams: v })} keyboardType="number-pad" />
        {has('MAX_TEAMS') && hint(t('orgSetMaxInvalid'))}
        <SwitchRow testID="org-set-hide-athletes" title={t('orgSetHideAthletes')} value={d.hideAthletesTab} onChange={(v) => set({ hideAthletesTab: v })} />
        <SwitchRow testID="org-set-coach" title={t('orgSetCoach')} value={d.coachAssignment} onChange={(v) => set({ coachAssignment: v })} />
        <SwitchRow testID="org-set-queue" title={t('orgSetQueue')} value={d.highDemand} onChange={(v) => set({ highDemand: v })} />
        <SwitchRow testID="org-set-notify" title={t('orgSetNotify')} value={d.notifyOnRegistration} onChange={(v) => set({ notifyOnRegistration: v })} />

        <SwitchRow testID="org-set-email-list" title={t('orgSetEmailList')} value={d.restrictToEmailList} onChange={(v) => set({ restrictToEmailList: v })} />
        {d.restrictToEmailList && (
          <>
            <TextField testID="org-set-emails" label={t('orgSetEmails')} value={d.emails} onChangeText={(v) => set({ emails: v })} multiline keyboardType="email-address" autoCapitalize="none" />
            {emails.invalid.length > 0 && hint(t('orgSetEmailsInvalid', { emails: emails.invalid.join(', ') }))}
            {emails.invalid.length === 0 && emails.emails.length === 0 && hint(t('orgSetEmailsEmpty'))}
          </>
        )}
        <TextField testID="org-set-confirmation" label={t('orgSetConfirmation')} value={d.confirmationMessage} onChangeText={(v) => set({ confirmationMessage: v })} multiline maxLength={2000} />

        <SwitchRow
          testID="org-set-appeals"
          title={t('orgSetAppeals')}
          value={d.appealsEnabled}
          onChange={(v) => set({ appealsEnabled: v, appealDeadline: d.appealDeadline ?? (v ? new Date(c.eventEnd) : null) })}
        />
        {d.appealsEnabled && (
          <>
            <TextField testID="org-set-appeal-price" label={t('orgSetAppealPrice')} value={d.appealPrice} onChangeText={(v) => set({ appealPrice: v })} keyboardType="decimal-pad" />
            {has('APPEAL_PRICE') && hint(t('orgSetAppealPriceInvalid'))}
            <TextField testID="org-set-appeal-max" label={t('orgSetAppealMax')} value={d.appealMax} onChangeText={(v) => set({ appealMax: v })} keyboardType="number-pad" />
            {has('APPEAL_MAX') && hint(t('orgSetMaxInvalid'))}
            {d.appealDeadline && <DateField testID="org-set-appeal-deadline" mode="date" label={t('orgSetAppealDeadline')} value={d.appealDeadline} onChange={(v) => set({ appealDeadline: v })} />}
          </>
        )}

        <TextField testID="org-set-neutral" label={t('orgSetNeutral')} value={d.neutral} onChangeText={(v) => set({ neutral: v })} autoCapitalize="characters" />
        <Txt variant="small" color={colors.outline}>{t('orgSetNeutralHint')}</Txt>
        {has('NEUTRAL') && hint(t('orgSetNeutralInvalid'))}

        <ErrorText error={error} />
        <Button testID="org-settings-save" label={t('save')} busy={busy} disabled={problems.length > 0} onPress={save} />
      </Screen>
    </>
  );
}
