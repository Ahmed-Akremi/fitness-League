import { useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { EmptyState, SectionHeader } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Card, Chip, IconButton, ListRow, Screen, TextField, Txt, toast } from '../../../core/widgets/kit';
import { organizerApi, useRefreshCompetition } from './api';
import { LocalBadge } from './local-badge';
import { eventStyleOf, wodBody, wodDraft } from './logic';
import { customFlow, flowOf, flowProblems, hyroxFlow, moveStage, stagesLocked, type Flow, type ScoringRule, type Stage } from './logic-hybrid';
import { OrgPageHeader } from './page';

const num = (v: string) => (v.trim() === '' ? 0 : Number(v.replace(',', '.')) || 0);
const stageId = () => `st_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Phase 7: the race of a hybrid event. Functional-fitness events are pointed to General. */
export function RaceTab({ c }: { c: Json }) {
  const t = useT();
  if (eventStyleOf(c) !== 'HYBRID_RACE') {
    return (
      <>
        <OrgPageHeader tab="race" />
        <EmptyState icon="directions-run" message={t('raceOnlyHybrid')} />
      </>
    );
  }
  return <RaceEditor c={c} />;
}

function RaceEditor({ c }: { c: Json }) {
  const t = useT();
  const api = useApi();
  const { colors } = useTheme();
  const refresh = useRefreshCompetition();
  const [flow, setFlow] = useState<Flow | null>(() => flowOf(c));
  const [breakAfter, setBreakAfter] = useState('');
  const [breakSec, setBreakSec] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!flow) {
    return (
      <>
        <OrgPageHeader tab="race" />
        <Screen>
          <SectionHeader title={t('raceChoose')} />
          <Card style={{ gap: space.sm }}>
            <Chip testID="race-template-HYROX_STYLE" label={t('orgTemplateHyrox')} onPress={() => setFlow(hyroxFlow())} />
            <Txt variant="small" color={colors.outline}>{t('raceHyroxHint')}</Txt>
          </Card>
          <Card style={{ gap: space.sm }}>
            <Chip testID="race-template-CUSTOM" label={t('orgTemplateCustom')} onPress={() => setFlow(customFlow())} />
            <Txt variant="small" color={colors.outline}>{t('raceCustomHint')}</Txt>
          </Card>
        </Screen>
      </>
    );
  }

  const f = flow;
  const locked = stagesLocked(f);
  const problems = flowProblems(f);
  const setStage = (i: number, patch: Partial<Stage>) => setFlow({ ...f, stages: f.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setRule = (rule: ScoringRule | null) => setFlow({ ...f, scoringRule: rule });
  const totals: Flow['totalScoring'][] = ['TIME', 'REPS', 'CALORIES', 'DISTANCE'];

  /** Saves the race on the device; the first time, a server WOD « Race » is made so the event can be published. */
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await organizerApi(api).update(c.id, { flow: f });
      if (!(c.workouts ?? []).length) {
        const d = { ...wodDraft(null, { number: 1, start: new Date(c.eventStart), end: new Date(c.eventEnd) }), name: t('raceAnchorName'), description: t('raceAnchorDescription'), scoreType: 'TIME', movements: [] };
        await organizerApi(api).addWod(c.id, wodBody(d));
      }
      toast(t('orgSaved'));
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <OrgPageHeader tab="race" />
      <Screen>
        <View style={{ alignSelf: 'flex-start' }}>
          <LocalBadge />
        </View>
        <Txt variant="title">{locked ? t('orgTemplateHyrox') : t('orgTemplateCustom')}</Txt>
        {locked && <Txt color={colors.outline}>{t('raceLocked')}</Txt>}

        <SectionHeader title={t('raceStages')} />
        {f.stages.map((s, i) =>
          locked ? (
            <ListRow key={s.id} testID={`race-stage-${i}`} title={s.name} subtitle={`${s.kind === 'TRANSITION' ? t('raceRun') : t('raceStation')} · ${s.target} ${s.unit}`} />
          ) : (
            <Card key={s.id} testID={`race-stage-${i}`} style={{ gap: space.xs }}>
              <Txt variant="label" color={colors.outline}>{`${i + 1} · ${s.kind === 'TRANSITION' ? t('raceRun') : t('raceStation')}`}</Txt>
              <TextField testID={`race-stage-name-${i}`} label={t('raceStageName')} value={s.name} onChangeText={(name) => setStage(i, { name })} maxLength={60} />
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <TextField testID={`race-stage-target-${i}`} label={t('raceStageTarget')} value={String(s.target)} onChangeText={(v) => setStage(i, { target: num(v) })} keyboardType="number-pad" />
                </View>
                <View style={{ flex: 1 }}>
                  <TextField testID={`race-stage-unit-${i}`} label={t('raceStageUnit')} value={s.unit} onChangeText={(unit) => setStage(i, { unit })} maxLength={12} />
                </View>
              </View>
              <View style={{ flexDirection: 'row' }}>
                {i > 0 ? <IconButton testID={`race-up-${i}`} icon="arrow-upward" label={t('orgMoveUp')} onPress={() => setFlow(moveStage(f, i, -1))} /> : null}
                {i < f.stages.length - 1 ? <IconButton testID={`race-down-${i}`} icon="arrow-downward" label={t('orgMoveDown')} onPress={() => setFlow(moveStage(f, i, 1))} /> : null}
                <IconButton testID={`race-remove-${i}`} icon="delete" label={t('orgFormRemove')} onPress={() => setFlow({ ...f, stages: f.stages.filter((_, j) => j !== i), breaks: [] })} />
              </View>
            </Card>
          ),
        )}
        {!locked && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Button testID="race-add-station" kind="outlined" icon="add" label={t('raceAddStation')} onPress={() => setFlow({ ...f, stages: [...f.stages, { id: stageId(), name: '', kind: 'STATION', scoring: 'TIME', target: 0, unit: 'Reps' }] })} />
            <Button testID="race-add-run" kind="outlined" icon="directions-run" label={t('raceAddRun')} onPress={() => setFlow({ ...f, stages: [...f.stages, { id: stageId(), name: t('raceRun'), kind: 'TRANSITION', scoring: 'NONE', target: 400, unit: 'M' }] })} />
          </View>
        )}

        <TextField testID="race-cap" label={t('raceCap')} value={f.timeCapSec ? String(f.timeCapSec / 60) : ''} onChangeText={(v) => setFlow({ ...f, timeCapSec: v.trim() ? Math.round(num(v) * 60) || null : null })} keyboardType="decimal-pad" />
        <Txt variant="label" color={colors.outline}>{t('raceTotal')}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {totals.map((k) => (
            <Chip key={k} testID={`race-total-${k}`} label={t(`raceTotal${k}`)} selected={f.totalScoring === k} onPress={() => setFlow({ ...f, totalScoring: k })} />
          ))}
        </View>

        <SectionHeader title={t('raceBreaks')} />
        {f.breaks.map((b, i) => (
          <ListRow key={i} testID={`race-break-${i}`} title={t('raceBreakLine', { seconds: b.seconds, stage: b.afterStage })} trailing={<IconButton icon="delete" label={t('orgFormRemove')} onPress={() => setFlow({ ...f, breaks: f.breaks.filter((_, j) => j !== i) })} />} />
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
          <TextField testID="race-break-after" style={{ flex: 1 }} label={t('raceBreakAfter')} value={breakAfter} onChangeText={setBreakAfter} keyboardType="number-pad" />
          <TextField testID="race-break-sec" style={{ flex: 1 }} label={t('raceBreakSeconds')} value={breakSec} onChangeText={setBreakSec} keyboardType="number-pad" />
          <Button
            testID="race-break-add"
            kind="tonal"
            label={t('locAdd')}
            disabled={!(num(breakAfter) >= 1 && num(breakSec) > 0)}
            onPress={() => {
              setFlow({ ...f, breaks: [...f.breaks, { afterStage: num(breakAfter), seconds: num(breakSec) }] });
              setBreakAfter('');
              setBreakSec('');
            }}
          />
        </View>

        <SectionHeader title={t('raceRule')} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Chip testID="race-rule-none" label={t('raceRuleNone')} selected={!f.scoringRule} onPress={() => setRule(null)} />
          {(['ADD', 'REMOVE'] as const).map((op) => (
            <Chip key={op} testID={`race-rule-${op}`} label={t(`raceRule${op}`)} selected={f.scoringRule?.op === op} onPress={() => setRule({ op, value: f.scoringRule?.value ?? null, unit: f.scoringRule?.unit ?? 'SEC' })} />
          ))}
        </View>
        {f.scoringRule && (
          <>
            <TextField testID="race-rule-value" label={t('raceRuleValue')} value={f.scoringRule.value == null ? '' : String(f.scoringRule.value)} onChangeText={(v) => setRule({ ...f.scoringRule!, value: v.trim() ? num(v) : null })} keyboardType="number-pad" />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {(['SEC', 'REP'] as const).map((u) => (
                <Chip key={u} testID={`race-rule-unit-${u}`} label={t(`raceRuleUnit${u}`)} selected={f.scoringRule!.unit === u} onPress={() => setRule({ ...f.scoringRule!, unit: u })} />
              ))}
            </View>
          </>
        )}

        {problems.length > 0 && f.stages.length > 0 && <Txt variant="small" color={colors.error}>{t('raceProblem')}</Txt>}
        <ErrorText error={error} />
        <Button testID="race-save" label={t('save')} busy={busy} disabled={problems.length > 0} onPress={save} />
      </Screen>
    </>
  );
}
