import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';

import type { ApiClient, Json } from '../../../core/api/client';
import type { MessageKey } from '../../../core/i18n';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { formatDate, formatDuration } from '../../../core/utils/format';
import { SectionHeader } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Card, Chip, Screen, TextField, Txt, toast } from '../../../core/widgets/kit';
import { useCompLeaderboard } from '../api';
import { formatClock } from '../judge/logic';
import { organizerApi, useRefreshCompetition, useRegistrations } from './api';
import { LocalBadge } from './local-badge';
import { eventStyleOf } from './logic';
import { personName } from './logic-b';
import { emptyResult, flowOf, type Flow, type RaceResult } from './logic-hybrid';
import {
  AGE_GROUPS,
  ageOn,
  hybridRanking,
  inAgeGroup,
  matchImport,
  overallRanking,
  parseResultsCsv,
  rankFunctional,
  resultsSettingsOf,
  stationTimes,
  tableOf,
  type AgeGroup,
  type ImportCheck,
  type ResultsSettings,
  type Visibility,
} from './logic-results';
import { OrgPageHeader } from './page';
import { useLocalList } from './roster';

const AGE_LABEL: Record<AgeGroup, MessageKey> = { ALL: 'resAgeAll', U18: 'resAgeU18', '18-34': 'resAge1834', '35-39': 'resAge3539', '40-44': 'resAge4044', '45-49': 'resAge4549', '50+': 'resAge50' };
const int = (s: string) => (/^\d+$/.test(s.trim()) && Number(s) > 0 ? Number(s) : null);
export type Standing = { key: string; rank: number | null; name: string; value: string };

/** Age on the event day: the server's `ageAtEvent`, or the birth date when it sends one (contract, phase 10). */
const ageOf = (c: Json, r: Json): number | null => (typeof r.ageAtEvent === 'number' ? r.ageAtEvent : r.user?.dateOfBirth ? ageOn(r.user.dateOfBirth, c.eventStart) : null);

/**
 * Phase 10: results. The organizer's ranking choices (points table, what the screens show, finalists, freeze), the
 * standings of each division (functional fitness: the server's points re-ranked with the table; hybrid: the race
 * times, stations shown) with an age filter, and the import of a spreadsheet after a dry run.
 */
export function ResultsTab({ c }: { c: Json }) {
  const t = useT();
  const api = useApi();
  const locale = useLocale();
  const qc = useQueryClient();
  const refresh = useRefreshCompetition();
  const { colors } = useTheme();
  const saved = resultsSettingsOf(c);
  const [table, setTable] = useState(saved.table);
  const [first, setFirst] = useState(String(saved.first));
  const [step, setStep] = useState(String(saved.step));
  const [visibility, setVisibility] = useState<Visibility>(saved.visibility);
  const [finalists, setFinalists] = useState(saved.finalists ? String(saved.finalists) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const categories: Json[] = (c.categories ?? []).filter((k: Json) => k.active !== false);
  const [categoryId, setCategoryId] = useState<string | null>(categories[0]?.id ?? null);
  const [age, setAge] = useState<AgeGroup>('ALL');
  const hybrid = eventStyleOf(c) === 'HYBRID_RACE';
  const settings: ResultsSettings = { table, first: int(first) ?? 100, step: int(step) ?? 3, visibility, finalists: int(finalists), frozenAt: saved.frozenAt };

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const save = (next: ResultsSettings) =>
    run(async () => {
      await organizerApi(api).update(c.id, { resultsSettings: next });
      toast(t('orgSaved'));
    });

  /** Keeps each division's standings of now: the screens show them until « Unfreeze ». */
  const freeze = () =>
    run(async () => {
      const at = new Date().toISOString();
      for (const k of categories) await api.post(`/competitions/${c.id}/board-freezes`, { id: k.id, rows: await standings(api, c, k.id, settings), at });
      await organizerApi(api).update(c.id, { resultsSettings: { ...settings, frozenAt: at } });
      await qc.invalidateQueries({ queryKey: ['competitions', c.id, 'local', 'board-freezes'] });
    });

  return (
    <>
      <OrgPageHeader tab="results" />
      <Screen>
        <View style={{ alignSelf: 'flex-start' }}>
          <LocalBadge />
        </View>
        <SectionHeader title={t('resSettings')} />
        <Card style={{ gap: space.sm }}>
          {!hybrid ? (
            <>
              <Txt variant="label" color={colors.outline}>{t('resTable')}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {(['SERVER', 'RANK', 'DESCENDING'] as const).map((k) => (
                  <Chip key={k} testID={`res-table-${k}`} label={t(`resTable${k}`)} selected={table === k} onPress={() => setTable(k)} />
                ))}
              </View>
              {table === 'DESCENDING' ? (
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <TextField testID="res-first" style={{ flex: 1 }} label={t('resFirst')} value={first} onChangeText={setFirst} keyboardType="number-pad" />
                  <TextField testID="res-step" style={{ flex: 1 }} label={t('resStep')} value={step} onChangeText={setStep} keyboardType="number-pad" />
                </View>
              ) : null}
              {table !== 'SERVER' ? <Txt variant="small" color={colors.outline}>{t('resTableHint')}</Txt> : null}
            </>
          ) : null}
          <Txt variant="label" color={colors.outline}>{t('resVisibility')}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {(['RANKED', 'RANDOM', 'HIDDEN'] as const).map((v) => (
              <Chip key={v} testID={`res-vis-${v}`} label={t(`resVis${v}`)} selected={visibility === v} onPress={() => setVisibility(v)} />
            ))}
          </View>
          <TextField testID="res-finalists" label={t('resFinalists')} value={finalists} onChangeText={setFinalists} keyboardType="number-pad" />
          <ErrorText error={error} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Button testID="res-save" label={t('save')} busy={busy} onPress={() => void save(settings)} />
            {saved.frozenAt ? (
              <Button testID="res-unfreeze" kind="outlined" icon="lock-open" label={t('resUnfreeze')} busy={busy} onPress={() => void save({ ...settings, frozenAt: null })} />
            ) : (
              <Button testID="res-freeze" kind="outlined" icon="lock" label={t('resFreeze')} busy={busy} onPress={() => void freeze()} />
            )}
          </View>
          {saved.frozenAt ? <Txt testID="res-frozen" color={colors.primary}>{t('resFrozen', { time: formatDate(saved.frozenAt, locale, { dateStyle: 'short', timeStyle: 'short' }) })}</Txt> : null}
        </Card>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {categories.map((k) => (
            <Chip key={k.id} testID={`res-cat-${k.id}`} label={k.name} selected={categoryId === k.id} onPress={() => setCategoryId(k.id)} />
          ))}
        </View>
        <Txt variant="label" color={colors.outline}>{t('resAge')}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {AGE_GROUPS.map((g) => (
            <Chip key={g} testID={`res-age-${g}`} label={t(AGE_LABEL[g])} selected={age === g} onPress={() => setAge(g)} />
          ))}
        </View>
        {categoryId ? hybrid ? <HybridStandings c={c} categoryId={categoryId} age={age} finalists={settings.finalists} /> : <PointsStandings c={c} categoryId={categoryId} age={age} settings={settings} /> : null}

        <ImportCard c={c} hybrid={hybrid} categoryId={categoryId} />
      </Screen>
    </>
  );
}

/** The standings of a division as the screens show them (also what « Freeze » keeps). */
export async function standings(api: ApiClient, c: Json, categoryId: string, s: ResultsSettings): Promise<Standing[]> {
  if (eventStyleOf(c) === 'HYBRID_RACE') {
    const flow = flowOf(c);
    if (!flow) return [];
    const [waves, results, imported] = await Promise.all(['waves', 'race-results', 'imported-results'].map((p) => api.get<Json[]>(`/competitions/${c.id}/${p}`)));
    return raceInputs(flow, categoryId, waves, results as RaceResult[], imported).map((r) => ({ key: r.registrationId, rank: r.rank, name: r.name, value: r.totalMs != null ? formatClock(r.totalMs) : r.status }));
  }
  const board = await api.get<Json>(`/competitions/${c.id}/leaderboard`, { categoryId });
  const table = tableOf(s);
  const rows = table ? overallRanking(board.rows ?? [], board.workouts ?? [], table) : (board.rows ?? []).map((r: Json) => ({ ...r, localRank: r.rank, localTotal: r.totalPoints }));
  return rows.map((r: Json) => ({ key: r.athlete.id, rank: r.localRank, name: r.athlete.fullName || r.athlete.username || '—', value: String(r.localTotal) }));
}

/** The race standings of a division: wave athletes and imported names, judged results first, then imported times. */
export function raceInputs(flow: Flow, categoryId: string, waves: Json[], results: RaceResult[], imported: Json[]) {
  const mine = waves.filter((w) => w.categoryId === categoryId);
  const ids = new Set(mine.map((w) => w.id));
  const imports = imported.filter((i) => i.target === 'race' && i.categoryId === categoryId);
  const athletes = new Map<string, string>();
  for (const a of mine.flatMap((w) => w.athletes ?? [])) athletes.set(a.registrationId, a.name);
  for (const i of imports) if (!athletes.has(i.registrationId)) athletes.set(i.registrationId, i.name);
  const all: RaceResult[] = [...results.filter((r) => ids.has(r.waveId)), ...imports.map((i) => ({ ...emptyResult('import', i.registrationId), importedMs: (i.raw?.timeS ?? 0) * 1000 }))];
  return hybridRanking(flow, all, [...athletes].map(([registrationId, name]) => ({ registrationId, name })));
}

function CutLine() {
  const t = useT();
  const { colors } = useTheme();
  return (
    <View testID="res-cut" style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <View style={{ flex: 1, height: 2, backgroundColor: colors.primary }} />
      <Txt variant="small" color={colors.primary}>{t('resCut')}</Txt>
      <View style={{ flex: 1, height: 2, backgroundColor: colors.primary }} />
    </View>
  );
}

function ResultRow({ testID, rank, name, value, subtitle }: { testID: string; rank: number | null; name: string; value: string; subtitle?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm }}>
      <Txt style={{ width: 32, fontWeight: '700' }} color={rank === 1 ? colors.primary : colors.outline}>{rank != null ? String(rank) : '–'}</Txt>
      <View style={{ flex: 1 }}>
        <Txt style={{ fontWeight: '600' }}>{name}</Txt>
        {subtitle ? <Txt variant="small" color={colors.outline}>{subtitle}</Txt> : null}
      </View>
      <Txt style={{ fontWeight: '700' }}>{value}</Txt>
    </View>
  );
}

function PointsStandings({ c, categoryId, age, settings }: { c: Json; categoryId: string; age: AgeGroup; settings: ResultsSettings }) {
  const t = useT();
  const { colors } = useTheme();
  const board = useCompLeaderboard(c.id, categoryId);
  const regs = useRegistrations(c.id);
  const imported = useLocalList(c.id, 'imported-results');
  const ages = new Map<string, number | null>((regs.data ?? []).map((r: Json) => [r.userId, ageOf(c, r)]));
  const table = tableOf(settings);
  const all: Json[] = board.data ? (table ? overallRanking(board.data.rows ?? [], board.data.workouts ?? [], table) : (board.data.rows ?? []).map((r: Json) => ({ ...r, localRank: r.rank, localTotal: r.totalPoints }))) : [];
  const rows = all.filter((r) => inAgeGroup(ages.get(r.athlete.id) ?? null, age));
  const unknown = age === 'ALL' ? 0 : all.filter((r) => ages.get(r.athlete.id) == null).length;
  const workouts: Json[] = c.workouts ?? [];
  const byWod = workouts.map((w) => ({ w, entries: (imported.data ?? []).filter((i) => i.target === w.id && i.categoryId === categoryId) })).filter((x) => x.entries.length > 0);
  return (
    <>
      <Card style={{ gap: 0 }}>
        {board.data && rows.length === 0 ? <Txt color={colors.outline}>{t('resNoRows')}</Txt> : null}
        {rows.map((r, i) => (
          <View key={r.athlete.id}>
            <ResultRow testID={`res-row-${r.athlete.id}`} rank={r.localRank} name={r.athlete.fullName || r.athlete.username || '—'} value={table ? String(r.localTotal) : t('orgBoardPoints', { points: r.localTotal })} subtitle={r.places ? t('resPlaces', { places: r.places.map((p: number | null) => p ?? '–').join(' · ') }) : undefined} />
            {settings.finalists != null && i === settings.finalists - 1 && i < rows.length - 1 ? <CutLine /> : null}
          </View>
        ))}
      </Card>
      {unknown > 0 ? <Txt variant="small" color={colors.outline}>{t('resAgeUnknown', { count: unknown })}</Txt> : null}
      {byWod.map(({ w, entries }) => (
        <Card key={w.id} testID={`res-imported-${w.id}`} style={{ gap: 0 }}>
          <Txt variant="label" color={colors.outline}>{`${t('resImportedTitle')} · ${w.name}`}</Txt>
          {rankFunctional(entries.map((e) => ({ id: e.registrationId, ...e.raw })), w.scoreType).map((x) => {
            const e = entries.find((y) => y.registrationId === x.id)!;
            return <ResultRow key={x.id} testID={`res-imp-${w.id}-${x.id}`} rank={x.rank} name={e.name} value={e.raw.capped ? `CAP+${e.raw.reps}` : e.raw.timeS ? formatDuration(e.raw.timeS) : String(e.raw.reps ?? e.raw.value)} />;
          })}
        </Card>
      ))}
    </>
  );
}

function HybridStandings({ c, categoryId, age, finalists }: { c: Json; categoryId: string; age: AgeGroup; finalists: number | null }) {
  const t = useT();
  const { colors } = useTheme();
  const waves = useLocalList(c.id, 'waves');
  const results = useLocalList(c.id, 'race-results');
  const imported = useLocalList(c.id, 'imported-results');
  const regs = useRegistrations(c.id);
  const flow = flowOf(c);
  if (!flow || !waves.data || !results.data || !imported.data) return null;
  const ages = new Map<string, number | null>((regs.data ?? []).map((r: Json) => [r.id, ageOf(c, r)]));
  const all = raceInputs(flow, categoryId, waves.data, results.data as RaceResult[], imported.data);
  const rows = all.filter((r) => inAgeGroup(ages.get(r.registrationId) ?? null, age));
  const stations = flow.stages.filter((s) => s.kind === 'STATION');
  return (
    <Card style={{ gap: 0 }}>
      {/* The columns are the stations; the runs count in the total but are not shown (prompt §4). */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingBottom: space.xs }}>
        {stations.map((s) => (
          <Txt key={s.id} variant="small" color={colors.outline}>{s.name}</Txt>
        ))}
      </View>
      {rows.length === 0 ? <Txt color={colors.outline}>{t('resNoRows')}</Txt> : null}
      {rows.map((r, i) => {
        const value = r.status === 'FINISHED' && r.totalMs != null ? formatClock(r.totalMs) : r.status === 'CAPPED' ? `${t('resStatusCAPPED')} · ${t('resStations', { done: r.stagesDone })}` : t(`resStatus${r.status as 'RACING' | 'WAITING' | 'DNF'}`);
        const splits = stationTimes(flow, r.splits).map((x) => (x == null ? '–' : formatClock(x)));
        return (
          <View key={r.registrationId}>
            <ResultRow testID={`res-row-${r.registrationId}`} rank={r.rank} name={r.name} value={value} subtitle={r.splits.length ? splits.join(' · ') : undefined} />
            {finalists != null && i === finalists - 1 && i < rows.length - 1 ? <CutLine /> : null}
          </View>
        );
      })}
    </Card>
  );
}

function ImportCard({ c, hybrid, categoryId }: { c: Json; hybrid: boolean; categoryId: string | null }) {
  const t = useT();
  const api = useApi();
  const qc = useQueryClient();
  const { colors } = useTheme();
  const regs = useRegistrations(c.id);
  const targets: { id: string; name: string; scoreType: string }[] = hybrid ? [{ id: 'race', name: t('resImportRace'), scoreType: 'TIME' }] : (c.workouts ?? []).map((w: Json) => ({ id: w.id, name: w.name, scoreType: w.scoreType }));
  const [target, setTarget] = useState<string | null>(null);
  const [csv, setCsv] = useState('');
  const [check, setCheck] = useState<ImportCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const chosen = targets.find((x) => x.id === target);
  const candidates = (regs.data ?? []).filter((r: Json) => r.registrationStatus !== 'CANCELLED' && (!categoryId || r.categoryId === categoryId)).map((r: Json) => ({ id: r.id as string, name: personName(r), categoryId: r.categoryId as string }));

  async function doImport() {
    if (!check || !chosen) return;
    setBusy(true);
    setError(null);
    try {
      for (const x of check.ok) {
        const reg = candidates.find((r) => r.id === x.registrationId);
        await api.post(`/competitions/${c.id}/imported-results`, { id: `${chosen.id}:${x.registrationId}`, target: chosen.id, registrationId: x.registrationId, categoryId: reg?.categoryId ?? categoryId, name: x.name, raw: x.raw });
      }
      await qc.invalidateQueries({ queryKey: ['competitions', c.id, 'local', 'imported-results'] });
      toast(t('resImported', { count: check.ok.length }));
      setCheck(null);
      setCsv('');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionHeader title={t('resImport')} />
      <Card style={{ gap: space.sm }}>
        <Txt variant="small" color={colors.outline}>{t('resImportHint')}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {targets.map((x) => (
            <Chip
              key={x.id}
              testID={`res-import-target-${x.id}`}
              label={x.name}
              selected={target === x.id}
              onPress={() => {
                setTarget(x.id);
                setCheck(null);
              }}
            />
          ))}
        </View>
        <TextField
          testID="res-csv"
          label={t('resCsv')}
          value={csv}
          onChangeText={(v) => {
            setCsv(v);
            setCheck(null);
          }}
          multiline
          numberOfLines={5}
          style={{ minHeight: 120 }}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Button testID="res-check" kind="outlined" icon="fact-check" label={t('resCheck')} disabled={!chosen || !csv.trim()} onPress={() => chosen && setCheck(matchImport(parseResultsCsv(csv), candidates, chosen.scoreType))} />
          <Button testID="res-import" icon="upload" label={t('resImportDo')} busy={busy} disabled={!check || check.ok.length === 0} onPress={() => void doImport()} />
        </View>
        {check ? (
          <View style={{ gap: 2 }}>
            <Txt testID="res-check-ok" style={{ fontWeight: '700' }}>{t('resReady', { count: check.ok.length })}</Txt>
            {check.problems.map((p) => (
              <Txt key={p.line} testID={`res-problem-${p.line}`} color={colors.error}>{t(`resProblem${p.code}`, { line: p.line })}</Txt>
            ))}
          </View>
        ) : null}
        <ErrorText error={error} />
      </Card>
    </>
  );
}
