import { useRef, useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { Loading, SectionHeader } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Button, Card, Chip, ListGroup, ListRow, Screen, TextField, Txt } from '../../../core/widgets/kit';
import { DateField, Select } from '../../../core/widgets/pickers';
import { formatMoney } from '../api';
import { organizerApi, useCoupons, useRefreshCompetition } from './api';
import { batchCodes, couponBody, couponDraft, couponValid, createCoupons, normalizeCode, topUsed, type BatchResult, type CouponDraft, type CouponKind } from './logic-b';

const KINDS: CouponKind[] = ['PERCENTAGE', 'FIXED_AMOUNT', 'FREE'];
type Report = Pick<BatchResult, 'created' | 'taken'>;

/** « Codes promo » (spec §1.3 item 10): every code with its uses, the 5 most used, create one or a batch (CODE-1 … CODE-N), activate / deactivate. */
export function CouponsTab({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const refresh = useRefreshCompetition();
  const list = useCoupons(c.id);
  const [form, setForm] = useState<CouponDraft | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function guarded(fn: () => Promise<void>) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  const create = (d: CouponDraft) =>
    guarded(async () => {
      setReport(null);
      const codes = batchCodes(normalizeCode(d.code), d.quantity.trim() ? Number(d.quantity) : 1);
      const r = await createCoupons(codes, (code) => organizerApi(api).addCoupon(c.id, couponBody(d, code)));
      setReport({ created: r.created, taken: r.taken });
      // Another error stopped the batch: the form stays open with the summary and the error.
      if (r.error) setError(r.error);
      else setForm(null);
    });
  const toggle = (k: Json) =>
    guarded(async () => {
      await organizerApi(api).setCouponActive(c.id, k.id, !k.active);
    });

  const kindLabel: Record<CouponKind, string> = { PERCENTAGE: t('orgCouponPercent'), FIXED_AMOUNT: t('orgCouponAmount'), FREE: t('orgCouponFree') };
  const discount = (k: Json) => (k.type === 'FREE' ? t('orgCouponFree') : k.type === 'PERCENTAGE' ? `-${k.value} %` : `-${formatMoney(k.value, c.currency, locale)}`);
  const categoryName = (id: string | null) => (c.categories ?? []).find((x: Json) => x.id === id)?.name;
  const summary = report ? [t('orgCouponCreated', { count: report.created.length }), report.taken.length ? t('orgCouponTaken', { codes: report.taken.join(', ') }) : null].filter(Boolean).join(' · ') : null;

  if (form) {
    return (
      <CouponForm
        draft={form}
        categories={c.categories ?? []}
        kindLabel={kindLabel}
        busy={busy}
        error={error}
        summary={summary}
        onSave={create}
        onCancel={() => {
          setForm(null);
          setReport(null);
          setError(null);
        }}
      />
    );
  }
  if (list.isError) return <ErrorView error={list.error} onRetry={() => list.refetch()} />;
  if (!list.data) return <Loading />;
  const top = topUsed(list.data);
  return (
    <Screen>
      {summary ? (
        <Card testID="coupon-report">
          <Txt>{summary}</Txt>
        </Card>
      ) : null}
      <Button
        testID="coupon-new"
        icon="add"
        label={t('orgCouponNew')}
        onPress={() => {
          setReport(null);
          setError(null);
          setForm(couponDraft());
        }}
      />
      <ErrorText error={error} />
      {top.length > 0 ? (
        <>
          <SectionHeader title={t('orgCouponTop')} />
          <ListGroup>
            {top.map((k) => (
              <ListRow key={k.id} icon="trending-up" title={k.code} trailing={<Txt variant="title">{String(k.usedCount)}</Txt>} />
            ))}
          </ListGroup>
        </>
      ) : null}
      <SectionHeader title={t('orgCouponAll')} />
      {list.data.length === 0 ? (
        <Txt color={colors.outline}>{t('orgCouponNone')}</Txt>
      ) : (
        <ListGroup>
          {list.data.map((k: Json) => (
            <ListRow
              key={k.id}
              testID={`coupon-${k.id}`}
              icon="sell"
              title={k.code}
              subtitle={[discount(k), categoryName(k.categoryId), t('orgCouponUses', { used: k.usedCount ?? 0, max: k.maxUses ?? '∞' }), k.expiresAt ? t('orgCouponUntil', { date: formatDate(k.expiresAt, locale) }) : null, k.active ? null : t('orgInactive')].filter(Boolean).join(' · ')}
              trailing={<Button testID={`coupon-toggle-${k.id}`} kind="text" label={k.active ? t('orgDeactivate') : t('orgActivate')} busy={busy} onPress={() => toggle(k)} />}
            />
          ))}
        </ListGroup>
      )}
    </Screen>
  );
}

function CouponForm({ draft, categories, kindLabel, busy, error, summary, onSave, onCancel }: { draft: CouponDraft; categories: Json[]; kindLabel: Record<CouponKind, string>; busy: boolean; error: unknown; summary: string | null; onSave: (d: CouponDraft) => void; onCancel: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const [d, setD] = useState(draft);
  const code = normalizeCode(d.code);
  const quantity = Number(d.quantity);
  return (
    <Screen>
      <Card style={{ gap: space.md }}>
        <TextField testID="coupon-code" label={t('orgCouponCode')} value={d.code} onChangeText={(v) => setD({ ...d, code: v.toUpperCase() })} autoCapitalize="characters" maxLength={32} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {KINDS.map((k) => (
            <Chip key={k} testID={`coupon-type-${k}`} label={kindLabel[k]} selected={d.type === k} onPress={() => setD({ ...d, type: k })} />
          ))}
        </View>
        {d.type !== 'FREE' ? <TextField testID="coupon-value" label={d.type === 'PERCENTAGE' ? t('orgCouponPercentValue') : t('orgCouponAmountValue')} value={d.value} onChangeText={(value) => setD({ ...d, value })} keyboardType="decimal-pad" /> : null}
        <Select testID="coupon-cat" label={t('orgHeatCategory')} value={d.categoryId ?? ''} options={[{ value: '', label: t('orgAllCategories') }, ...categories.map((k) => ({ value: k.id as string, label: k.name as string }))]} onChange={(v) => setD({ ...d, categoryId: v || null })} />
        <TextField testID="coupon-max" label={t('orgCouponMaxUses')} value={d.maxUses} onChangeText={(maxUses) => setD({ ...d, maxUses })} keyboardType="number-pad" />
        <DateField testID="coupon-expires" mode="datetime" label={t('orgCouponExpires')} value={d.expires} placeholder={t('orgCouponNoExpiry')} onChange={(expires) => setD({ ...d, expires })} />
        <TextField testID="coupon-qty" label={t('orgCouponQuantity')} value={d.quantity} onChangeText={(q) => setD({ ...d, quantity: q })} keyboardType="number-pad" />
        {Number.isInteger(quantity) && quantity > 1 && code ? (
          <Txt variant="small" color={colors.outline}>
            {t('orgCouponBatchHint', { first: `${code}-1`, last: `${code}-${quantity}` })}
          </Txt>
        ) : null}
        {summary ? <Txt>{summary}</Txt> : null}
        <ErrorText error={error} />
        <Button testID="coupon-save" label={t('orgCouponCreate')} busy={busy} disabled={!couponValid(d)} onPress={() => onSave(d)} />
        <Button kind="text" label={t('cancel')} onPress={onCancel} />
      </Card>
    </Screen>
  );
}
