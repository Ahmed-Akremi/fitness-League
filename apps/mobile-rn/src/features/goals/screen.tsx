import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Json } from '../../core/api/client';
import { useLocale, useT } from '../../core/prefs';
import { useApi } from '../../core/services';
import { useTheme } from '../../core/theme';
import { formatMetric, localized } from '../../core/utils/format';
import { EmptyState, Loading, StatCard, StatusPill, XpBar } from '../../core/widgets/common';
import { ErrorText, ErrorView } from '../../core/widgets/error';
import { Button, Fab, IconButton, Txt } from '../../core/widgets/kit';
import { Select } from '../../core/widgets/pickers';
import { useMe } from '../me/api';
import { useExercises } from '../reference/api';
import { goalsApi, goalsKey, useGoals } from './api';

/** Personal goals (embedded in the Goals tab). */
export function GoalsList() {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const goals = useGoals();
  const [creating, setCreating] = useState(false);
  return (
    <View style={{ flex: 1 }}>
      {goals.isError ? (
        <ErrorView error={goals.error} onRetry={() => goals.refetch()} />
      ) : !goals.data ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 96, gap: 12 }}>
          {goals.data.length === 0 && <EmptyState icon="flag" message={t('emptyGoals')} />}
          {goals.data.map((g) => {
            const unit = g.metric?.unit ?? '';
            const milestones: unknown[] = g.milestones ?? [];
            return (
              <StatCard
                key={g.id}
                label={`${g.type} · ${g.metric?.code}`}
                trailing={
                  g.status === 'ACTIVE' ? (
                    <IconButton
                      icon="close"
                      label={t('delete')}
                      onPress={async () => {
                        await goalsApi(api).abandon(g.id);
                        await qc.invalidateQueries({ queryKey: goalsKey });
                      }}
                    />
                  ) : (
                    <StatusPill label={g.status} color={colors.outline} />
                  )
                }
              >
                <Txt variant="headline">{`${formatMetric(g.startValue, unit, locale)} → ${formatMetric(g.targetValue, unit, locale)}`}</Txt>
                <View style={{ marginVertical: 8 }}>
                  <XpBar value={milestones.length === 0 ? 0 : g.milestonesReached / milestones.length} />
                </View>
                <Txt variant="small">{t('goalMilestones', { reached: g.milestonesReached ?? 0, total: milestones.length })}</Txt>
              </StatCard>
            );
          })}
          <Txt variant="small" color={colors.outline} style={{ textAlign: 'center', marginTop: 12 }}>{t('challengesComingSoon')}</Txt>
        </ScrollView>
      )}
      <Fab testID="goals-new" icon="flag" label={t('newGoal')} onPress={() => setCreating(true)} />
      {creating && <NewGoalSheet onClose={() => setCreating(false)} />}
    </View>
  );
}

/** Strength goal from suggestions (spec §10). The disclaimer is shown once here, as the spec asks. */
function NewGoalSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const me = useMe().data;
  const primary = (me?.profile?.sports as Json[] | undefined)?.find((s) => s.isPrimary === true);
  const exercises = useExercises(primary?.id);
  const [exerciseId, setExerciseId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Json | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function load(id: string) {
    setExerciseId(id);
    setSuggestions(null);
    setError(null);
    try {
      setSuggestions(await goalsApi(api).suggestions('STRENGTH', id, 'E1RM'));
    } catch (e) {
      setError(e);
    }
  }

  async function create(target: number) {
    setBusy(true);
    try {
      await goalsApi(api).create({ type: 'STRENGTH', exerciseId, metricCode: 'E1RM', targetValue: target, wasSuggested: true });
      await qc.invalidateQueries({ queryKey: goalsKey });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const e1rm = (exercises.data ?? []).filter((e) => Array.isArray(e.trackedMetrics) && (e.trackedMetrics as string[]).includes('E1RM'));
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Txt variant="title" style={{ flex: 1, fontSize: 20 }}>{t('newGoal')}</Txt>
              <IconButton icon="close" label={t('cancel')} onPress={onClose} />
            </View>
            {primary &&
              (exercises.isError ? (
                <ErrorView error={exercises.error} />
              ) : !exercises.data ? (
                <Loading />
              ) : (
                <Select testID="goal-exercise" label={t('exercise')} value={exerciseId} options={e1rm.map((e) => ({ value: e.id, label: localized(e.name, locale) }))} onChange={load} />
              ))}
            {suggestions && (
              <>
                <Txt variant="title">{t('goalSuggestions')}</Txt>
                {((suggestions.suggestions as Json[]) ?? []).map((s, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Txt variant="title" style={{ fontSize: 20 }}>{formatMetric(s.targetValue, 'kg', locale)}</Txt>
                      <Txt variant="small">{t('goalEta', { min: s.etaWeeks?.min ?? 0, max: s.etaWeeks?.max ?? 0 })}</Txt>
                    </View>
                    <Button testID={`goal-save-${i}`} kind="tonal" label={t('save')} disabled={busy} onPress={() => create(s.targetValue)} />
                  </View>
                ))}
                <Txt variant="small" color={colors.outline}>{t('goalsDisclaimer')}</Txt>
              </>
            )}
            <ErrorText error={error} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
