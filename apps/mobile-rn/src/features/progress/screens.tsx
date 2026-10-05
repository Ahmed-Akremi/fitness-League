import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import type { Json } from '../../core/api/client';
import { ApiError } from '../../core/api/errors';
import { useLocale, useT } from '../../core/prefs';
import { useApi } from '../../core/services';
import { displayText, useTheme } from '../../core/theme';
import { formatDate, formatMetric, formatNumber, localized } from '../../core/utils/format';
import { LineChart } from '../../core/widgets/chart';
import { EmptyState, Loading, SectionHeader, SkeletonList, StatCard } from '../../core/widgets/common';
import { ErrorView, errorMessage } from '../../core/widgets/error';
import { Card, Chip, Dialog, Fab, Icon, ListRow, Screen, Txt, toast } from '../../core/widgets/kit';
import { useProgress, useRecords, useSeries } from './api';

/** "My progress": you vs you (spec §11). Body weight is only ever shown here, to its owner. */
export function ProgressScreen() {
  const t = useT();
  const locale = useLocale();
  const [period, setPeriod] = useState('30d');
  const progress = useProgress(period);
  const periods: [string, string][] = [
    ['7d', t('period7d')],
    ['30d', t('period30d')],
    ['3m', t('period3m')],
    ['6m', t('period6m')],
    ['1y', t('period1y')],
  ];
  const p = progress.data;
  const metrics: Json[] = p?.metrics ?? [];
  return (
    <Screen>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {periods.map(([key, label]) => (
          <Chip key={key} testID={`period-${key}`} label={label} selected={period === key} onPress={() => setPeriod(key)} />
        ))}
      </ScrollView>
      {progress.isError ? (
        <ErrorView error={progress.error} onRetry={() => progress.refetch()} />
      ) : !p ? (
        <Loading />
      ) : metrics.length === 0 ? (
        <EmptyState icon="insights" message={t('emptyWorkouts')} />
      ) : (
        <>
          {metrics.map((m, i) => (
            <MetricCard key={i} metric={m} period={period} locale={locale} />
          ))}
          {p.bodyWeight && (
            <StatCard label={t('privacy')}>
              <Txt variant="title" style={{ fontSize: 22 }}>{`${formatNumber(p.bodyWeight.first, locale)} → ${formatNumber(p.bodyWeight.last, locale)} kg`}</Txt>
            </StatCard>
          )}
        </>
      )}
    </Screen>
  );
}

function MetricCard({ metric, period, locale }: { metric: Json; period: string; locale: string }) {
  const t = useT();
  const { colors } = useTheme();
  const exercise = metric.exercise ?? {};
  const m = metric.metric ?? {};
  const change = Number(metric.changePct ?? 0);
  const series = useSeries(exercise.id, m.code, period);
  const points: Json[] = series.data?.points ?? [];
  return (
    <StatCard
      label={`${localized(exercise.name, locale)} · ${m.code}`}
      trailing={<Txt color={change >= 0 ? colors.primary : colors.error} style={{ fontWeight: '800', fontSize: 16 }}>{`${change >= 0 ? '+' : ''}${change.toFixed(1)}%`}</Txt>}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <BeforeNow label={t('before')} value={formatMetric(metric.before, m.unit, locale)} />
        <Icon name="arrow-forward" />
        <BeforeNow label={t('now')} value={formatMetric(metric.now, m.unit, locale)} highlight />
      </View>
      {Number(metric.xpFromRecords ?? 0) > 0 && <Txt variant="small">{t('totalXp', { xp: Math.trunc(metric.xpFromRecords) })}</Txt>}
      <View style={{ marginTop: 12 }}>
        <LineChart values={points.map((p) => Number(p.value))} area />
      </View>
    </StatCard>
  );
}

function BeforeNow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, paddingHorizontal: 4 }}>
      <Txt variant="small" color={colors.outline}>{label}</Txt>
      <Txt variant="title" color={highlight ? colors.primary : undefined} style={{ fontSize: 20 }}>{value}</Txt>
    </View>
  );
}

/** Weigh-ins (health data, owner only): weight curve and history. */
export function BodyScreen() {
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const rows = useQuery({ queryKey: ['body-measurements'], queryFn: () => api.get<Json[]>('/me/body-measurements') });
  const parse = (s: string) => Number(s.replace(',', '.'));

  async function add(text: string) {
    setAdding(false);
    try {
      await api.post('/me/body-measurements', { weightKg: parse(text) });
      await qc.invalidateQueries({ queryKey: ['body-measurements'] });
    } catch (e) {
      toast(errorMessage(t, e));
    }
  }

  let body;
  if (rows.isError)
    body =
      rows.error instanceof ApiError && rows.error.status === 403 ? (
        <EmptyState icon="health-and-safety" message={t('healthConsentNeeded')} />
      ) : (
        <ErrorView error={rows.error} onRetry={() => rows.refetch()} />
      );
  else if (!rows.data) body = <SkeletonList count={4} />;
  else {
    const withWeight = rows.data.filter((r) => r.weightKg != null);
    const chronological = [...withWeight].reverse();
    body =
      withWeight.length === 0 ? (
        <EmptyState icon="monitor-weight" message={t('noMeasurements')} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 96 }}>
          <StatCard label={t('weightKg')}>
            <Txt style={displayText(40)}>{`${formatNumber(chronological[chronological.length - 1].weightKg, locale)} kg`}</Txt>
          </StatCard>
          <LineChart values={chronological.map((w) => Number(w.weightKg))} height={180} dots />
          {withWeight.map((r, i) => (
            <ListRow key={i} icon="monitor-weight" title={`${formatNumber(r.weightKg, locale)} kg`} subtitle={formatDate(r.measuredAt, locale)} />
          ))}
        </ScrollView>
      );
  }
  return (
    <View style={{ flex: 1, backgroundColor: useTheme().colors.background }}>
      {body}
      <Fab testID="body-add" icon="add" onPress={() => setAdding(true)} />
      <Dialog
        visible={adding}
        title={t('addMeasurement')}
        input={{ label: t('weightKg'), keyboardType: 'decimal-pad', testID: 'weight-input', valid: (s) => parse(s) >= 25 && parse(s) <= 350 }}
        confirmLabel={t('save')}
        cancelLabel={t('cancel')}
        onCancel={() => setAdding(false)}
        onConfirm={add}
      />
    </View>
  );
}

/** Personal records grouped as timed (WODs, Hyrox, runs), strength and other. */
export function RecordsScreen() {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const records = useRecords();
  if (records.isError) return <ErrorView error={records.error} onRetry={() => records.refetch()} />;
  if (!records.data) return <SkeletonList />;
  const rows = records.data;
  if (rows.length === 0) return <EmptyState icon="emoji-events" message={t('noRecords')} />;
  const unit = (r: Json): string => r.metric?.unit ?? '';
  const groups: [string, Json[]][] = [
    [t('recordsTimed'), rows.filter((r) => unit(r) === 's' || unit(r) === 's_per_km')],
    [t('recordsStrength'), rows.filter((r) => unit(r) === 'kg')],
    [t('recordsOther'), rows.filter((r) => !['s', 's_per_km', 'kg'].includes(unit(r)))],
  ];
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24, gap: 8 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => records.refetch()} tintColor={colors.primary} />}>
      {groups
        .filter(([, list]) => list.length > 0)
        .map(([title, list]) => (
          <View key={title} style={{ gap: 8 }}>
            <SectionHeader title={title} />
            {list.map((r, i) => (
              <Card key={i} style={{ paddingVertical: 4 }}>
                <ListRow
                  leading={<Icon name={unit(r) === 'kg' ? 'fitness-center' : 'timer'} color={colors.primary} />}
                  title={localized(r.exercise?.name, locale)}
                  subtitle={r.previousValue == null ? formatDate(r.achievedAt, locale) : t('recordPrevious', { value: formatMetric(r.previousValue, unit(r), locale) })}
                  trailing={<Txt style={displayText(24)}>{formatMetric(r.value, unit(r), locale)}</Txt>}
                />
              </Card>
            ))}
          </View>
        ))}
    </ScrollView>
  );
}
