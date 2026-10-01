import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';

import type { Json } from '../../core/api/client';
import { useLocale, useT } from '../../core/prefs';
import { useApi } from '../../core/services';
import { displayText, useTheme } from '../../core/theme';
import { formatDate } from '../../core/utils/format';
import { EmptyState, Loading, SectionHeader } from '../../core/widgets/common';
import { ErrorView, errorMessage } from '../../core/widgets/error';
import { Button, Card, Dialog, ListRow, Segmented, Txt, toast } from '../../core/widgets/kit';
import { compKeys, competitionsApi } from './api';

type Queue = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PENALIZED';

/** Judge space (§26): submissions to review, by status. */
export function JudgeScreen() {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const [status, setStatus] = useState<Queue>('PENDING');
  const queue = useQuery({ queryKey: compKeys.judge(status), queryFn: () => competitionsApi(api).judgeQueue(status) });
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Segmented
        value={status}
        onChange={setStatus}
        options={[
          { key: 'PENDING', label: t('judgePending') },
          { key: 'APPROVED', label: t('judgeApproved') },
          { key: 'REJECTED', label: t('judgeRejected') },
          { key: 'PENALIZED', label: t('judgePenalized') },
        ]}
      />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }} refreshControl={<RefreshControl refreshing={false} onRefresh={() => queue.refetch()} tintColor={colors.primary} />}>
        {queue.isError ? (
          <ErrorView error={queue.error} onRetry={() => queue.refetch()} />
        ) : !queue.data ? (
          <Loading />
        ) : queue.data.length === 0 ? (
          <EmptyState icon="gavel" message={t('judgeNothing')} />
        ) : (
          queue.data.map((s) => (
            <Card key={s.id} testID={`review-${s.id}`} onPress={() => router.push(`/judge/${s.id}`)} style={{ paddingVertical: 4 }}>
              <ListRow
                title={`${s.athlete.fullName ?? s.athlete.username} · ${s.workout?.name ?? ''}`}
                subtitle={`${s.category?.name ?? ''} · ${formatDate(s.submittedAt, locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                trailing={<Txt style={displayText(20)}>{String(s.points ?? s.rawValue ?? '—')}</Txt>}
                chevron
              />
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}

type Action = { kind: 'reject' | 'penalty' | 'adjust' | 'needs-correction' } | null;

/** One submission (§27): athlete, WOD, score, video, then approve / reject / penalize / adjust. */
export function JudgeReviewScreen({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: compKeys.judgeDetail(id), queryFn: () => competitionsApi(api).judgeDetail(id) });
  const [action, setAction] = useState<Action>(null);
  const [step, setStep] = useState<{ value?: string }>({});
  const [busy, setBusy] = useState(false);

  async function act(kind: 'approve' | 'reject' | 'needs-correction' | 'penalty' | 'adjust-score', body: Json = {}) {
    setBusy(true);
    try {
      await competitionsApi(api).judgeAct(id, kind, body);
      await Promise.all([qc.invalidateQueries({ queryKey: ['judge'] }), qc.invalidateQueries({ queryKey: ['competitions'] })]);
      toast(t('judgeApprove'));
      if (router.canGoBack()) router.back();
    } catch (e) {
      toast(errorMessage(t, e));
    } finally {
      setBusy(false);
      setAction(null);
      setStep({});
    }
  }

  if (detail.isError) return <ErrorView error={detail.error} onRetry={() => detail.refetch()} />;
  if (!detail.data) return <Loading />;
  const s = detail.data;
  const direct = s.workout.scoringMethod === 'DIRECT_POINTS';
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Txt style={displayText(26)}>{s.athlete.fullName ?? s.athlete.username}</Txt>
      <Txt color={colors.outline}>{`${s.category?.name ?? ''} · ${s.workout.name} · ${(t as (k: string) => string)(`compStatus${s.status}`)}`}</Txt>
      <Card style={{ gap: 4 }}>
        <Txt variant="label">{t('compScore')}</Txt>
        <Txt style={displayText(36)}>{String(s.rawValue ?? '—')}</Txt>
        {s.points != null && <Txt>{t('compPoints', { points: s.points })}</Txt>}
        {s.notes ? <Txt variant="small" color={colors.outline}>{s.notes}</Txt> : null}
        <Txt variant="small" color={colors.outline}>{formatDate(s.submittedAt, locale, { dateStyle: 'medium', timeStyle: 'short' })}</Txt>
      </Card>
      {s.youtubeId && (
        <Pressable testID="watch-video" accessibilityRole="button" accessibilityLabel={t('judgeWatchVideo')} onPress={() => Linking.openURL(s.videoUrl)}>
          <Image source={{ uri: `https://i.ytimg.com/vi/${s.youtubeId}/hqdefault.jpg` }} style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 12 }} />
          <Txt color={colors.primary} style={{ marginTop: 6, fontWeight: '700' }}>{`▶ ${t('judgeWatchVideo')}`}</Txt>
        </Pressable>
      )}
      <View style={{ gap: 8 }}>
        <Button testID="judge-approve" icon="check" label={t('judgeApprove')} busy={busy} onPress={() => act('approve')} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button testID="judge-penalize" kind="tonal" label={t('judgePenalize')} disabled={busy} onPress={() => setAction({ kind: 'penalty' })} style={{ flex: 1 }} />
          <Button testID="judge-adjust" kind="tonal" label={t('judgeAdjust')} disabled={busy} onPress={() => setAction({ kind: 'adjust' })} style={{ flex: 1 }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button kind="outlined" label={t('compStatusNEEDS_CORRECTION')} disabled={busy} onPress={() => setAction({ kind: 'needs-correction' })} style={{ flex: 1 }} />
          <Button testID="judge-reject" kind="outlined" label={t('judgeReject')} disabled={busy} onPress={() => setAction({ kind: 'reject' })} style={{ flex: 1 }} />
        </View>
      </View>
      {s.versions && (
        <>
          <SectionHeader title={t('judgeHistory')} />
          {s.versions.map((v: Json) => (
            <ListRow key={v.version} title={`v${v.version} · ${t('compPoints', { points: v.points })}`} subtitle={`${v.reason} · ${formatDate(v.createdAt, locale, { dateStyle: 'short', timeStyle: 'short' })}`} />
          ))}
        </>
      )}
      {/* Two-step dialogs: value first (penalty points / new score), then the mandatory reason. */}
      <Dialog
        visible={action != null && (action.kind === 'reject' || action.kind === 'needs-correction' || step.value != null)}
        title={t('judgeReason')}
        input={{ label: t('judgeReason'), testID: 'judge-reason', valid: (x) => x.trim().length >= 3 }}
        confirmLabel={t('save')}
        cancelLabel={t('cancel')}
        onCancel={() => {
          setAction(null);
          setStep({});
        }}
        onConfirm={(reason) => {
          const v = Number((step.value ?? '').replace(',', '.'));
          if (action?.kind === 'reject') void act('reject', { reason });
          else if (action?.kind === 'needs-correction') void act('needs-correction', { reason });
          else if (action?.kind === 'penalty') void act('penalty', { type: 'POINT_PENALTY', points: v, reason });
          else if (action?.kind === 'adjust') void act('adjust-score', { ...(direct ? { points: v } : { rawValue: v }), reason });
        }}
      />
      <Dialog
        visible={action != null && (action.kind === 'penalty' || action.kind === 'adjust') && step.value == null}
        title={action?.kind === 'penalty' ? t('judgePenaltyPoints') : t('judgeNewScore')}
        input={{ label: action?.kind === 'penalty' ? t('judgePenaltyPoints') : t('judgeNewScore'), keyboardType: 'decimal-pad', testID: 'judge-value', valid: (x) => Number.isFinite(Number(x.replace(',', '.'))) && x.trim() !== '' }}
        confirmLabel={t('continueLabel')}
        cancelLabel={t('cancel')}
        onCancel={() => setAction(null)}
        onConfirm={(value) => setStep({ value })}
      />
    </ScrollView>
  );
}
