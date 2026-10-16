import { useState } from 'react';
import { Pressable, View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { displayText, space, useTheme, webDense } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { BarChart, Ring } from '../../../core/widgets/chart';
import { ErrorText } from '../../../core/widgets/error';
import { LinkButton, Txt } from '../../../core/widgets/kit';
import { Grid, KpiCard, SectionCard, SegmentedInline } from '../../../core/widgets/web';
import { formatMoney } from '../api';
import { useRegistrations, useStaff } from './api';
import { distribution } from './logic-b';
import { fillDays, judgeCount, percentages, topCategories } from './logic-web';
import type { Go } from './web';

/** « Vue d'ensemble » on a computer (analysis §3 item 7, Circle21 refs 01–04): two rows of figures, registrations per day, then categories, scores and gender. */
export function OverviewWeb({ c, d, onGo }: { c: Json; d: Json; onGo: Go }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const regs = useRegistrations(c.id);
  const staff = useStaff(c.id);
  const [as, setAs] = useState<'percent' | 'numbers'>('percent');
  const dist = regs.data ? distribution(regs.data, c.categories ?? []) : null;
  const days = dist ? fillDays(dist.perDay) : [];
  const live = dist ? dist.perDay.reduce((s, x) => s + x.count, 0) : 0;
  const top = dist ? topCategories(dist.byCategory) : [];
  const gender = dist ? [dist.women, dist.men, dist.mixed] : [0, 0, 0];
  const pct = percentages(gender);
  const scores = [d.pendingJudging ?? 0, d.approvedSubmissions ?? 0, d.rejectedSubmissions ?? 0];
  // « No data » only once the registrations are in: while they load the cards stay empty.
  const noData = (has: boolean) => (dist && !has ? t('orgNoData') : null);
  const today = t('orgKpiToday', { date: formatDate(new Date(), locale, { day: 'numeric', month: 'long' }) });
  return (
    <View style={{ gap: webDense.gap }}>
      <Grid min={180} counts={[4, 2, 1]}>
        <KpiCard testID="ov-kpi-participants" title={t('orgParticipants')} caption={t('orgKpiParticipantsHint')} value={String(d.participants)} />
        <KpiCard testID="ov-kpi-paid" title={t('orgPaid')} caption={t('orgKpiPaidHint')} value={String(d.paidRegistrations)} />
        <KpiCard testID="ov-kpi-to-collect" title={t('orgToCollect')} caption={t('orgKpiToCollectHint')} value={String(d.pendingPayments)} />
        <KpiCard testID="ov-kpi-revenue" title={t('orgRevenue')} caption={today} value={formatMoney(d.revenue, c.currency, locale)} />
      </Grid>
      <Grid min={180} counts={[4, 2, 1]}>
        <KpiCard testID="ov-kpi-judges" title={t('orgTeamJudges')} caption={t('orgKpiJudgesHint')} value={staff.data ? String(judgeCount(staff.data)) : '—'} />
        <KpiCard testID="ov-kpi-to-judge" title={t('orgToJudge')} caption={t('orgKpiToJudgeHint')} value={String(scores[0])} />
        <KpiCard testID="ov-kpi-approved" title={t('orgApproved')} caption={t('orgKpiApprovedHint')} value={String(scores[1])} />
        <KpiCard testID="ov-kpi-rejected" title={t('orgRejected')} caption={t('orgKpiRejectedHint')} value={String(scores[2])} />
      </Grid>
      <ErrorText error={regs.error} />
      <SectionCard testID="ov-per-day" title={t('orgRegsCount', { count: live })} caption={t('orgPerDay')} empty={noData(days.length > 0)}>
        <BarChart label={t('orgPerDay')} data={days.map((x) => ({ key: x.day, label: formatDate(`${x.day}T12:00:00`, locale, { day: 'numeric', month: 'short' }), value: x.count }))} />
      </SectionCard>
      <Grid min={240} counts={[3, 1]}>
        <SectionCard testID="ov-categories" title={t('orgBreakdown')} action={<LinkButton testID="ov-cat-all" label={t('orgSeeAll')} onPress={() => onGo('participants')} />} empty={noData(top.length > 0)}>
          <View style={{ gap: 2 }}>
            {top.map((k) => (
              <Pressable key={k.id} testID={`ov-cat-${k.id}`} accessibilityRole="button" onPress={() => onGo('participants', { categoryId: k.id })} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 36, gap: space.sm }}>
                <Txt numberOfLines={1} style={{ flex: 1, fontSize: 14 }}>
                  {k.name}
                </Txt>
                <Txt style={{ fontSize: 14, fontWeight: '700' }}>{String(k.count)}</Txt>
              </Pressable>
            ))}
          </View>
        </SectionCard>
        <SectionCard testID="ov-scores" title={t('orgScores')} empty={scores.some((n) => n > 0) ? null : t('orgNoData')}>
          <SplitRing labels={[t('orgToJudge'), t('orgApproved'), t('orgRejected')]} values={scores} colors={[colors.outline, colors.success, colors.error]} />
        </SectionCard>
        <SectionCard testID="ov-gender" title={t('orgGender')} caption={t('orgGenderHint')} empty={noData(gender.some((n) => n > 0))}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: space.md }}>
            {(['women', 'men', 'mixed'] as const).map((g, i) => (
              <View key={g} style={{ alignItems: 'center', gap: space.xs }}>
                <Txt testID={`ov-gender-${g}`} style={displayText(28)}>
                  {as === 'percent' ? `${pct[i]}%` : String(gender[i])}
                </Txt>
                <Txt style={webDense.caption} color={colors.outline}>
                  {[t('orgWomen'), t('orgMen'), t('orgMixed')][i]}
                </Txt>
              </View>
            ))}
          </View>
          <SegmentedInline
            testID="ov-gender-as"
            label={t('orgShowAs')}
            value={as}
            onChange={setAs}
            options={[
              { key: 'percent', label: t('orgShowPercent') },
              { key: 'numbers', label: t('orgShowNumbers') },
            ]}
          />
        </SectionCard>
      </Grid>
    </View>
  );
}

/** A ring split in parts, the total in the middle, a legend with a dot per part (Circle21 ref 04). */
function SplitRing({ labels, values, colors }: { labels: string[]; values: number[]; colors: string[] }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xl }}>
      <Ring label={labels.map((l, i) => `${l} ${values[i]}`).join(', ')} parts={values.map((value, i) => ({ value, color: colors[i] }))}>
        <Txt style={displayText(28)}>{String(values.reduce((a, b) => a + b, 0))}</Txt>
      </Ring>
      <View style={{ flex: 1, gap: space.sm }}>
        {labels.map((l, i) => (
          <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors[i] }} />
            <Txt numberOfLines={1} style={{ flex: 1, fontSize: 13 }} color={theme.colors.outline}>
              {l}
            </Txt>
            <Txt style={{ fontSize: 13, fontWeight: '700' }}>{String(values[i])}</Txt>
          </View>
        ))}
      </View>
    </View>
  );
}
