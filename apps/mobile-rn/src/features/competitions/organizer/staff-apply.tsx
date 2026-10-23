import { useState } from 'react';
import { View } from 'react-native';

import { useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { EmptyState, Loading, SectionHeader } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Checkbox, Chip, Screen, TextField, Txt } from '../../../core/widgets/kit';
import { applicationProblems } from './logic-people';
import { useLocalList } from './roster';

/** Phase 5: the public page where volunteers and judges apply to an event's staff form. Kept on the device for now. */
export function StaffApplyScreen({ id, formId }: { id: string; formId: string }) {
  const t = useT();
  const api = useApi();
  const { colors } = useTheme();
  const forms = useLocalList(id, 'staff-forms');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);
  if (forms.isLoading) return <Loading />;
  const form = (forms.data ?? []).find((f) => f.id === formId);
  if (!form) return <EmptyState icon="assignment" message={t('applyNoForm')} />;
  if (sent) return <EmptyState icon="check-circle" message={t('applyDone')} />;
  const problems = applicationProblems({ name, email, role }, { roles: form.roles ?? [] });

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/competitions/${id}/staff-applications`, { formId, name: name.trim(), email: email.trim().toLowerCase(), role, shifts: picked, status: 'PENDING', checkedIn: false });
      setSent(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Txt variant="title">{form.title}</Txt>
      <Txt color={colors.outline}>{t('applyTitle')}</Txt>
      <TextField testID="apply-name" label={t('applyName')} value={name} onChangeText={setName} maxLength={120} />
      <TextField testID="apply-email" label={t('applyEmail')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <SectionHeader title={t('applyRole')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {(form.roles ?? []).map((r: string) => (
          <Chip key={r} testID={`apply-role-${r}`} label={r} selected={role === r} onPress={() => setRole(r)} />
        ))}
      </View>
      {(form.shifts ?? []).length > 0 && <SectionHeader title={t('applyShifts')} />}
      {(form.shifts ?? []).map((s: string, i: number) => (
        <Checkbox key={s} testID={`apply-shift-${i}`} label={s} value={picked.includes(s)} onChange={(on) => setPicked(on ? [...picked, s] : picked.filter((x) => x !== s))} />
      ))}
      <ErrorText error={error} />
      <Button testID="apply-send" label={t('applySend')} busy={busy} disabled={problems.length > 0} onPress={send} />
    </Screen>
  );
}
