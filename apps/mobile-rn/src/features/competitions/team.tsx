import { useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../core/api/client';
import { useLocale, useT } from '../../core/prefs';
import { useApi } from '../../core/services';
import { displayText, space, useTheme } from '../../core/theme';
import { formatDate } from '../../core/utils/format';
import { EmptyState, Loading, SectionHeader } from '../../core/widgets/common';
import { ErrorText, ErrorView } from '../../core/widgets/error';
import { Button, Card, Icon, Screen, TextField, Txt, toast, type IconName } from '../../core/widgets/kit';
import { useMe } from '../me/api';
import { compKeys, formatMoney, useCompetition } from './api';
import { teamMemberSlots, teamProblems } from './logic-registration';
import { membersChanged, oneStaysOk, teamRules } from './logic-team';

/**
 * My team (Circle21 « Team / TeamEdit », §3.5): the captain, the team name and the members, changed within the
 * division's deadlines (with the change fee and « one member stays » the organizer set). Kept on the device for now,
 * with the rest of the registration's extras.
 */
export function TeamScreen({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const comp = useCompetition(id);
  const me = useMe();
  const r: Json | null = comp.data?.myRegistration ?? null;
  const [name, setName] = useState<string | null>(null);
  const [members, setMembers] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (comp.isError) return <ErrorView error={comp.error} onRetry={() => comp.refetch()} />;
  if (!comp.data) return <Loading />;
  const c = comp.data;
  const category: Json | undefined = (c.categories ?? []).find((k: Json) => k.id === r?.categoryId);
  if (!r || category?.type !== 'TEAM') return <EmptyState icon="groups" message={t('teamNone')} />;

  const now = Date.now();
  const rules = teamRules(c, now);
  const saved: string[] = r.teamMembers ?? [];
  const slots = teamMemberSlots(category);
  const nameNow = name ?? r.teamName ?? '';
  const list = members ?? Array.from({ length: slots }, (_, i) => saved[i] ?? '');
  const day = (iso: string) => formatDate(iso, locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const myEmail = (me.data?.email ?? '').toLowerCase();
  const self = list.some((m) => m.trim().toLowerCase() === myEmail && myEmail);
  const problems = teamProblems(category, nameNow, list);
  const left = membersChanged(saved, list);
  const keepsOne = !rules.oneStays || oneStaysOk(saved, list);
  const dirty = nameNow.trim() !== (r.teamName ?? '') || left > 0 || list.some((m, i) => m.trim().toLowerCase() !== (saved[i] ?? '').toLowerCase());
  const ok = dirty && problems.length === 0 && !self && keepsOne;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/competitions/${id}/registrations/${r!.id}/team`, { teamName: nameNow.trim(), teamMembers: list });
      await qc.invalidateQueries({ queryKey: compKeys.detail(id) });
      setName(null);
      setMembers(null);
      toast(t('teamSaved'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: t('teamTitle') }} />
      <Screen>
        <View style={{ gap: 4 }}>
          <Txt style={displayText(28)}>{nameNow || t('teamTitle')}</Txt>
          <Txt variant="small" color={colors.outline}>{[c.title, category.name].join(' · ')}</Txt>
        </View>

        <SectionHeader title={t('teamDetails')} />
        <RuleLine icon={rules.name.allowed ? 'edit' : 'lock'} text={rules.name.allowed ? t('teamNameUntil', { date: day(rules.name.until!) }) : t('teamNameClosed')} tone={rules.name.allowed ? colors.outline : colors.warning} />
        <TextField testID="team-name" label={t('teamNameQuestion')} value={nameNow} onChangeText={setName} editable={rules.name.allowed} maxLength={60} />
        {problems.includes('TEAM_NAME') && nameNow.length > 0 ? <Txt variant="small" color={colors.error}>{t('regTeamNameInvalid')}</Txt> : null}

        <SectionHeader title={t('teamMembers')} />
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Icon name="military-tech" color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Txt style={{ fontWeight: '800' }}>{me.data?.profile?.fullName || me.data?.username || '—'}</Txt>
            <Txt variant="small" color={colors.outline}>{t('teamCaptain')}</Txt>
          </View>
        </Card>
        <RuleLine
          icon={rules.members.allowed ? 'group-add' : 'lock'}
          text={rules.members.allowed ? t('teamMembersUntil', { date: day(rules.members.until!) }) : rules.members.until ? t('teamMembersExpired', { date: day(rules.members.until) }) : t('teamMembersFinal')}
          tone={rules.members.allowed ? colors.outline : colors.warning}
        />
        {list.map((m, i) => (
          <TextField
            key={i}
            testID={`team-member-${i}`}
            label={t('teamMember', { number: i + 1 })}
            value={m}
            editable={rules.members.allowed}
            onChangeText={(v) => setMembers(list.map((x, j) => (j === i ? v : x)))}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        ))}
        {self ? <Txt variant="small" color={colors.error}>{t('teamSelf')}</Txt> : null}
        {list.every((m) => m.trim()) && problems.includes('MEMBERS') && !self ? <Txt variant="small" color={colors.error}>{t('regMembersInvalid')}</Txt> : null}
        {!keepsOne ? <Txt variant="small" color={colors.error}>{t('teamOneStays')}</Txt> : null}
        {left > 0 && rules.fee > 0 ? <RuleLine icon="payments" text={t('teamChangeFee', { amount: formatMoney(rules.fee * left, c.currency, locale) })} tone={colors.warning} /> : null}
        <ErrorText error={error} />
      </Screen>
      {rules.name.allowed || rules.members.allowed ? (
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.lg, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Button testID="team-save" icon="check" label={t('teamSave')} busy={busy} disabled={!ok} onPress={save} />
        </View>
      ) : null}
    </View>
  );
}

function RuleLine({ icon, text, tone }: { icon: IconName; text: string; tone: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <Icon name={icon} size={18} color={tone} />
      <Txt variant="small" style={{ flex: 1 }} color={tone}>{text}</Txt>
    </View>
  );
}
