import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLocale, useT } from '../../core/prefs';
import { useTheme } from '../../core/theme';
import { formatDuration, localized } from '../../core/utils/format';
import { TimeField } from '../../core/widgets/common';
import { Button, IconButton, Segmented, Txt } from '../../core/widgets/kit';
import type { RefItem } from '../reference/api';

/** Official Hyrox station order (the 1 km runs are part of the total, not listed one by one). */
export const HYROX_STATION_ORDER = [
  'HYROX_SKIERG_1000',
  'HYROX_SLED_PUSH',
  'HYROX_SLED_PULL',
  'HYROX_BURPEE_BROAD_JUMP',
  'HYROX_ROW_1000',
  'HYROX_FARMERS_CARRY',
  'HYROX_SANDBAG_LUNGES',
  'HYROX_WALL_BALLS',
];

/** One timed exercise returned by the assistant. */
export interface TimedExercise {
  exercise: RefItem;
  seconds: number;
}

function pickStations(exercises: RefItem[]): RefItem[] {
  const byCode = new Map(exercises.map((e) => [e.code, e]));
  const official = HYROX_STATION_ORDER.map((c) => byCode.get(c)).filter((e): e is RefItem => !!e);
  if (official.length === HYROX_STATION_ORDER.length) return official;
  // Catalog without the official codes: the station exercises in catalog order, runs excluded.
  return exercises.filter((e) => e.group === 'HYROX_STATION' && e.code !== 'HYROX_RUN_1K').slice(0, 8);
}

/**
 * Full race assistant: Open/Pro, 8 station splits, total (computed from the splits until edited by hand).
 * Returns the race total first, then the stations that have a time.
 */
export function HyroxRaceSheet({ visible, exercises, onClose, onAdd }: { visible: boolean; exercises: RefItem[]; onClose: () => void; onAdd: (result: TimedExercise[]) => void }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const races = useMemo(() => exercises.filter((e) => e.group === 'HYROX_RACE'), [exercises]);
  const stations = useMemo(() => pickStations(exercises), [exercises]);
  const [raceId, setRaceId] = useState<string | null>(races[0]?.id ?? null);
  const [splits, setSplits] = useState<(number | null)[]>(() => stations.map(() => null));
  // Sum of the 8 × 1 km runs: needed for a real race total (stations alone are far below it).
  const [runs, setRuns] = useState<number | null>(null);
  const [edited, setEdited] = useState<{ text: string; seconds: number | null } | null>(null);

  // Auto-total = all 8 stations + runs; left empty until both are known (unless typed by hand).
  const auto = runs != null && splits.every((s) => s != null) ? splits.reduce<number>((a, b) => a + (b ?? 0), runs) : null;
  const totalSeconds = edited ? edited.seconds : auto;
  const totalText = edited ? edited.text : auto == null ? '' : formatDuration(auto);
  const race = races.find((r) => r.id === raceId);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12 }}>
            <Txt variant="title" style={{ flex: 1, fontSize: 20 }}>{t('hyroxFullRace')}</Txt>
            <IconButton icon="close" label={t('cancel')} onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 8 }} keyboardShouldPersistTaps="handled">
            {races.length > 1 && raceId && (
              <Segmented options={races.map((r) => ({ key: r.id, label: localized(r.name, locale) }))} value={raceId} onChange={setRaceId} />
            )}
            {stations.map((s, i) => (
              <TimeField
                key={s.id}
                testID={`station-${i + 1}`}
                label={`${i + 1}. ${localized(s.name, locale)}`}
                onChange={(v) => setSplits((prev) => prev.map((p, j) => (j === i ? v : p)))}
              />
            ))}
            <TimeField testID="hyrox-runs" label={t('hyroxRuns')} onChange={setRuns} />
            <View style={{ height: 1, backgroundColor: colors.surfaceHigh, marginVertical: 12 }} />
            <TimeField
              testID="hyrox-total"
              label={t('hyroxTotal')}
              value={totalText}
              onChangeText={(text) => setEdited((e) => ({ text, seconds: e?.seconds ?? null }))}
              onChange={(seconds) => setEdited((e) => ({ text: e?.text ?? '', seconds }))}
            />
            <Txt variant="small" color={colors.outline}>{t('hyroxTotalHint')}</Txt>
            <Button
              testID="hyrox-add"
              label={t('hyroxAdd')}
              disabled={!race || totalSeconds == null}
              style={{ marginTop: 16 }}
              onPress={() =>
                onAdd([
                  { exercise: race!, seconds: totalSeconds! },
                  ...stations.flatMap((s, i) => (splits[i] != null ? [{ exercise: s, seconds: splits[i]! }] : [])),
                ])
              }
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
