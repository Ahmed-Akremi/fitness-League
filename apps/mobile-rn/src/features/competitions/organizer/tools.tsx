import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import type { Json } from '../../../core/api/client';
import type { MessageKey } from '../../../core/i18n';
import { useT } from '../../../core/prefs';
import { space, useTheme } from '../../../core/theme';
import { Button, Card, Checkbox, Chip, Screen, TextField, Txt, toast } from '../../../core/widgets/kit';
import { useHeats } from '../api';
import { DISPLAY_KINDS, type DisplayKind } from '../displays/screens';
import { LocalBadge } from './local-badge';
import { OrgPageHeader } from './page';
import { useLocalList } from './roster';

const TITLE: Record<DisplayKind, MessageKey> = { timer: 'toolTimer', heat: 'toolHeat', lane: 'toolLane', race: 'toolRace', leaderboard: 'toolLeaderboard', schedule: 'toolSchedule', call: 'toolCall' };
const HINT: Record<DisplayKind, MessageKey> = { timer: 'toolTimerHint', heat: 'toolHeatHint', lane: 'toolLaneHint', race: 'toolRaceHint', leaderboard: 'toolLeaderboardHint', schedule: 'toolScheduleHint', call: 'toolCallHint' };

/**
 * The address to open on the TV: the page's own origin on the web; the app link elsewhere, or the bare path when the
 * build has no URL scheme (`createURL` throws then).
 */
function displayBase(path: string): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) return `${window.location.origin}${path}`;
  try {
    return Linking.createURL(path);
  } catch {
    return path;
  }
}

/** Phase 9: the links of the displays (`/display/<id>/<kind>`), with their options, to open on the TV computer. */
export function ToolsTab({ c }: { c: Json }) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <>
      <OrgPageHeader tab="tools" />
      <Screen>
        <View style={{ alignSelf: 'flex-start' }}>
          <LocalBadge />
        </View>
        <Txt color={colors.outline}>{t('toolsIntro')}</Txt>
        <Txt variant="small" color={colors.outline}>{t('toolsLocalHint')}</Txt>
        {DISPLAY_KINDS.map((kind) => (
          <ToolCard key={kind} c={c} kind={kind} />
        ))}
      </Screen>
    </>
  );
}

function ToolCard({ c, kind }: { c: Json; kind: DisplayKind }) {
  const t = useT();
  const { colors } = useTheme();
  const heats = useHeats(c.id);
  const waves = useLocalList(c.id, 'waves');
  const locations = useLocalList(c.id, 'locations');
  const [overlay, setOverlay] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [lane, setLane] = useState('1');
  const [rotate, setRotate] = useState('15');

  const query: Record<string, string> = {};
  if (target && kind === 'timer') query.loc = target;
  if (target && (kind === 'heat' || kind === 'lane')) query.heat = target;
  if (kind === 'lane') query.lane = lane.trim() || '1';
  if (target && kind === 'race') query.wave = target;
  if (kind === 'leaderboard') query.rotate = rotate.trim() || '15';
  if (overlay) query.overlay = '1';
  const path = `/display/${c.id}/${kind}`;
  const search = new URLSearchParams(query).toString();
  const url = `${displayBase(path)}${search ? `?${search}` : ''}`;
  const choices: Json[] = kind === 'timer' ? (locations.data ?? []) : kind === 'heat' || kind === 'lane' ? (heats.data ?? []) : kind === 'race' ? (waves.data ?? []) : [];

  function open() {
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
    else router.push({ pathname: path, params: query } as unknown as Href);
  }

  async function copy() {
    await Clipboard.setStringAsync(url);
    toast(t('toolCopied'));
  }

  return (
    <Card testID={`tool-${kind}`} style={{ gap: space.sm }}>
      <Txt variant="title">{t(TITLE[kind])}</Txt>
      <Txt color={colors.outline}>{t(HINT[kind])}</Txt>
      {kind === 'timer' || kind === 'heat' || kind === 'lane' || kind === 'race' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Chip testID={`tool-auto-${kind}`} label={kind === 'timer' ? t('liveWholeEvent') : t('toolAuto')} selected={target == null} onPress={() => setTarget(null)} />
          {choices.map((x) => (
            <Chip key={x.id} testID={`tool-${kind}-${x.id}`} label={x.name} selected={target === x.id} onPress={() => setTarget(x.id)} />
          ))}
        </View>
      ) : null}
      {kind === 'lane' ? <TextField testID="tool-lane" label={t('toolLaneNumber')} value={lane} onChangeText={setLane} keyboardType="number-pad" /> : null}
      {kind === 'leaderboard' ? <TextField testID="tool-rotate" label={t('toolRotate')} value={rotate} onChangeText={setRotate} keyboardType="number-pad" /> : null}
      <Checkbox testID={`tool-overlay-${kind}`} label={t('toolOverlay')} value={overlay} onChange={setOverlay} />
      <Txt testID={`tool-url-${kind}`} variant="small" selectable color={colors.outline}>{url}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Button testID={`tool-open-${kind}`} icon="open-in-new" label={t('toolOpen')} onPress={open} />
        <Button testID={`tool-copy-${kind}`} kind="outlined" icon="content-copy" label={t('toolCopy')} onPress={() => void copy()} />
      </View>
    </Card>
  );
}
