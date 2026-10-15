import { useRef, useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useT, type T } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { SectionHeader } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Card, Chip, Dialog, IconButton, ListGroup, ListRow, Screen, TextField, Txt } from '../../../core/widgets/kit';
import { DateField } from '../../../core/widgets/pickers';
import { organizerApi, useRefreshCompetition } from './api';
import { nextWodNumber, SCORE_TYPES, wodBody, wodDraft, wodValid, type WodDraft } from './logic';

const scoreLabels = (t: T): Record<string, string> => ({
  MOVEMENT_REPS: t('orgScoreMovementReps'),
  REPS: t('orgScoreReps'),
  TIME: t('orgScoreTime'),
  ROUNDS_REPS: t('orgScoreRoundsReps'),
  LOAD: t('orgScoreLoad'),
  MAX_WEIGHT: t('orgScoreMaxWeight'),
  DISTANCE: t('orgScoreDistance'),
  CALORIES: t('orgScoreCalories'),
  POINTS: t('orgScorePoints'),
  COMPLEX: t('orgScoreComplex'),
});

export function WodsTab({ c }: { c: Json }) {
  const t = useT();
  const api = useApi();
  const { colors } = useTheme();
  const refresh = useRefreshCompetition();
  const workouts: Json[] = [...(c.workouts ?? [])].sort((a, b) => a.number - b.number);
  const [edit, setEdit] = useState<WodDraft | null>(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const labels = scoreLabels(t);
  const defaults = { number: nextWodNumber(workouts), start: new Date(c.eventStart), end: new Date(c.eventEnd) };

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  const save = (d: WodDraft) => run(() => (d.id ? organizerApi(api).updateWod(c.id, d.id, wodBody(d)) : organizerApi(api).addWod(c.id, wodBody(d))), () => setEdit(null));
  const remove = (d: WodDraft) => run(() => organizerApi(api).removeWod(c.id, d.id!), () => setEdit(null));
  function move(i: number, dir: -1 | 1) {
    const order = workouts.map((w) => w.id as string);
    [order[i], order[i + dir]] = [order[i + dir], order[i]];
    void run(() => organizerApi(api).reorderWods(c.id, order));
  }

  if (edit) return <WodForm draft={edit} categories={c.categories ?? []} busy={busy} error={error} labels={labels} onSave={save} onDelete={remove} onCancel={() => setEdit(null)} />;
  return (
    <Screen>
      {workouts.length === 0 ? (
        <Txt color={colors.outline}>{t('orgNoWods')}</Txt>
      ) : (
        <ListGroup>
          {workouts.map((w, i) => (
            <ListRow
              key={w.id}
              testID={`wod-${w.id}`}
              title={`${w.number}. ${w.name}`}
              subtitle={labels[w.scoreType] ?? w.scoreType}
              onPress={() => setEdit(wodDraft(w, defaults))}
              trailing={
                <View style={{ flexDirection: 'row' }}>
                  {i > 0 ? <IconButton icon="arrow-upward" label={t('orgMoveUp')} onPress={() => move(i, -1)} /> : null}
                  {i < workouts.length - 1 ? <IconButton icon="arrow-downward" label={t('orgMoveDown')} onPress={() => move(i, 1)} /> : null}
                </View>
              }
            />
          ))}
        </ListGroup>
      )}
      <ErrorText error={error} />
      <Button testID="wod-new" icon="add" label={t('orgNewWod')} onPress={() => setEdit(wodDraft(null, defaults))} />
    </Screen>
  );
}

function WodForm({ draft, categories, busy, error, labels, onSave, onDelete, onCancel }: { draft: WodDraft; categories: Json[]; busy: boolean; error: unknown; labels: Record<string, string>; onSave: (d: WodDraft) => void; onDelete: (d: WodDraft) => void; onCancel: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const [d, setD] = useState(draft);
  const [deleting, setDeleting] = useState(false);
  const set = (k: 'name' | 'description' | 'standards' | 'table' | 'max' | 'min' | 'capMin' | 'videoUrl') => (v: string) => setD({ ...d, [k]: v });
  const setMove = (i: number, k: 'name' | 'points', v: string) => setD({ ...d, movements: d.movements.map((m, j) => (j === i ? { ...m, [k]: v } : m)) });
  const setVariant = (i: number, k: 'description' | 'standards' | 'capMin', v: string) => setD({ ...d, variants: d.variants.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  const withoutVersion = categories.filter((k) => !d.variants.some((v) => v.categoryId === k.id));
  const ok = wodValid(d);
  return (
    <Screen>
      <Card style={{ gap: space.md }}>
        <TextField testID="wod-name" label={t('orgWodName')} value={d.name} onChangeText={set('name')} maxLength={80} />
        <TextField testID="wod-description" label={t('orgWodDescription')} value={d.description} onChangeText={set('description')} maxLength={5000} multiline />
        <TextField testID="wod-standards" label={t('orgStandards')} value={d.standards} onChangeText={set('standards')} maxLength={5000} multiline />
        <SectionHeader title={t('orgScoreType')} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {SCORE_TYPES.map((s) => (
            <Chip key={s} testID={`wod-type-${s}`} label={labels[s]} selected={d.scoreType === s} onPress={() => setD({ ...d, scoreType: s })} />
          ))}
        </View>
        {d.scoreType === 'MOVEMENT_REPS' ? (
          <>
            <SectionHeader title={t('orgMovements')} />
            {d.movements.map((m, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <View style={{ flex: 2 }}>
                  <TextField testID={`wod-move-name-${i}`} label={t('orgMovementName')} value={m.name} onChangeText={(v) => setMove(i, 'name', v)} maxLength={80} />
                </View>
                <View style={{ flex: 1 }}>
                  <TextField testID={`wod-move-points-${i}`} label={t('orgPointsPerRep')} value={m.points} onChangeText={(v) => setMove(i, 'points', v)} keyboardType="decimal-pad" />
                </View>
                {d.movements.length > 1 ? <IconButton icon="close" label={t('orgRemoveMovement')} onPress={() => setD({ ...d, movements: d.movements.filter((_, j) => j !== i) })} /> : null}
              </View>
            ))}
            <Button testID="wod-move-add" kind="text" icon="add" label={t('orgAddMovement')} onPress={() => setD({ ...d, movements: [...d.movements, { name: '', points: '1' }] })} />
          </>
        ) : null}
        <SectionHeader title={t('orgScoring')} />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Chip testID="wod-method-direct" label={t('orgScoringDirect')} selected={d.method === 'DIRECT_POINTS'} onPress={() => setD({ ...d, method: 'DIRECT_POINTS' })} />
          <Chip testID="wod-method-placement" label={t('orgScoringPlacement')} selected={d.method === 'PLACEMENT_POINTS'} onPress={() => setD({ ...d, method: 'PLACEMENT_POINTS' })} />
        </View>
        {d.method === 'PLACEMENT_POINTS' ? <TextField testID="wod-table" label={t('orgPlacementTable')} value={d.table} onChangeText={set('table')} /> : null}
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <TextField testID="wod-max" label={t('orgMaxPoints')} value={d.max} onChangeText={set('max')} keyboardType="number-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <TextField testID="wod-min" label={t('orgMinPoints')} value={d.min} onChangeText={set('min')} keyboardType="number-pad" />
          </View>
        </View>
        <TextField testID="wod-cap" label={t('orgTimeCap')} value={d.capMin} onChangeText={set('capMin')} keyboardType="decimal-pad" />
        <TextField testID="wod-video" label={t('orgVideoUrl')} value={d.videoUrl} onChangeText={set('videoUrl')} keyboardType="url" autoCapitalize="none" maxLength={500} />
        <DateField mode="datetime" label={t('orgSubmissionStart')} value={d.start} onChange={(v) => setD({ ...d, start: v })} />
        <DateField mode="datetime" label={t('orgSubmissionEnd')} value={d.end} onChange={(v) => setD({ ...d, end: v })} />
        <SectionHeader title={t('orgVariants')} />
        <Txt variant="small" color={colors.outline}>
          {t('orgVariantsHint')}
        </Txt>
        {d.variants.map((v, i) => (
          <Card key={v.categoryId} testID={`wod-variant-${v.categoryId}`} style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Txt variant="title">{categories.find((k) => k.id === v.categoryId)?.name ?? '—'}</Txt>
              <IconButton icon="close" label={t('orgVariantRemove')} onPress={() => setD({ ...d, variants: d.variants.filter((_, j) => j !== i) })} />
            </View>
            <TextField testID={`wod-variant-desc-${v.categoryId}`} label={t('orgWodDescription')} value={v.description} onChangeText={(x) => setVariant(i, 'description', x)} maxLength={5000} multiline />
            <TextField testID={`wod-variant-standards-${v.categoryId}`} label={t('orgStandards')} value={v.standards} onChangeText={(x) => setVariant(i, 'standards', x)} maxLength={5000} multiline />
            <TextField testID={`wod-variant-cap-${v.categoryId}`} label={t('orgTimeCap')} value={v.capMin} onChangeText={(x) => setVariant(i, 'capMin', x)} keyboardType="decimal-pad" />
          </Card>
        ))}
        {withoutVersion.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {withoutVersion.map((k) => (
              <Chip key={k.id} testID={`wod-variant-add-${k.id}`} icon="add" label={k.name} onPress={() => setD({ ...d, variants: [...d.variants, { categoryId: k.id, description: d.description, standards: d.standards, capMin: d.capMin }] })} />
            ))}
          </View>
        ) : null}
        <SectionHeader title={t('orgRelease')} />
        <DateField testID="wod-release" mode="datetime" label={t('orgReleaseAt')} value={d.releaseAt} placeholder={t('orgReleaseNow')} onChange={(releaseAt) => setD({ ...d, releaseAt })} />
        {d.releaseAt ? <Button testID="wod-release-now" kind="text" icon="visibility" label={t('orgReleaseNowButton')} onPress={() => setD({ ...d, releaseAt: new Date() })} /> : null}
        {!ok && d.description.trim().length > 0 ? <Txt variant="small" color={colors.error}>{t('orgWodInvalid')}</Txt> : null}
        <ErrorText error={error} />
        <Button testID="wod-save" label={t('save')} busy={busy} disabled={!ok} onPress={() => onSave(d)} />
        {d.id ? <Button testID="wod-delete" kind="outlined" icon="delete" label={t('orgWodDelete')} busy={busy} onPress={() => setDeleting(true)} /> : null}
        <Button kind="text" label={t('cancel')} onPress={onCancel} />
      </Card>
      <Dialog
        visible={deleting}
        title={t('orgWodDelete')}
        message={t('orgWodDeleteConfirm', { name: d.name })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        destructive
        onConfirm={() => {
          setDeleting(false);
          onDelete(d);
        }}
        onCancel={() => setDeleting(false)}
      />
    </Screen>
  );
}
