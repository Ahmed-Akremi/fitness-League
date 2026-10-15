import { useRef, useState } from 'react';
import { FlatList, Share, View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { ApiError } from '../../../core/api/errors';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { EmptyState, Loading, StatusPill } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Button, Chip, Dialog, ListRow, Segmented, TextField, Txt } from '../../../core/widgets/kit';
import { formatMoney } from '../api';
import { organizerApi, useRefreshCompetition, useRegistrations } from './api';
import { filterRegistrations, personName, registrationsCsv, toCollect, type PaymentFilter } from './logic-b';

const PAYMENTS: PaymentFilter[] = ['ALL', 'PENDING', 'PAID', 'FREE'];
const standing = (r: Json) => r.registrationStatus !== 'CANCELLED' && r.registrationStatus !== 'REFUNDED';

/** « Participants » (spec §1.3 item 6): every registration with search and filters, « À encaisser », mark paid with a receipt, CSV. */
export function ParticipantsTab({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const refresh = useRefreshCompetition();
  const regs = useRegistrations(c.id);
  const [mode, setMode] = useState<'all' | 'collect'>('all');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentFilter>('ALL');
  const [paying, setPaying] = useState<Json | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const money = (r: Json) => formatMoney(r.finalPrice ?? 0, r.currency ?? c.currency, locale);
  const payLabel: Record<string, string> = { PENDING: t('orgPayPending'), PAID: t('orgPayPaid'), FREE: t('orgPayFree'), FAILED: t('orgPayFailed'), REFUNDED: t('orgPayRefunded') };

  async function markPaid(r: Json) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await organizerApi(api).markPaid(c.id, r.id);
      setReceipt(t('orgReceipt', { title: c.title, name: personName(r), category: r.category?.name ?? '', amount: money(r), date: formatDate(new Date(), locale) }));
    } catch (e) {
      // A co-organizer settled it first: the reload below shows the real state.
      if (e instanceof ApiError && e.status === 409) setInfo(t('orgAlreadyPaid'));
      else setError(e);
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  if (regs.isError) return <ErrorView error={regs.error} onRetry={() => regs.refetch()} />;
  if (!regs.data) return <Loading />;
  const all: Json[] = regs.data;
  const collect = toCollect(all);
  const rows = mode === 'collect' ? collect : filterRegistrations(all, { q, categoryId, payment });

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.sm }}>
      <Segmented
        flush
        options={[
          { key: 'all', label: t('orgRegAll', { count: all.length }) },
          { key: 'collect', label: t('orgRegToCollect', { count: collect.length }) },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === 'all' ? (
        <>
          <TextField testID="reg-search" icon="search" placeholder={t('orgRegSearch')} value={q} onChangeText={setQ} autoCapitalize="none" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {PAYMENTS.map((p) => (
              <Chip key={p} testID={`reg-pay-${p}`} label={p === 'ALL' ? t('orgRegAnyPayment') : payLabel[p]} selected={payment === p} onPress={() => setPayment(p)} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Chip testID="reg-cat-all" label={t('orgAllCategories')} selected={categoryId == null} onPress={() => setCategoryId(null)} />
            {(c.categories ?? []).map((k: Json) => (
              <Chip key={k.id} testID={`reg-cat-${k.id}`} label={k.name} selected={categoryId === k.id} onPress={() => setCategoryId(k.id)} />
            ))}
          </View>
          <Button testID="reg-csv" kind="outlined" icon="file-download" label={t('orgRegExport')} disabled={rows.length === 0} onPress={() => void Share.share({ message: registrationsCsv(rows) })} />
        </>
      ) : (
        <Txt color={colors.outline}>{t('orgRegCollectHint')}</Txt>
      )}
      {info ? <Txt color={colors.primary}>{info}</Txt> : null}
      <ErrorText error={error} />
    </View>
  );

  return (
    <>
      <FlatList
        testID="reg-list"
        data={rows}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState icon="group" message={mode === 'collect' ? t('orgRegNothingToCollect') : t('orgRegNone')} />}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        refreshing={regs.isRefetching}
        onRefresh={() => regs.refetch()}
        renderItem={({ item: r }) => (
          <ListRow
            testID={`reg-${r.id}`}
            title={personName(r)}
            subtitle={[r.category?.name, money(r), formatDate(r.registeredAt, locale)].filter(Boolean).join(' · ')}
            trailing={
              r.paymentStatus === 'PENDING' && standing(r) ? (
                <Button testID={`reg-paid-${r.id}`} kind="text" label={t('orgMarkPaid')} busy={busy} onPress={() => setPaying(r)} />
              ) : (
                <StatusPill label={standing(r) ? (payLabel[r.paymentStatus] ?? r.paymentStatus) : t('orgRegCancelled')} color={r.paymentStatus === 'PAID' && standing(r) ? colors.primary : colors.outline} />
              )
            }
          />
        )}
      />
      <Dialog
        visible={paying != null}
        title={t('orgMarkPaid')}
        message={paying ? t('orgMarkPaidConfirm', { name: personName(paying), amount: money(paying) }) : undefined}
        confirmLabel={t('orgMarkPaid')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          const r = paying;
          setPaying(null);
          if (r) void markPaid(r);
        }}
        onCancel={() => setPaying(null)}
      />
      <Dialog
        visible={receipt != null}
        title={t('orgReceiptTitle')}
        message={receipt ?? undefined}
        confirmLabel={t('orgShareReceipt')}
        cancelLabel={t('orgClose')}
        onConfirm={() => {
          const text = receipt;
          setReceipt(null);
          if (text) void Share.share({ message: text });
        }}
        onCancel={() => setReceipt(null)}
      />
    </>
  );
}
