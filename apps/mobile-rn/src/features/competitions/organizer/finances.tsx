import { useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { EmptyState, SkeletonList, StatusPill } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Select } from '../../../core/widgets/pickers';
import { DataTable, type Column } from '../../../core/widgets/table';
import { Grid, KpiCard, PageHeader, SearchField } from '../../../core/widgets/web';
import { formatMoney } from '../api';
import { useRegistrations } from './api';
import { exportCsv } from './export';
import { csvFileName, csvSeparator, personName } from './logic-b';
import { filterTransactions, finance, transactionsCsv, type TxFilter } from './logic-web';
import { ExportButton, OrgPageHeader } from './page';

const FILTERS: TxFilter[] = ['ALL', 'PAID', 'PENDING', 'FREE', 'REFUNDED'];

/** « Finances » on a computer (analysis §3 item 8, Circle21 ref 01): the money of the event from the registrations, and every transaction. Payments are recorded by hand: no online fees. */
export function FinancesTab({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const regs = useRegistrations(c.id);
  const [q, setQ] = useState('');
  const [payment, setPayment] = useState<TxFilter>('ALL');
  // A failed reload keeps the page (and a batch summary) with the error above it; the full-page error is only for a first load.
  if (!regs.data) return regs.isError ? <ErrorView error={regs.error} onRetry={() => regs.refetch()} /> : <SkeletonList label={t('orgLoading')} />;
  const f = finance(regs.data);
  const shown = filterTransactions(f.rows, { q, payment });
  const money = (n: number, currency: string = c.currency) => formatMoney(n, currency, locale);
  const payLabel: Record<string, string> = { PENDING: t('orgPayPending'), PAID: t('orgPayPaid'), FREE: t('orgPayFree'), REFUNDED: t('orgPayRefunded') };
  const columns: Column<Json>[] = [
    { key: 'date', label: t('orgColDate'), width: 120, render: (r) => formatDate(r.registeredAt, locale) },
    { key: 'name', label: t('orgColName'), flex: 2, render: (r) => personName(r) },
    { key: 'category', label: t('orgColCategory'), flex: 1.5, render: (r) => r.category?.name ?? '' },
    { key: 'price', label: t('orgColPrice'), width: 110, align: 'end', render: (r) => money(r.originalPrice ?? r.finalPrice ?? 0, r.currency) },
    { key: 'discount', label: t('orgColDiscount'), width: 110, align: 'end', render: (r) => (r.discount ? `− ${money(r.discount, r.currency)}` : '—') },
    { key: 'amount', label: t('orgColAmount'), width: 110, align: 'end', render: (r) => money(r.finalPrice ?? 0, r.currency) },
    {
      key: 'payment',
      label: t('orgColPayment'),
      width: 120,
      render: (r) => <StatusPill label={payLabel[r.paymentStatus] ?? r.paymentStatus} color={r.paymentStatus === 'PAID' ? colors.primary : r.paymentStatus === 'REFUNDED' ? colors.error : colors.outline} />,
    },
  ];
  const header = (
    <View style={{ gap: space.lg }}>
      <ErrorText error={regs.error} />
      <Grid min={200} counts={[3, 2, 1]}>
        <KpiCard testID="fin-gross" title={t('orgFinGross')} caption={t('orgFinGrossHint')} value={money(f.gross)} />
        <KpiCard testID="fin-discounts" title={t('orgFinDiscounts')} caption={t('orgFinDiscountsHint')} value={money(f.discounts)} />
        <KpiCard testID="fin-collected" title={t('orgFinCollected')} caption={t('orgFinCollectedHint')} value={money(f.collected)} footnote={t('orgFinManual')} />
        <KpiCard testID="fin-to-collect" title={t('orgToCollect')} caption={t('orgKpiToCollectHint')} value={money(f.toCollect)} />
        <KpiCard testID="fin-free" title={t('orgFinFree')} caption={t('orgFinFreeHint')} value={String(f.free)} />
        <KpiCard testID="fin-refunded" title={t('orgFinRefunded')} caption={t('orgFinRefundedHint')} value={money(f.refunded)} />
      </Grid>
      <PageHeader
        flush
        testID="fin-header"
        title={t('orgFinTransactions')}
        actions={
          <>
            <SearchField testID="fin-search" placeholder={t('orgFinSearch')} value={q} onChangeText={setQ} />
            <Select testID="fin-pay" bare label={t('orgColPayment')} value={payment} options={FILTERS.map((p) => ({ value: p, label: p === 'ALL' ? t('orgRegAnyPayment') : payLabel[p] }))} onChange={(v) => setPayment(v as TxFilter)} />
            <ExportButton testID="fin-export" disabled={shown.length === 0} onPress={() => exportCsv(csvFileName(c, 'transactions'), transactionsCsv(shown, csvSeparator(locale)))} />
          </>
        }
      />
    </View>
  );
  return (
    <>
      <OrgPageHeader tab="finances" />
      <DataTable testID="fin-table" rows={shown} keyOf={(r) => r.id} nameOf={personName} rowTestID={(r) => `fin-row-${r.id}`} columns={columns} header={header} empty={<EmptyState icon="payments" message={t('orgFinNone')} />} />
    </>
  );
}
