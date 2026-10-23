import { View } from 'react-native';

import { useT } from '../../../core/prefs';
import { space, useTheme } from '../../../core/theme';
import { SectionHeader } from '../../../core/widgets/common';
import { Button, Card, Chip, IconButton, TextField, Txt } from '../../../core/widgets/kit';
import { LocalBadge } from './local-badge';
import { scorecardProblems, scorecardTotal, type Penalties, type Scorecard, type ScMove, type ScSet, type TieBreak } from './logic-scorecard';

export type WodExtras = { scorecard: Scorecard; penalties: Penalties; tieBreak: TieBreak };

const num = (v: string) => (v.trim() === '' ? 0 : Number(v.replace(',', '.')) || 0);

/** Phase 6: what the judge counts (sets, rounds, increments, movements counted every N), penalties and tie-break. Kept on the device for now. */
export function WodExtrasFields({ value, onChange }: { value: WodExtras; onChange: (x: WodExtras) => void }) {
  const t = useT();
  const { colors } = useTheme();
  const sc = value.scorecard;
  const setSc = (scorecard: Scorecard) => onChange({ ...value, scorecard });
  const setSet = (i: number, patch: Partial<ScSet>) => setSc({ ...sc, sets: sc.sets.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setMove = (i: number, k: number, patch: Partial<ScMove>) => setSet(i, { movements: sc.sets[i].movements.map((m, j) => (j === k ? { ...m, ...patch } : m)) });
  const setPen = (patch: Partial<Penalties>) => onChange({ ...value, penalties: { ...value.penalties, ...patch } });
  const problems = scorecardProblems(sc);
  const tbs: TieBreak[] = ['NONE', 'TIME', 'REPS'];

  return (
    <>
      <SectionHeader title={t('scSets')} />
      <View style={{ alignSelf: 'flex-start' }}>
        <LocalBadge />
      </View>
      {sc.sets.map((s, i) => (
        <Card key={i} style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
            <TextField testID={`sc-set-name-${i}`} style={{ flex: 1 }} label={t('scSetName')} value={s.name} onChangeText={(name) => setSet(i, { name })} maxLength={60} />
            <IconButton testID={`sc-set-remove-${i}`} icon="delete" label={t('orgFormRemove')} onPress={() => setSc({ sets: sc.sets.filter((_, j) => j !== i), tieBreakAfterSet: null })} />
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <TextField testID={`sc-set-rounds-${i}`} label={t('scRounds')} value={String(s.rounds)} onChangeText={(v) => setSet(i, { rounds: num(v) })} keyboardType="number-pad" />
            </View>
            <View style={{ flex: 1 }}>
              <TextField testID={`sc-set-inc-${i}`} label={t('scIncrement')} value={String(s.increment)} onChangeText={(v) => setSet(i, { increment: num(v) })} keyboardType="number-pad" />
            </View>
          </View>
          {s.movements.map((m, k) => (
            <View key={k} style={{ gap: space.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
                <TextField testID={`sc-move-name-${i}-${k}`} style={{ flex: 1 }} label={t('scMoveName')} value={m.name} onChangeText={(name) => setMove(i, k, { name })} maxLength={80} />
                <IconButton testID={`sc-move-remove-${i}-${k}`} icon="close" label={t('orgFormRemove')} onPress={() => setSet(i, { movements: s.movements.filter((_, j) => j !== k) })} />
              </View>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <TextField testID={`sc-move-reps-${i}-${k}`} label={t('scMoveReps')} value={String(m.reps)} onChangeText={(v) => setMove(i, k, { reps: num(v) })} keyboardType="number-pad" />
                </View>
                <View style={{ flex: 1 }}>
                  <TextField testID={`sc-move-unit-${i}-${k}`} label={t('scMoveUnit')} value={m.unit} onChangeText={(unit) => setMove(i, k, { unit })} maxLength={12} />
                </View>
                <View style={{ flex: 1 }}>
                  <TextField testID={`sc-move-every-${i}-${k}`} label={t('scMoveEvery')} value={String(m.countEvery)} onChangeText={(v) => setMove(i, k, { countEvery: num(v) })} keyboardType="number-pad" />
                </View>
              </View>
            </View>
          ))}
          <Button testID={`sc-move-add-${i}`} kind="text" icon="add" label={t('scMoveAdd')} onPress={() => setSet(i, { movements: [...s.movements, { name: '', reps: 0, unit: 'Reps', countEvery: 1 }] })} />
        </Card>
      ))}
      <Button testID="sc-set-add" kind="outlined" icon="add" label={t('scSetAdd')} onPress={() => setSc({ ...sc, sets: [...sc.sets, { name: `Set ${sc.sets.length + 1}`, rounds: 1, increment: 0, movements: [] }] })} />
      {sc.sets.length > 0 && <Txt testID="sc-total" style={{ fontWeight: '700' }}>{t('scTotal', { count: scorecardTotal(sc) })}</Txt>}
      {sc.sets.length > 1 && (
        <>
          <Txt variant="label" color={colors.outline}>{t('scTieBreakAfter')}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Chip testID="sc-tb-none" label={t('scTieBreakNone')} selected={sc.tieBreakAfterSet == null} onPress={() => setSc({ ...sc, tieBreakAfterSet: null })} />
            {sc.sets.map((s, i) => (
              <Chip key={i} testID={`sc-tb-${i + 1}`} label={s.name || String(i + 1)} selected={sc.tieBreakAfterSet === i + 1} onPress={() => setSc({ ...sc, tieBreakAfterSet: i + 1 })} />
            ))}
          </View>
        </>
      )}
      {problems.length > 0 && sc.sets.some((s) => s.movements.length > 0) && <Txt variant="small" color={colors.error}>{t('scProblem')}</Txt>}

      <SectionHeader title={t('wodTieBreak')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {tbs.map((k) => (
          <Chip key={k} testID={`wod-tb-${k}`} label={t(`wodTb${k}`)} selected={value.tieBreak === k} onPress={() => onChange({ ...value, tieBreak: k })} />
        ))}
      </View>
      <SectionHeader title={t('wodPenalties')} />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <TextField testID="wod-pen-norep" label={t('wodPenNoRep')} value={String(value.penalties.noRepSeconds)} onChangeText={(v) => setPen({ noRepSeconds: num(v) })} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <TextField testID="wod-pen-missed" label={t('wodPenMissed')} value={String(value.penalties.missedRepSeconds)} onChangeText={(v) => setPen({ missedRepSeconds: num(v) })} keyboardType="number-pad" />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <TextField testID="wod-pen-minor" label={t('wodPenMinor')} value={String(value.penalties.minorPct)} onChangeText={(v) => setPen({ minorPct: num(v) })} keyboardType="decimal-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <TextField testID="wod-pen-major" label={t('wodPenMajor')} value={String(value.penalties.majorPct)} onChangeText={(v) => setPen({ majorPct: num(v) })} keyboardType="decimal-pad" />
        </View>
      </View>
    </>
  );
}
