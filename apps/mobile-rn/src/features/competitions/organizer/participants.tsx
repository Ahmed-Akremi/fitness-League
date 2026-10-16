import { useState } from 'react';
import { FlatList, View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { EmptyState, SkeletonList, StatusPill } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Button, Chip, ListRow, Segmented, TextField, Txt } from '../../../core/widgets/kit';
import { useRegistrations } from './api';
import { exportCsv } from './export';
import { csvFileName, csvSeparator, filterRegistrations, PAYMENT_FILTERS, personName, registrationsCsv, standing, toCollect, type PaymentFilter } from './logic-b';
import { ParticipantsWeb } from './participants-web';
import { MarkPaidDialogs, paymentLabels, useMarkPaid } from './payments';
import { useWideWeb } from './web';

/** « Participants » (spec §1.3 item 6): every registration with search and filters, « À encaisser », mark paid with a receipt, CSV. On a computer: a table, a side panel and batch payment (lot Web 2). */
export function ParticipantsTab({ c, initialCategoryId = null }: { c: Json; initialCategoryId?: string | null }) {
  const wide = useWideWeb();
  return wide ? <ParticipantsWeb c={c} initialCategoryId={initialCategoryId} /> : <ParticipantsPhone c={c} initialCategoryId={initialCategoryId} />;
}

function ParticipantsPhone({ c, initialCategoryId }: { c: Json; initialCategoryId: string | null }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const regs = useRegistrations(c.id);
  const pay = useMarkPaid(c);
  const [mode, setMode] = useState<'all' | 'collect'>('all');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(initialCategoryId);
  const [payment, setPayment] = useState<PaymentFilter>('ALL');
  const payLabel = paymentLabels(t);

  if (regs.isError) return <ErrorView error={regs.error} onRetry={() => regs.refetch()} />;
  if (!regs.data) return <SkeletonList label={t('orgLoading')} />;
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
            {PAYMENT_FILTERS.map((p) => (
              <Chip key={p} testID={`reg-pay-${p}`} label={p === 'ALL' ? t('orgRegAnyPayment') : payLabel[p]} selected={payment === p} onPress={() => setPayment(p)} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Chip testID="reg-cat-all" label={t('orgAllCategories')} selected={categoryId == null} onPress={() => setCategoryId(null)} />
            {(c.categories ?? []).map((k: Json) => (
              <Chip key={k.id} testID={`reg-cat-${k.id}`} label={k.name} selected={categoryId === k.id} onPress={() => setCategoryId(k.id)} />
            ))}
          </View>
          <Button testID="reg-csv" kind="outlined" icon="file-download" label={t('orgExport')} disabled={rows.length === 0} onPress={() => exportCsv(csvFileName(c, 'participants'), registrationsCsv(rows, csvSeparator(locale)))} />
        </>
      ) : (
        <Txt color={colors.outline}>{t('orgRegCollectHint')}</Txt>
      )}
      {pay.info ? <Txt color={colors.primary}>{pay.info}</Txt> : null}
      <ErrorText error={pay.error} />
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
            subtitle={[r.category?.name, pay.money(r), formatDate(r.registeredAt, locale)].filter(Boolean).join(' · ')}
            trailing={
              r.paymentStatus === 'PENDING' && standing(r) ? (
                <Button testID={`reg-paid-${r.id}`} kind="text" label={t('orgMarkPaid')} busy={pay.busy} onPress={() => pay.ask(r)} />
              ) : (
                <StatusPill label={standing(r) ? (payLabel[r.paymentStatus] ?? r.paymentStatus) : t('orgRegCancelled')} color={r.paymentStatus === 'PAID' && standing(r) ? colors.primary : colors.outline} />
              )
            }
          />
        )}
      />
      <MarkPaidDialogs pay={pay} />
    </>
  );
}
