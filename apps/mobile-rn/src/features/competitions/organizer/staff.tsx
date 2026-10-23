import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { SectionHeader } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Card, Chip, ListGroup, ListRow, Screen, SwitchRow, TextField, Txt } from '../../../core/widgets/kit';
import { useRefreshCompetition } from './api';
import { LocalBadge } from './local-badge';
import { parseLines, staffFilter, staffStats, type StaffStatus } from './logic-people';
import { OrgPageHeader } from './page';
import { useLocalList } from './roster';

const STATUSES: StaffStatus[] = ['PENDING', 'APPROVED', 'DECLINED'];

/** Phase 5: staff application forms (roles, shifts), the applications, approval and check-in. Kept on the device for now. */
export function StaffTab({ c }: { c: Json }) {
  const t = useT();
  const api = useApi();
  const { colors } = useTheme();
  const refresh = useRefreshCompetition();
  const forms = useLocalList(c.id, 'staff-forms');
  const apps = useLocalList(c.id, 'staff-applications');
  const [title, setTitle] = useState('');
  const [roles, setRoles] = useState('');
  const [shifts, setShifts] = useState('');
  const [role, setRole] = useState<string | null>(null);
  const [status, setStatus] = useState<StaffStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const all = apps.data ?? [];
  const shown = staffFilter(all, { role, status });
  const stats = staffStats(all);
  const allRoles = [...new Set((forms.data ?? []).flatMap((f) => f.roles ?? []))];

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  const createForm = () =>
    act(async () => {
      await api.post(`/competitions/${c.id}/staff-forms`, { title: title.trim(), roles: parseLines(roles), shifts: parseLines(shifts) });
      setTitle('');
      setRoles('');
      setShifts('');
    });
  const setApp = (id: string, patch: Json) => act(() => api.put(`/competitions/${c.id}/staff-applications/${id}`, patch));
  const statusLabel = (s: StaffStatus) => t(`staffStatus${s}`);

  return (
    <>
      <OrgPageHeader tab="staff" />
      <Screen>
        <View style={{ alignSelf: 'flex-start' }}>
          <LocalBadge />
        </View>
        <Txt testID="staff-stats" style={{ fontWeight: '700' }}>{t('staffStats', { total: stats.total, approved: stats.approved, pending: stats.pending, declined: stats.declined, checkedIn: stats.checkedIn })}</Txt>

        <SectionHeader title={t('staffForms')} />
        {(forms.data ?? []).map((f) => (
          <Card key={f.id} testID={`staff-form-${f.id}`} style={{ gap: space.xs }}>
            <Txt style={{ fontWeight: '700' }}>{f.title}</Txt>
            <Txt variant="small" color={colors.outline}>{[...(f.roles ?? []), ...(f.shifts ?? [])].join(' · ')}</Txt>
            <Button testID={`staff-form-open-${f.id}`} kind="text" label={t('staffFormOpen')} onPress={() => router.push(`/competitions/${c.id}/staff-apply?form=${f.id}`)} />
          </Card>
        ))}
        <TextField testID="staff-form-title" label={t('staffFormTitle')} value={title} onChangeText={setTitle} maxLength={120} />
        <TextField testID="staff-form-roles" label={t('staffFormRoles')} value={roles} onChangeText={setRoles} multiline />
        <TextField testID="staff-form-shifts" label={t('staffFormShifts')} value={shifts} onChangeText={setShifts} multiline />
        <Button testID="staff-form-save" kind="outlined" label={t('staffFormCreate')} busy={busy} disabled={!title.trim() || parseLines(roles).length === 0} onPress={createForm} />

        <SectionHeader title={t('staffApplications')} />
        <Button testID="staff-refresh" kind="text" label={t('staffRefresh')} onPress={() => void refresh()} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Chip testID="staff-filter-role-all" label={t('staffAll')} selected={!role} onPress={() => setRole(null)} />
          {allRoles.map((r) => (
            <Chip key={r} testID={`staff-filter-role-${r}`} label={r} selected={role === r} onPress={() => setRole(r)} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Chip testID="staff-filter-status-all" label={t('staffAll')} selected={!status} onPress={() => setStatus(null)} />
          {STATUSES.map((s) => (
            <Chip key={s} testID={`staff-filter-status-${s}`} label={statusLabel(s)} selected={status === s} onPress={() => setStatus(s)} />
          ))}
        </View>
        {shown.length === 0 ? (
          <Txt color={colors.outline}>{t('staffEmpty')}</Txt>
        ) : (
          <ListGroup>
            {shown.map((a) => (
              <View key={a.id} testID={`staff-app-${a.id}`} style={{ padding: space.sm, gap: space.xs }}>
                <ListRow title={a.name} subtitle={[a.role, a.email, statusLabel(a.status), ...(a.shifts ?? [])].join(' · ')} />
                <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
                  {a.status !== 'APPROVED' && <Button testID={`staff-approve-${a.id}`} kind="tonal" label={t('staffApprove')} onPress={() => setApp(a.id, { status: 'APPROVED' })} />}
                  {a.status !== 'DECLINED' && <Button testID={`staff-decline-${a.id}`} kind="text" label={t('staffDecline')} onPress={() => setApp(a.id, { status: 'DECLINED', checkedIn: false })} />}
                </View>
                {a.status === 'APPROVED' && <SwitchRow testID={`staff-checkin-${a.id}`} title={t('staffCheckin')} value={a.checkedIn === true} onChange={(on) => setApp(a.id, { checkedIn: on })} />}
              </View>
            ))}
          </ListGroup>
        )}
        <ErrorText error={error} />
      </Screen>
    </>
  );
}
