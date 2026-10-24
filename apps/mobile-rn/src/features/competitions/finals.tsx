import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../core/api/client';
import { useT } from '../../core/prefs';
import { useApi } from '../../core/services';
import { displayText, radius, space, useTheme } from '../../core/theme';
import { EmptyState } from '../../core/widgets/common';
import { ErrorText } from '../../core/widgets/error';
import { Button, Dialog, Icon, Screen, Txt, toast } from '../../core/widgets/kit';
import { useMe } from '../me/api';
import { myInvitation } from './logic-team';
import { useLocalList } from './organizer/roster';

/**
 * Circle21's « You have a Special Invitation » (§3.4): the organizer invited the top athletes of a qualifier to this
 * final (Roster, phase 5); the athlete accepts, then registers, or declines.
 */
export function FinalsInvitationCard({ c }: { c: Json }) {
  const t = useT();
  const api = useApi();
  const { colors } = useTheme();
  const me = useMe();
  const list = useLocalList(c.id, 'finalist-invitations');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inv = myInvitation(list.data ?? [], me.data?.id);
  if (!inv) return null;

  async function answer(status: 'ACCEPTED' | 'DECLINED') {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/competitions/${c.id}/finalist-invitations/${inv!.id}`, { status, answeredAt: new Date().toISOString() });
      await list.refetch();
      if (status === 'ACCEPTED') {
        toast(t('finalsAccepted'));
        if (!c.myRegistration) router.push(`/competitions/${c.id}/register`);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const declined = inv.status === 'DECLINED';
  const accepted = inv.status === 'ACCEPTED';
  return (
    <View testID="finals-invitation" style={{ borderRadius: radius.card, overflow: 'hidden', borderWidth: 1, borderColor: declined ? colors.border : colors.primary }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.lg, backgroundColor: declined ? colors.surfaceHigh : colors.primary }}>
        <Icon name="workspace-premium" color={declined ? colors.outline : colors.onPrimary} />
        <Txt style={[displayText(22), { flex: 1 }]} color={declined ? colors.text : colors.onPrimary}>{declined ? t('finalsDeclinedTitle') : t('finalsTitle')}</Txt>
      </View>
      <View style={{ gap: space.md, padding: space.lg, backgroundColor: colors.surface }}>
        <Txt>{inv.rank != null ? t('finalsRank', { rank: inv.rank, division: inv.categoryName ?? '' }) : t('finalsInvited')}</Txt>
        {accepted ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Icon name="check-circle" color={colors.success} />
            <Txt style={{ flex: 1, fontWeight: '700' }}>{c.myRegistration ? t('finalsAcceptedRegistered') : t('finalsAcceptedRegister')}</Txt>
          </View>
        ) : declined ? null : (
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button testID="finals-accept" icon="check" label={t('finalsAccept')} busy={busy} onPress={() => void answer('ACCEPTED')} />
            </View>
            <Button testID="finals-decline" kind="outlined" label={t('finalsDecline')} disabled={busy} onPress={() => setAsking(true)} />
          </View>
        )}
        {accepted && !c.myRegistration ? <Button testID="finals-register" icon="how-to-reg" label={t('evRegisterNow')} onPress={() => router.push(`/competitions/${c.id}/register`)} /> : null}
        <ErrorText error={error} />
      </View>
      <Dialog
        visible={asking}
        title={t('finalsDecline')}
        message={t('finalsDeclineConfirm')}
        confirmLabel={t('finalsDecline')}
        cancelLabel={t('cancel')}
        destructive
        onConfirm={() => {
          setAsking(false);
          void answer('DECLINED');
        }}
        onCancel={() => setAsking(false)}
      />
    </View>
  );
}

/** Circle21's invite-only page: why the athlete sees it, and what to do next. */
export function InviteOnlyScreen() {
  const t = useT();
  const { colors } = useTheme();
  const why = [t('inviteWhyEmail'), t('inviteWhyExpired')];
  const next = [t('inviteNextEmail'), t('inviteNextContact')];
  return (
    <Screen>
      <Txt style={[displayText(26), { textAlign: 'center' }]}>{t('inviteTitle')}</Txt>
      <EmptyState icon="lock" message={t('regInviteOnly')} />
      <Txt variant="label" color={colors.outline}>{t('inviteWhy')}</Txt>
      {why.map((x) => (
        <View key={x} style={{ flexDirection: 'row', gap: space.sm }}>
          <Icon name="help-outline" size={18} color={colors.outline} />
          <Txt style={{ flex: 1 }}>{x}</Txt>
        </View>
      ))}
      <Txt variant="label" color={colors.outline}>{t('inviteNext')}</Txt>
      {next.map((x) => (
        <View key={x} style={{ flexDirection: 'row', gap: space.sm }}>
          <Icon name="arrow-forward" size={18} color={colors.primary} />
          <Txt style={{ flex: 1 }}>{x}</Txt>
        </View>
      ))}
    </Screen>
  );
}
