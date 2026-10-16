import { useRef, useState } from 'react';
import { FlatList, View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { EmptyState, Loading, SectionHeader } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Button, Card, Chip, Dialog, IconButton, ListGroup, ListRow, Screen, TextField, Txt, toast } from '../../../core/widgets/kit';
import { DateField, Select, type Option } from '../../../core/widgets/pickers';
import { useHeats } from '../api';
import { organizerApi, useRefreshCompetition, useRegistrations } from './api';
import { exportCsv } from './export';
import { Guide } from './guide';
import type { ManageTab } from './logic';
import { autoBody, autoValid, csvFileName, csvSeparator, filterHeats, freeLanes, heatBody, heatDays, heatDraft, heatsCsv, heatValid, laneCandidates, personName, type AutoDraft, type HeatDraft, type HeatFilter } from './logic-b';
import { ExportButton, OrgPageHeader } from './page';
import { TimetableCard } from './timetable';
import { useWideWeb } from './web';

const when = (iso: string, locale: string) => formatDate(iso, locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** « Planning » (spec §1.3 item 5): heats with their lanes, filters, automatic heats. */
export function PlanningTab({ c, onGo }: { c: Json; onGo?: (tab: ManageTab) => void }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const refresh = useRefreshCompetition();
  const heats = useHeats(c.id);
  const regs = useRegistrations(c.id);
  const [filter, setFilter] = useState<HeatFilter>({ day: null, categoryId: null, workoutId: null, q: '' });
  const [edit, setEdit] = useState<HeatDraft | null>(null);
  const [auto, setAuto] = useState<AutoDraft | null>(null);
  const [lanesOf, setLanesOf] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const wide = useWideWeb();

  async function run(fn: () => Promise<unknown>, after?: (result: Json) => void, done?: string) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Not `after?.(await fn())`: optional chaining would skip the call (and the request) when there is no `after`.
      const result = (await fn()) as Json;
      after?.(result);
      // Only once the request has succeeded: an error keeps its text, with no toast.
      if (done) toast(done);
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  if (heats.isError) return <ErrorView error={heats.error} onRetry={() => heats.refetch()} />;
  if (!heats.data) return <Loading />;
  const all: Json[] = heats.data;
  const categories: Json[] = c.categories ?? [];
  const catOptions: Option[] = categories.map((k) => ({ value: k.id, label: k.name }));
  const wodOptions: Option[] = (c.workouts ?? []).map((w: Json) => ({ value: w.id, label: `${w.number}. ${w.name}` }));
  const org = organizerApi(api);

  if (edit) {
    return (
      <HeatForm
        draft={edit}
        busy={busy}
        error={error}
        catOptions={catOptions}
        wodOptions={wodOptions}
        onSave={(d) => run(() => (d.id ? org.updateHeat(c.id, d.id, heatBody(d)) : org.addHeat(c.id, heatBody(d))), () => setEdit(null), t('orgSaved'))}
        onDelete={(d) => run(() => org.removeHeat(c.id, d.id!), () => setEdit(null), t('orgToastDeleted'))}
        onCancel={() => setEdit(null)}
      />
    );
  }
  if (auto) {
    return (
      <AutoForm
        draft={auto}
        busy={busy}
        error={error}
        catOptions={catOptions}
        wodOptions={wodOptions}
        onRun={(d) =>
          run(
            () => org.autoHeats(c.id, autoBody(d)),
            (r) => {
              setAuto(null);
              setNotice(t('orgAutoDone', { heats: r.heats, athletes: r.athletes }));
            },
          )
        }
        onCancel={() => setAuto(null)}
      />
    );
  }
  const open = lanesOf ? all.find((h) => h.id === lanesOf) : undefined;
  if (open) {
    return <LanesView heat={open} registrations={regs.data ?? []} busy={busy} error={error} onAssign={(rid, lane) => run(() => org.assignLane(c.id, open.id, rid, lane), undefined, t('orgToastLaneSet', { lane }))} onFree={(lane) => run(() => org.freeLane(c.id, open.id, lane), undefined, t('orgToastLaneFreed', { lane }))} onClose={() => setLanesOf(null)} />;
  }

  const days = heatDays(all);
  const shown = filterHeats(all, filter);
  const create = <Button testID="heat-new" icon="add" label={t('orgHeatNew')} onPress={() => setEdit(heatDraft(null))} />;
  const autoBtn = (
    <Button testID="heat-auto" kind="outlined" icon="auto-fix-high" label={t('orgHeatAuto')} disabled={categories.length === 0} onPress={() => setAuto({ categoryId: categories[0]?.id ?? null, workoutId: null, lanes: '8', start: null, interval: '15' })} />
  );
  const exportBtn = <ExportButton testID="heat-export" disabled={shown.length === 0} onPress={() => exportCsv(csvFileName(c, 'heats'), heatsCsv(shown, csvSeparator(locale)))} />;
  return (
    <>
      <OrgPageHeader
        tab="planning"
        actions={
          <>
            {create}
            {autoBtn}
            {all.length > 0 ? exportBtn : null}
          </>
        }
      />
      <Screen>
        {/* On a computer the clock and « Retard » have their own page (Horaire du jour). */}
        {wide ? null : <TimetableCard c={c} heats={all} />}
        {wide ? null : (
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>{create}</View>
            <View style={{ flex: 1 }}>{autoBtn}</View>
          </View>
        )}
        {notice ? (
          <Txt testID="heat-notice" color={colors.primary}>
            {notice}
          </Txt>
        ) : null}
        <ErrorText error={error} />
        {all.length === 0 ? (
          !categories.some((k) => k.active) ? (
            <Guide testID="guide-categories" message={t('orgNeedCategory')} action={t('orgGoCategories')} onPress={onGo && (() => onGo('categories'))} />
          ) : !(c.workouts ?? []).length ? (
            <Guide testID="guide-wods" message={t('orgNeedWod')} action={t('orgGoWods')} onPress={onGo && (() => onGo('wods'))} />
          ) : (
            <EmptyState icon="event-note" message={t('orgHeatNone')} />
          )
        ) : (
          <>
            <TextField testID="heat-search" icon="search" placeholder={t('orgHeatSearch')} value={filter.q} onChangeText={(q) => setFilter({ ...filter, q })} autoCapitalize="none" />
            {days.length > 1 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                <Chip testID="heat-day-all" label={t('orgAllDays')} selected={!filter.day} onPress={() => setFilter({ ...filter, day: null })} />
                {days.map((d) => (
                  <Chip key={d} testID={`heat-day-${d}`} label={formatDate(`${d}T12:00:00`, locale, { weekday: 'short', day: 'numeric', month: 'short' })} selected={filter.day === d} onPress={() => setFilter({ ...filter, day: d })} />
                ))}
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Select testID="heat-filter-cat" label={t('orgHeatCategory')} value={filter.categoryId ?? ''} options={[{ value: '', label: t('orgAllCategories') }, ...catOptions]} onChange={(v) => setFilter({ ...filter, categoryId: v || null })} />
              </View>
              <View style={{ flex: 1 }}>
                <Select testID="heat-filter-wod" label={t('orgHeatWod')} value={filter.workoutId ?? ''} options={[{ value: '', label: t('orgAllWods') }, ...wodOptions]} onChange={(v) => setFilter({ ...filter, workoutId: v || null })} />
              </View>
            </View>
            {wide ? null : exportBtn}
            {shown.length === 0 ? (
              <Txt color={colors.outline}>{t('orgHeatNoMatch')}</Txt>
            ) : (
              <ListGroup>
                {shown.map((h) => (
                  <ListRow
                    key={h.id}
                    testID={`heat-${h.id}`}
                    title={h.name}
                    subtitle={[h.startsAt ? when(h.startsAt, locale) : t('orgHeatNoTime'), h.workout?.name, h.category?.name, t('orgHeatLanes', { used: (h.lanes ?? []).length, count: h.laneCount })].filter(Boolean).join(' · ')}
                    onPress={() => setLanesOf(h.id)}
                    trailing={<IconButton icon="edit" label={t('orgHeatEdit')} onPress={() => setEdit(heatDraft(h))} />}
                  />
                ))}
              </ListGroup>
            )}
          </>
        )}
      </Screen>
    </>
  );
}

function HeatForm({ draft, busy, error, catOptions, wodOptions, onSave, onDelete, onCancel }: { draft: HeatDraft; busy: boolean; error: unknown; catOptions: Option[]; wodOptions: Option[]; onSave: (d: HeatDraft) => void; onDelete: (d: HeatDraft) => void; onCancel: () => void }) {
  const t = useT();
  const [d, setD] = useState(draft);
  const [deleting, setDeleting] = useState(false);
  return (
    <Screen>
      <Card style={{ gap: space.md }}>
        <TextField testID="heat-name" label={t('orgHeatName')} placeholder={t('orgHeatNameHint')} value={d.name} onChangeText={(name) => setD({ ...d, name })} maxLength={80} />
        <Select testID="heat-wod" label={t('orgHeatWod')} value={d.workoutId ?? ''} options={[{ value: '', label: t('orgNone') }, ...wodOptions]} onChange={(v) => setD({ ...d, workoutId: v || null })} />
        <Select testID="heat-cat" label={t('orgHeatCategory')} value={d.categoryId ?? ''} options={[{ value: '', label: t('orgNone') }, ...catOptions]} onChange={(v) => setD({ ...d, categoryId: v || null })} />
        <DateField testID="heat-start" mode="datetime" label={t('orgHeatStart')} value={d.start} placeholder={t('orgHeatNoTime')} onChange={(start) => setD({ ...d, start })} />
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <TextField testID="heat-duration" label={t('orgHeatDuration')} value={d.duration} onChangeText={(duration) => setD({ ...d, duration })} keyboardType="number-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <TextField testID="heat-lanes" label={t('orgHeatLaneCount')} value={d.lanes} onChangeText={(lanes) => setD({ ...d, lanes })} keyboardType="number-pad" />
          </View>
        </View>
        <ErrorText error={error} />
        <Button testID="heat-save" label={t('save')} busy={busy} disabled={!heatValid(d)} onPress={() => onSave(d)} />
        {d.id ? <Button testID="heat-delete" kind="outlined" icon="delete" label={t('orgHeatDelete')} busy={busy} onPress={() => setDeleting(true)} /> : null}
        <Button kind="text" label={t('cancel')} onPress={onCancel} />
      </Card>
      <Dialog
        visible={deleting}
        title={t('orgHeatDelete')}
        message={t('orgHeatDeleteConfirm', { name: d.name })}
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

function AutoForm({ draft, busy, error, catOptions, wodOptions, onRun, onCancel }: { draft: AutoDraft; busy: boolean; error: unknown; catOptions: Option[]; wodOptions: Option[]; onRun: (d: AutoDraft) => void; onCancel: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const [d, setD] = useState(draft);
  return (
    <Screen>
      <Card style={{ gap: space.md }}>
        <Txt color={colors.outline}>{t('orgAutoIntro')}</Txt>
        <Select testID="auto-cat" label={t('orgHeatCategory')} value={d.categoryId} options={catOptions} onChange={(v) => setD({ ...d, categoryId: v })} />
        <Select testID="auto-wod" label={t('orgHeatWod')} value={d.workoutId ?? ''} options={[{ value: '', label: t('orgNone') }, ...wodOptions]} onChange={(v) => setD({ ...d, workoutId: v || null })} />
        <TextField testID="auto-lanes" label={t('orgHeatLaneCount')} value={d.lanes} onChangeText={(lanes) => setD({ ...d, lanes })} keyboardType="number-pad" />
        <DateField testID="auto-start" mode="datetime" label={t('orgAutoStart')} value={d.start} placeholder={t('orgHeatNoTime')} onChange={(start) => setD({ ...d, start })} />
        <TextField testID="auto-interval" label={t('orgAutoInterval')} value={d.interval} onChangeText={(interval) => setD({ ...d, interval })} keyboardType="number-pad" />
        <ErrorText error={error} />
        <Button testID="auto-run" label={t('orgHeatAuto')} busy={busy} disabled={!autoValid(d)} onPress={() => onRun(d)} />
        <Button kind="text" label={t('cancel')} onPress={onCancel} />
      </Card>
    </Screen>
  );
}

/** The lanes of one heat: who is in each, free one, fill one with an athlete the server will accept. */
function LanesView({ heat, registrations, busy, error, onAssign, onFree, onClose }: { heat: Json; registrations: Json[]; busy: boolean; error: unknown; onAssign: (registrationId: string, lane: number) => void; onFree: (lane: number) => void; onClose: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const [picking, setPicking] = useState<number | null>(null);
  const byLane = new Map<number, Json>((heat.lanes ?? []).map((l: Json) => [l.lane, l]));
  if (picking != null) {
    return (
      <FlatList
        data={laneCandidates(heat, registrations)}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        ListHeaderComponent={<SectionHeader title={t('orgLanePick', { lane: picking })} />}
        ListEmptyComponent={<Txt color={colors.outline}>{t('orgLaneNobody')}</Txt>}
        ListFooterComponent={<Button kind="text" label={t('cancel')} onPress={() => setPicking(null)} />}
        renderItem={({ item: r }) => (
          <ListRow
            testID={`lane-cand-${r.id}`}
            title={personName(r)}
            subtitle={r.category?.name}
            onPress={() => {
              setPicking(null);
              onAssign(r.id, picking);
            }}
          />
        )}
      />
    );
  }
  return (
    <Screen>
      <Txt variant="title">{heat.name}</Txt>
      <ListGroup>
        {Array.from({ length: heat.laneCount }, (_, i) => i + 1).map((n) => {
          const l = byLane.get(n);
          return l ? (
            <ListRow key={n} testID={`lane-${n}`} title={t('orgLane', { lane: n })} subtitle={personName(l)} trailing={<IconButton icon="close" label={t('orgLaneFree')} onPress={() => onFree(n)} />} />
          ) : (
            <ListRow key={n} testID={`lane-${n}`} title={t('orgLane', { lane: n })} subtitle={t('orgLaneEmpty')} chevron onPress={() => setPicking(n)} />
          );
        })}
      </ListGroup>
      {freeLanes(heat).length === 0 ? <Txt color={colors.outline}>{t('orgLaneFull')}</Txt> : null}
      <ErrorText error={error} />
      <Button testID="lanes-back" kind="outlined" label={t('orgBack')} busy={busy} onPress={onClose} />
    </Screen>
  );
}
