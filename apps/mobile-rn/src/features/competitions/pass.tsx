import { Stack } from 'expo-router';
import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import type { Json } from '../../core/api/client';
import { useLocale, useT } from '../../core/prefs';
import { displayText, radius, space, ThemeScope, useTheme } from '../../core/theme';
import { formatDate } from '../../core/utils/format';
import { EmptyState, Loading, SectionHeader } from '../../core/widgets/common';
import { ErrorView } from '../../core/widgets/error';
import { Icon, Screen, Txt } from '../../core/widgets/kit';
import { useMe } from '../me/api';
import { useCompetition } from './api';
import { hasPass, myTickets, passCode, passValue } from './logic-pass';
import { useLocalList } from './organizer/roster';

/**
 * « My pass » (Circle21 §3.9): the QR to show the host at check-in and at the warm-up area, and my spectator tickets,
 * each with its code. The QR is drawn dark on a light card whatever the app's theme, so any scanner reads it.
 */
export function PassScreen({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const comp = useCompetition(id);
  const me = useMe();
  const orders = useLocalList(id, 'ticket-orders');
  const types = useLocalList(id, 'ticket-types');
  if (comp.isError) return <ErrorView error={comp.error} onRetry={() => comp.refetch()} />;
  if (!comp.data) return <Loading />;
  const c = comp.data;
  const r: Json | null = c.myRegistration ?? null;
  const tickets = myTickets(orders.data ?? [], me.data?.id);
  const division = (c.categories ?? []).find((k: Json) => k.id === r?.categoryId)?.name;
  const name = me.data?.profile?.fullName || me.data?.username || '';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: t('passTitle') }} />
      <Screen>
        <View style={{ gap: 2 }}>
          <Txt style={displayText(26)}>{c.title}</Txt>
          <Txt variant="small" color={colors.outline}>{[formatDate(c.eventStart, locale, { weekday: 'short', day: 'numeric', month: 'short' }), c.location ?? c.city].filter(Boolean).join(' · ')}</Txt>
        </View>
        {hasPass(c) && r ? (
          <>
            <QrCard testID="pass-athlete" value={passValue(c.id, r.id)} code={passCode(r.id)} title={name} subtitle={[division, r.teamName].filter(Boolean).join(' · ')} />
            <Hint icon="how-to-reg" text={t('passPresence')} />
            <Hint icon="sports-gymnastics" text={t('passWarmup')} />
          </>
        ) : tickets.length === 0 ? (
          <EmptyState icon="qr-code-2" message={t('passNone')} />
        ) : null}
        {tickets.length ? <SectionHeader title={t('passTickets')} /> : null}
        {tickets.map((o) => (
          <QrCard key={o.id} testID={`pass-ticket-${o.id}`} value={o.code} code={o.code} title={`${(types.data ?? []).find((x) => x.id === o.itemId)?.name ?? '—'} × ${o.quantity}`} subtitle={o.status === 'PAID' ? t('passPaid') : t('passPayAtDoor')} />
        ))}
      </Screen>
    </View>
  );
}

function QrCard({ value, code, title, subtitle, testID }: { value: string; code: string; title: string; subtitle: string; testID: string }) {
  return (
    <ThemeScope scheme="light">
      <QrBody value={value} code={code} title={title} subtitle={subtitle} testID={testID} />
    </ThemeScope>
  );
}

function QrBody({ value, code, title, subtitle, testID }: { value: string; code: string; title: string; subtitle: string; testID: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ alignItems: 'center', gap: space.sm, padding: space.xl, borderRadius: radius.card, backgroundColor: colors.background }}>
      <View accessible accessibilityRole="image" accessibilityLabel={code} style={{ padding: space.md, borderRadius: 12, backgroundColor: colors.background }}>
        <QRCode value={value} size={216} color={colors.text} backgroundColor={colors.background} ecl="M" />
      </View>
      <Txt testID={`${testID}-code`} selectable style={[displayText(30), { letterSpacing: 2 }]} color={colors.text}>{code}</Txt>
      <Txt style={{ fontWeight: '800', textAlign: 'center' }} color={colors.text}>{title}</Txt>
      {subtitle ? <Txt variant="small" style={{ textAlign: 'center' }} color={colors.outline}>{subtitle}</Txt> : null}
    </View>
  );
}

function Hint({ icon, text }: { icon: 'how-to-reg' | 'sports-gymnastics'; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <Icon name={icon} size={20} color={colors.primary} />
      <Txt style={{ flex: 1 }}>{text}</Txt>
    </View>
  );
}
