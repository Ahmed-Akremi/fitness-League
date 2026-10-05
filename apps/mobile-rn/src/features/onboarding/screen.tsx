import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLocale, useT } from '../../core/prefs';
import { useApi } from '../../core/services';
import { displayText, useTheme } from '../../core/theme';
import { localized } from '../../core/utils/format';
import { Loading, XpBar } from '../../core/widgets/common';
import { ErrorText, ErrorView } from '../../core/widgets/error';
import { Button, Chip, TextField, Txt } from '../../core/widgets/kit';
import { meApi, meKey } from '../me/api';
import { useExercises, useSports, type RefItem } from '../reference/api';

const SUGGESTED = ['BACK_SQUAT', 'BENCH_PRESS', 'DEADLIFT', 'RUN'];

export function OnboardingScreen() {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const qc = useQueryClient();
  const sports = useSports();
  const [step, setStep] = useState(0);
  const [sportIds, setSportIds] = useState<string[]>([]);
  const [primary, setPrimary] = useState<string | null>(null);
  const [days, setDays] = useState(3);
  const [baselines, setBaselines] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function toggle(id: string) {
    if (!sportIds.includes(id)) {
      setSportIds([...sportIds, id]);
      setPrimary(primary ?? id);
    } else if (primary !== id) {
      setPrimary(id); // second tap on a selected sport makes it the main one
    } else {
      const rest = sportIds.filter((s) => s !== id);
      setSportIds(rest);
      setPrimary(rest[0] ?? null);
    }
  }

  async function finish(exercises: RefItem[], values: Record<string, string>) {
    setBusy(true);
    setError(null);
    const repo = meApi(api);
    try {
      await repo.setSports(sportIds, primary!);
      await repo.updateProfile({ plannedTrainingDaysPerWeek: days });
      const entries = Object.entries(values).flatMap(([exerciseId, text]) => {
        const v = Number(text.replace(',', '.'));
        if (!text.trim() || !Number.isFinite(v) || v <= 0) return [];
        const isRun = exercises.find((e) => e.id === exerciseId)?.code === 'RUN';
        return [{ exerciseId, metricCode: isRun ? 'TIME_5K' : 'E1RM', value: isRun ? v * 60 : v }];
      });
      if (entries.length) await repo.declareBaselines(entries);
      await repo.completeOnboarding();
      await qc.invalidateQueries({ queryKey: meKey }); // the guard leaves onboarding once /me says it's completed
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const titles = [t('onboardingSportsTitle'), t('onboardingPlanTitle'), t('onboardingBaselineTitle')];
  const subtitles = [t('onboardingSportsSubtitle'), t('onboardingPlanSubtitle'), t('onboardingBaselineSubtitle')];

  let body;
  if (step === 0) {
    body = sports.isError ? (
      <ErrorView error={sports.error} onRetry={() => sports.refetch()} />
    ) : !sports.data ? (
      <Loading />
    ) : (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {sports.data.map((s) => (
          <Chip key={s.id} testID={`sport-${s.code}`} icon={primary === s.id ? 'star' : undefined} label={localized(s.name, locale)} selected={sportIds.includes(s.id)} onPress={() => toggle(s.id)} />
        ))}
      </View>
    );
  } else if (step === 1) {
    body = (
      <View style={{ alignItems: 'center', gap: 16 }}>
        <Txt style={[displayText(72), { color: colors.primary }]}>{String(days)}</Txt>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[1, 2, 3, 4, 5, 6].map((d) => (
            <Chip key={d} testID={`plan-days-${d}`} label={String(d)} selected={d === days} onPress={() => setDays(d)} />
          ))}
        </View>
      </View>
    );
  } else {
    body = <BaselineStep sportId={primary!} values={baselines} onChange={setBaselines} busy={busy} onDone={finish} />;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1, padding: 24, gap: 8 }}>
        <XpBar value={(step + 1) / 3} />
        <Txt variant="headline" style={{ marginTop: 20 }}>{titles[step]}</Txt>
        <Txt color={colors.outline} style={{ marginBottom: 20 }}>{subtitles[step]}</Txt>
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">{body}</ScrollView>
        <ErrorText error={error} />
        {step < 2 && <Button testID="onboarding-next" label={t('continueLabel')} disabled={sportIds.length === 0} onPress={() => setStep(step + 1)} />}
      </View>
    </SafeAreaView>
  );
}

/** Optional self-declared level for the main sport. Only a hint: calibration sets the real baseline. */
function BaselineStep({ sportId, values, onChange, busy, onDone }: { sportId: string; values: Record<string, string>; onChange: (v: Record<string, string>) => void; busy: boolean; onDone: (all: RefItem[], values: Record<string, string>) => void }) {
  const t = useT();
  const locale = useLocale();
  const exercises = useExercises(sportId);
  if (exercises.isError) return <ErrorView error={exercises.error} />;
  if (!exercises.data) return <Loading />;
  const all = exercises.data;
  const list = all.filter((e) => SUGGESTED.includes(e.code ?? ''));
  return (
    <View style={{ gap: 12 }}>
      {list.map((e) => (
        <TextField
          key={e.id}
          testID={`baseline-${e.code}`}
          label={`${localized(e.name, locale)} · ${e.code === 'RUN' ? `5K · ${t('timeMin')}` : `1RM · ${t('weightKg')}`}`}
          keyboardType="decimal-pad"
          value={values[e.id] ?? ''}
          onChangeText={(v) => onChange({ ...values, [e.id]: v })}
        />
      ))}
      <Button testID="onboarding-finish" label={t('onboardingDone')} busy={busy} onPress={() => onDone(all, values)} style={{ marginTop: 12 }} />
      <Button kind="text" label={t('skip')} disabled={busy} onPress={() => onDone(all, {})} />
    </View>
  );
}
