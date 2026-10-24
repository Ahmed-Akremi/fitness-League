import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../core/api/client';
import { useLocale, useT } from '../../core/prefs';
import { useApi } from '../../core/services';
import { displayText, space, useTheme } from '../../core/theme';
import { formatDate } from '../../core/utils/format';
import { Loading } from '../../core/widgets/common';
import { ErrorText, ErrorView } from '../../core/widgets/error';
import { Button, Card, Icon, Screen, TextField, Txt, toast } from '../../core/widgets/kit';
import { compKeys, competitionsApi, formatMoney, useCompetition, useMySubmissions } from './api';
import { appealRuleOf, appealState, reasonOk } from './logic-board';

/**
 * Appeal a judged score (Circle21 « Submit appeal », §3.7): the score, the organizer's rules (deadline, fee, how many
 * appeals), the reason, then « Send the appeal » through the existing appeal route.
 */
export function AppealScreen({ id, wodId }: { id: string; wodId: string }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const comp = useCompetition(id);
  const subs = useMySubmissions(id, true);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (comp.isError) return <ErrorView error={comp.error} onRetry={() => comp.refetch()} />;
  if (!comp.data || !subs.data) return <Loading />;
  const c = comp.data;
  const w: Json | undefined = (c.workouts ?? []).find((x: Json) => x.id === wodId);
  const s: Json | undefined = subs.data.find((x: Json) => (x.workout?.id ?? x.workoutId) === wodId);
  const rule = appealRuleOf(c);
  const state = appealState(rule, s, Date.now());

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await competitionsApi(api).appeal(id, s!.id, reason.trim());
      await qc.invalidateQueries({ queryKey: compKeys.mine(id) });
      toast(t('appealSent'));
      if (router.canGoBack()) router.back();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: t('appealTitle') }} />
      <Screen>
        <Txt style={displayText(28)}>{w?.name ?? '—'}</Txt>
        {s ? (
          <Card testID="appeal-score" style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Icon name="emoji-events" color={colors.primary} />
            <Txt style={{ flex: 1 }}>{t('appealYourScore')}</Txt>
            <Txt style={displayText(24)} color={colors.primary}>{s.points != null ? t('compPoints', { points: Number(s.points) }) : '—'}</Txt>
          </Card>
        ) : null}
        <View testID="appeal-rules" style={{ gap: space.sm, padding: space.md, borderRadius: 14, backgroundColor: colors.surfaceHigh }}>
          <Txt variant="label" color={colors.outline}>{t('appealRules')}</Txt>
          {rule.deadline ? <Rule icon="event" text={t('appealDeadline', { date: formatDate(rule.deadline, locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })} /> : null}
          <Rule icon="payments" text={rule.price ? t('appealFee', { amount: formatMoney(rule.price, c.currency, locale) }) : t('appealFree')} />
          {rule.maxPerAthlete ? <Rule icon="repeat" text={t('appealMax', { count: rule.maxPerAthlete })} /> : null}
        </View>
        {state === 'OPEN' ? (
          <>
            <TextField testID="appeal-reason" label={t('appealReason')} placeholder={t('appealReasonHint')} value={reason} onChangeText={setReason} multiline maxLength={1000} />
            {reason.length > 0 && !reasonOk(reason) ? <Txt variant="small" color={colors.outline}>{t('appealReasonShort')}</Txt> : null}
            <ErrorText error={error} />
          </>
        ) : (
          <Card testID="appeal-closed" style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Icon name="block" color={colors.error} />
            <Txt style={{ flex: 1 }}>{state === 'EXPIRED' ? t('appealExpired') : state === 'OFF' ? t('appealOff') : t('appealNoScore')}</Txt>
          </Card>
        )}
      </Screen>
      {state === 'OPEN' ? (
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.lg, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Button testID="appeal-send" icon="gavel" label={t('appealSend')} busy={busy} disabled={!reasonOk(reason)} onPress={send} />
        </View>
      ) : null}
    </View>
  );
}

function Rule({ icon, text }: { icon: 'event' | 'payments' | 'repeat'; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <Icon name={icon} size={18} color={colors.primary} />
      <Txt variant="small" style={{ flex: 1 }}>{text}</Txt>
    </View>
  );
}
