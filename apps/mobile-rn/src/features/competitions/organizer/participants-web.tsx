import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { EmptyState, SectionHeader, SkeletonList, StatusPill } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Button, Dialog, Segmented, Txt } from '../../../core/widgets/kit';
import { SidePanel } from '../../../core/widgets/panel';
import { Select } from '../../../core/widgets/pickers';
import { DataTable, type Column } from '../../../core/widgets/table';
import { SearchField } from '../../../core/widgets/web';
import { formatMoney, useHeats } from '../api';
import { useRegistrations } from './api';
import { exportCsv } from './export';
import { csvFileName, csvSeparator, filterRegistrations, PAYMENT_FILTERS, personName, registrationsCsv, standing, toCollect, type PaymentFilter } from './logic-b';
import { athleteHeats } from './logic-web';
import { ExportButton, OrgPageHeader } from './page';
import { MarkPaidDialogs, paymentLabels, useMarkPaid, useMarkPaidBatch, type MarkPaid } from './payments';

/** « Participants » on a computer (analysis §3 item 9, Circle21 refs 12, 14, 08): a table with its toolbar, a light side panel per athlete, « Marquer payé » for several at once. */
export function ParticipantsWeb({ c, initialCategoryId }: { c: Json; initialCategoryId: string | null }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const regs = useRegistrations(c.id);
  const heats = useHeats(c.id);
  const pay = useMarkPaid(c);
  const batch = useMarkPaidBatch(c);
  const [mode, setMode] = useState<'all' | 'collect'>('all');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(initialCategoryId);
  const [payment, setPayment] = useState<PaymentFilter>('ALL');
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  // A failed reload keeps the page (and a batch summary) with the error above it; the full-page error is only for a first load.
  if (!regs.data) return regs.isError ? <ErrorView error={regs.error} onRetry={() => regs.refetch()} /> : <SkeletonList label={t('orgLoading')} />;
  const all: Json[] = regs.data;
  const collect = toCollect(all);
  const rows = mode === 'collect' ? collect : filterRegistrations(all, { q, categoryId, payment });
  // Read from the list every time: after a payment, here or elsewhere, the panel shows the reloaded state.
  const open = openId ? (all.find((r) => r.id === openId) ?? null) : null;
  // Only registrations still to collect: one paid meanwhile drops out of the batch.
  const chosen = collect.filter((r) => selected.has(r.id)).map((r) => r.id);
  const labels = paymentLabels(t);
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () => setSelected((s) => (collect.length > 0 && collect.every((r) => s.has(r.id)) ? new Set() : new Set(collect.map((r) => r.id))));

  const columns: Column<Json>[] = [
    { key: 'n', label: '#', width: 36, render: (_, i) => String(i + 1) },
    {
      key: 'name',
      label: t('orgColName'),
      flex: 2,
      render: (r) => (
        <Txt numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', textTransform: 'uppercase' }}>
          {personName(r)}
        </Txt>
      ),
    },
    { key: 'category', label: t('orgColCategory'), flex: 1.5, render: (r) => r.category?.name ?? '' },
    { key: 'payment', label: t('orgColPayment'), width: 120, render: (r) => <PayPill r={r} /> },
    { key: 'amount', label: t('orgColAmount'), width: 110, align: 'end', render: (r) => pay.money(r) },
    { key: 'date', label: t('orgColDate'), width: 120, render: (r) => formatDate(r.registeredAt, locale) },
  ];

  const actions =
    mode === 'all' ? (
      <>
        <SearchField testID="reg-search" placeholder={t('orgRegSearch')} value={q} onChangeText={setQ} />
        <Select testID="reg-pay" bare label={t('orgColPayment')} value={payment} options={PAYMENT_FILTERS.map((p) => ({ value: p, label: p === 'ALL' ? t('orgRegAnyPayment') : labels[p] }))} onChange={(v) => setPayment(v as PaymentFilter)} />
        <Select
          testID="reg-cat"
          bare
          label={t('orgColCategory')}
          value={categoryId ?? ''}
          options={[{ value: '', label: t('orgAllCategories') }, ...(c.categories ?? []).map((k: Json) => ({ value: k.id, label: k.name }))]}
          onChange={(v) => setCategoryId(v || null)}
        />
        <ExportButton testID="reg-csv" disabled={rows.length === 0} onPress={() => exportCsv(csvFileName(c, 'participants'), registrationsCsv(rows, csvSeparator(locale)))} />
      </>
    ) : (
      <Button testID="reg-batch" icon="done-all" label={t('orgMarkPaidBatch', { count: chosen.length })} busy={batch.busy} disabled={chosen.length === 0} onPress={() => setConfirming(true)} />
    );

  const listHeader = (
    <View style={{ gap: space.sm }}>
      <Segmented
        flush
        options={[
          { key: 'all', label: t('orgRegAll', { count: all.length }) },
          { key: 'collect', label: t('orgRegToCollect', { count: collect.length }) },
        ]}
        value={mode}
        onChange={(m) => {
          setMode(m);
          batch.clear();
        }}
      />
      {mode === 'collect' ? <Txt color={colors.outline}>{t('orgRegCollectHint')}</Txt> : null}
      <ErrorText error={regs.error} />
      {pay.info ? <Txt color={colors.primary}>{pay.info}</Txt> : null}
      <ErrorText error={pay.error} />
      {batch.result ? (
        <View testID="reg-batch-summary" style={{ gap: space.xs }}>
          <Txt>{t('orgBatchSummary', { paid: batch.result.paid.length, already: batch.result.already.length })}</Txt>
          {batch.result.left.length > 0 ? <Txt color={colors.error}>{t('orgBatchLeft', { count: batch.result.left.length })}</Txt> : null}
          <ErrorText error={batch.result.error} />
        </View>
      ) : null}
    </View>
  );

  return (
    <>
      <OrgPageHeader tab="participants" actions={actions} />
      <DataTable
        testID="reg-table"
        rows={rows}
        keyOf={(r) => r.id}
        nameOf={personName}
        rowTestID={(r) => `reg-${r.id}`}
        columns={columns}
        onRowPress={(r) => setOpenId(r.id)}
        selection={mode === 'collect' ? { selected, onToggle: toggle, onToggleAll: toggleAll, label: (name) => t('orgSelectRow', { name }), allLabel: t('orgSelectAll') } : undefined}
        rowActions={(r) => [
          { label: t('orgOpenDetails'), testID: `reg-open-${r.id}`, onPress: () => setOpenId(r.id) },
          ...(r.paymentStatus === 'PENDING' && standing(r) ? [{ label: t('orgMarkPaid'), testID: `reg-paid-${r.id}`, onPress: () => pay.ask(r) }] : []),
        ]}
        menuLabel={(name) => t('orgRowActions', { name })}
        header={listHeader}
        empty={<EmptyState icon="group" message={mode === 'collect' ? t('orgRegNothingToCollect') : t('orgRegNone')} />}
      />
      <AthletePanel c={c} r={open} heats={heats.data ?? []} pay={pay} onClose={() => setOpenId(null)} />
      <Dialog
        visible={confirming}
        title={t('orgMarkPaid')}
        message={t('orgMarkPaidBatchConfirm', { count: chosen.length })}
        confirmLabel={t('orgMarkPaid')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          setConfirming(false);
          void batch.run(chosen).then((r) => {
            // What an error left stays selected: « Marquer payé (n) » retries only those.
            if (r) setSelected(new Set(r.left));
          });
        }}
        onCancel={() => setConfirming(false)}
      />
      <MarkPaidDialogs pay={pay} />
    </>
  );
}

/** Payment pill: the status in words, « Annulée » for a registration no longer standing. */
function PayPill({ r, testID }: { r: Json; testID?: string }) {
  const t = useT();
  const { colors } = useTheme();
  const ok = standing(r);
  return <StatusPill testID={testID} label={ok ? (paymentLabels(t)[r.paymentStatus] ?? r.paymentStatus) : t('orgRegCancelled')} color={r.paymentStatus === 'PAID' && ok ? colors.primary : colors.outline} />;
}

/** The athlete's record in the light side panel, with « Marquer payé » or the receipt in its footer. */
function AthletePanel({ c, r, heats, pay, onClose }: { c: Json; r: Json | null; heats: Json[]; pay: MarkPaid; onClose: () => void }) {
  const t = useT();
  const pending = !!r && r.paymentStatus === 'PENDING' && standing(r);
  return (
    <SidePanel
      testID="reg-panel"
      visible={r != null}
      title={r ? personName(r) : ''}
      closeLabel={t('orgClose')}
      onClose={onClose}
      footer={
        <>
          <Button testID="reg-panel-close" kind="outlined" label={t('orgClose')} onPress={onClose} style={{ flex: 1 }} />
          {r && pending ? (
            <Button testID="reg-panel-pay" label={t('orgMarkPaid')} busy={pay.busy} onPress={() => pay.ask(r)} style={{ flex: 1 }} />
          ) : r && r.paymentStatus === 'PAID' ? (
            <Button testID="reg-panel-receipt" icon="receipt-long" label={t('orgReceiptButton')} onPress={() => pay.showReceipt(r)} style={{ flex: 1 }} />
          ) : null}
        </>
      }
    >
      {r ? <AthleteDetails c={c} r={r} heats={heats} info={pay.info} /> : null}
    </SidePanel>
  );
}

/** Category, price, discount, amount, payment, date, then the heats and lanes. Rendered inside the panel, so in the light palette. */
function AthleteDetails({ c, r, heats, info }: { c: Json; r: Json; heats: Json[]; info: string | null }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const money = (n: number) => formatMoney(n, r.currency ?? c.currency, locale);
  const placed = athleteHeats(heats, r.id);
  const line = (label: string, value: ReactNode) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32, gap: space.md }}>
      <Txt style={{ flex: 1, fontSize: 13 }} color={colors.outline}>
        {label}
      </Txt>
      {typeof value === 'string' ? <Txt style={{ fontSize: 14, fontWeight: '600' }}>{value}</Txt> : value}
    </View>
  );
  return (
    <>
      <View style={{ gap: space.xs }}>
        {line(t('orgColCategory'), r.category?.name ?? '—')}
        {line(t('orgColPrice'), money(r.originalPrice ?? r.finalPrice ?? 0))}
        {line(t('orgColDiscount'), r.discount ? `− ${money(r.discount)}` : '—')}
        {line(t('orgColAmount'), money(r.finalPrice ?? 0))}
        {line(t('orgColPayment'), <PayPill r={r} testID="reg-panel-status" />)}
        {line(t('orgColDate'), formatDate(r.registeredAt, locale, { dateStyle: 'medium', timeStyle: 'short' }))}
      </View>
      {info ? <Txt color={colors.primary}>{info}</Txt> : null}
      <SectionHeader title={t('orgDetailHeats')} />
      {placed.length === 0 ? (
        <Txt color={colors.outline}>{t('orgDetailNoHeat')}</Txt>
      ) : (
        placed.map(({ heat, lane }) => (
          <View key={heat.id} testID={`reg-panel-heat-${heat.id}`} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32, gap: space.md }}>
            <Txt numberOfLines={1} style={{ flex: 1, fontSize: 14 }}>
              {heat.name}
            </Txt>
            <Txt style={{ fontSize: 13 }} color={colors.outline}>
              {[heat.startsAt ? formatDate(heat.startsAt, locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : null, t('orgLane', { lane })].filter(Boolean).join(' · ')}
            </Txt>
          </View>
        ))
      )}
    </>
  );
}
