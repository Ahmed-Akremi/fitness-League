import { useRef, useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { SectionHeader } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Card, Chip, Screen, SwitchRow, TextField, Txt, toast } from '../../../core/widgets/kit';
import { DateField } from '../../../core/widgets/pickers';
import { formatMoney } from '../api';
import { organizerApi, useRefreshCompetition } from './api';
import { LocalBadge } from './local-badge';
import { PLATFORM_FEE, priceBreakdown, pricingBody, pricingDraft, pricingOf, pricingProblems, type FeeDistribution, type PricingDraft } from './logic-pricing';
import { OrgPageHeader } from './page';

/** Phase 3: who collects, the platform fee, VAT and deposits, with what an athlete pays at the event's price. Kept on the device for now. */
export function PricingTab({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const { colors } = useTheme();
  const refresh = useRefreshCompetition();
  const [d, setD] = useState<PricingDraft>(() => pricingDraft(c));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const sending = useRef(false);
  const problems = pricingProblems(d);
  const set = (patch: Partial<PricingDraft>) => setD({ ...d, ...patch });
  const money = (m: number) => formatMoney(m, c.currency ?? 'TND', locale);
  const example = priceBreakdown({ price: c.registrationPrice ?? 0 }, pricingOf({ pricing: pricingBody(d) }));

  async function save() {
    if (sending.current || problems.length) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await organizerApi(api).update(c.id, { pricing: pricingBody(d) });
      toast(t('orgSaved'));
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const fees: [FeeDistribution, string][] = [
    ['PASS', t('orgPriceFeePass')],
    ['SPLIT', t('orgPriceFeeSplit')],
    ['ABSORB', t('orgPriceFeeAbsorb')],
  ];
  const line = (label: string, amount: string, testID?: string, strong = false) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
      <Txt color={strong ? colors.text : colors.outline}>{label}</Txt>
      <Txt testID={testID} style={strong ? { fontWeight: '700' } : undefined}>{amount}</Txt>
    </View>
  );
  return (
    <>
      <OrgPageHeader tab="pricing" />
      <Screen>
        <View style={{ alignSelf: 'flex-start' }}>
          <LocalBadge />
        </View>
        <SectionHeader title={t('orgPricePayout')} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Chip testID="price-payout-PLATFORM" label={t('orgPricePayoutPlatform')} selected={d.payout === 'PLATFORM'} onPress={() => set({ payout: 'PLATFORM' })} />
          <Chip testID="price-payout-DIRECT" label={t('orgPricePayoutDirect')} selected={d.payout === 'DIRECT'} onPress={() => set({ payout: 'DIRECT' })} />
        </View>
        {d.payout === 'DIRECT' && <Txt variant="small" color={colors.outline}>{t('orgPricePayoutDirectHint')}</Txt>}

        <SectionHeader title={t('orgPriceFee', { percent: PLATFORM_FEE.percent, fixed: money(PLATFORM_FEE.fixed) })} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {fees.map(([key, label]) => (
            <Chip key={key} testID={`price-fee-${key}`} label={label} selected={d.fee === key} onPress={() => set({ fee: key })} />
          ))}
        </View>

        <SwitchRow testID="price-tax" title={t('orgPriceTax')} value={d.taxEnabled} onChange={(v) => set({ taxEnabled: v })} />
        {d.taxEnabled && (
          <>
            <TextField testID="price-tax-percent" label={t('orgPriceTaxPercent')} value={d.taxPercent} onChangeText={(v) => set({ taxPercent: v })} keyboardType="decimal-pad" />
            {problems.includes('TAX_PERCENT') && <Txt variant="small" color={colors.error}>{t('orgPriceTaxInvalid')}</Txt>}
            <TextField testID="price-tax-number" label={t('orgPriceTaxNumber')} value={d.taxNumber} onChangeText={(v) => set({ taxNumber: v })} maxLength={40} autoCapitalize="characters" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              <Chip testID="price-tax-mode-INCLUDED" label={t('orgPriceTaxIncluded')} selected={d.taxMode === 'INCLUDED'} onPress={() => set({ taxMode: 'INCLUDED' })} />
              <Chip testID="price-tax-mode-ADDED" label={t('orgPriceTaxAdded')} selected={d.taxMode === 'ADDED'} onPress={() => set({ taxMode: 'ADDED' })} />
            </View>
          </>
        )}

        <SwitchRow testID="price-deposit" title={t('orgPriceDeposit')} value={d.depositEnabled} onChange={(v) => set({ depositEnabled: v, depositDeadline: d.depositDeadline ?? (v ? new Date(c.registrationEnd) : null) })} />
        {d.depositEnabled && (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              <Chip testID="price-deposit-type-PERCENT" label={t('orgPriceDepositPercent')} selected={d.depositType === 'PERCENT'} onPress={() => set({ depositType: 'PERCENT' })} />
              <Chip testID="price-deposit-type-FIXED" label={t('orgPriceDepositFixed')} selected={d.depositType === 'FIXED'} onPress={() => set({ depositType: 'FIXED' })} />
            </View>
            <TextField testID="price-deposit-value" label={t('orgPriceDepositValue')} value={d.depositValue} onChangeText={(v) => set({ depositValue: v })} keyboardType="decimal-pad" />
            {problems.includes('DEPOSIT_VALUE') && <Txt variant="small" color={colors.error}>{t('orgPriceDepositInvalid')}</Txt>}
            {d.depositDeadline && <DateField testID="price-deposit-deadline" mode="date" label={t('orgPriceDepositDeadline')} value={d.depositDeadline} onChange={(v) => set({ depositDeadline: v })} />}
            <SwitchRow testID="price-deposit-refundable" title={t('orgPriceDepositRefundable')} value={d.depositRefundable} onChange={(v) => set({ depositRefundable: v })} />
          </>
        )}

        <Card testID="price-breakdown" style={{ gap: space.sm }}>
          <Txt variant="label" color={colors.outline}>{t('orgPriceExample', { price: money(c.registrationPrice ?? 0) })}</Txt>
          {example.tax > 0 && line(t('orgPriceTaxLine'), money(example.tax))}
          {line(t('orgPriceFeeLine'), money(example.fee))}
          {line(t('orgPriceAthletePays'), money(example.athletePays), 'price-athlete-pays', true)}
          {line(t('orgPriceOrganizerGets'), money(example.organizerGets), 'price-organizer-gets', true)}
          {example.balance > 0 && line(t('orgPriceDepositLine', { balance: money(example.balance) }), money(example.depositNow))}
        </Card>

        <ErrorText error={error} />
        <Button testID="price-save" label={t('save')} busy={busy} disabled={problems.length > 0} onPress={save} />
      </Screen>
    </>
  );
}
