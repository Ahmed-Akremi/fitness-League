import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useT } from '../../core/prefs';
import { displayText, space, useTheme } from '../../core/theme';
import { formatDuration } from '../../core/utils/format';
import { TimeField } from '../../core/widgets/common';
import { Button, Chip, Screen, TextField, Txt } from '../../core/widgets/kit';
import { defaultTimer, timerPause, timerResume, timerSeconds, timerStart, type TimerConfig, type TimerState, type TimerType } from '../competitions/organizer/logic-timer';
import { COUNTDOWN_SEC, lastTen, phaseOf, progressOf, setupProblems } from './logic';

const MODES: TimerType[] = ['FOR_TIME', 'AMRAP', 'EMOM', 'TABATA'];
const RING = 240;
const STROKE = 14;

/**
 * Circle21's workout timer (§3.18, §8.2) in Fitness League's colours: For Time, AMRAP, EMOM and Tabata; a ten-second
 * countdown before the start, a 240 px ring, the last ten seconds in the warning colour, and pause dimming the screen.
 * It runs on the phone only: nothing is sent anywhere.
 */
export function TimerScreen() {
  const t = useT();
  const { colors } = useTheme();
  const [config, setConfig] = useState<TimerConfig>({ ...defaultTimer(), capSec: null });
  const [state, setState] = useState<TimerState | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!state) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [state]);

  const set = (patch: Partial<TimerConfig>) => setConfig({ ...config, ...patch });
  const problems = setupProblems(config);
  const start = () => {
    const at = Date.now();
    setNow(at);
    setState(timerStart(config, new Date(at + COUNTDOWN_SEC * 1000).toISOString()));
  };

  if (!state) {
    const int = (v: string) => (v.trim() === '' ? 0 : Math.max(0, Math.round(Number(v)) || 0));
    return (
      <Screen>
        <Stack.Screen options={{ title: t('timerTitle') }} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {MODES.map((m) => (
            <Chip key={m} testID={`timer-mode-${m}`} label={t(`timerType${m}`)} selected={config.type === m} onPress={() => set({ type: m, capSec: m === 'AMRAP' ? (config.capSec ?? 600) : config.capSec })} />
          ))}
        </View>
        <Txt color={colors.outline}>{t(`timerHelp${config.type as 'FOR_TIME' | 'AMRAP' | 'EMOM' | 'TABATA'}`)}</Txt>
        {config.type === 'FOR_TIME' || config.type === 'AMRAP' ? (
          <View style={{ flexDirection: 'row' }}>
            <TimeField key={config.type} testID="timer-length" label={config.type === 'AMRAP' ? t('timerDuration') : t('timerTimeCap')} initialSeconds={config.capSec ?? undefined} onChange={(sec) => set({ capSec: sec && sec > 0 ? sec : null })} />
          </View>
        ) : config.type === 'EMOM' ? (
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <TimeField testID="timer-every" label={t('timerEvery')} initialSeconds={config.intervalSec} onChange={(sec) => set({ intervalSec: sec ?? 0 })} />
            <View style={{ flex: 1 }}>
              <TextField testID="timer-rounds" label={t('timerRounds')} value={config.rounds ? String(config.rounds) : ''} onChangeText={(v) => set({ rounds: int(v) })} keyboardType="number-pad" />
            </View>
          </View>
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <TimeField testID="timer-work" label={t('timerWorkLabel')} initialSeconds={config.workSec} onChange={(sec) => set({ workSec: sec ?? 0 })} />
              <TimeField testID="timer-rest" label={t('timerRestLabel')} initialSeconds={config.restSec} onChange={(sec) => set({ restSec: sec ?? 0 })} />
            </View>
            <TextField testID="timer-rounds" label={t('timerRounds')} value={config.rounds ? String(config.rounds) : ''} onChangeText={(v) => set({ rounds: int(v) })} keyboardType="number-pad" />
          </>
        )}
        {problems.includes('LENGTH') ? <Txt color={colors.error}>{t('timerErrLength')}</Txt> : null}
        {problems.includes('ROUNDS') ? <Txt color={colors.error}>{t('timerErrRounds')}</Txt> : null}
        <Button testID="timer-set" icon="timer" label={t('timerSet')} disabled={problems.length > 0} onPress={start} />
      </Screen>
    );
  }

  const phase = phaseOf(state, now);
  const v = phase.kind === 'TIMER' ? phase.view : null;
  const warn = v ? lastTen(config, v) : phase.kind === 'COUNTDOWN' && phase.seconds <= 3;
  const tone = warn ? colors.warning : v?.phase === 'REST' ? colors.outline : colors.primary;
  const progress = phase.kind === 'COUNTDOWN' ? 1 - phase.seconds / COUNTDOWN_SEC : v ? progressOf(config, v) : 0;
  const r = (RING - STROKE) / 2;
  const length = 2 * Math.PI * r;
  const paused = v?.status === 'PAUSED';
  const done = v?.status === 'DONE';
  const big = phase.kind === 'COUNTDOWN' ? String(phase.seconds) : v ? formatDuration(timerSeconds(v, config.type)) : '';
  const sub =
    phase.kind === 'COUNTDOWN'
      ? t('timerGetReady')
      : done
        ? t('timerStatusDONE')
        : [v?.round != null ? t('timerRoundOf', { round: v.round, total: config.rounds }) : null, v?.phase ? t(`timerPhase${v.phase}`) : null, t(`timerType${config.type}`)].filter(Boolean).join(' · ');

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: t('timerTitle') }} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl, padding: space.lg }}>
        {/* Pause dims the clock (Circle21 dims the screen); the buttons stay bright. */}
        <View testID="timer-ring" accessibilityRole="timer" accessibilityLabel={`${big} ${sub}`} style={{ width: RING, height: RING, alignItems: 'center', justifyContent: 'center', opacity: paused ? 0.45 : 1 }}>
          <Svg width={RING} height={RING} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
            <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={colors.surfaceHigh} strokeWidth={STROKE} fill="none" />
            <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={tone} strokeWidth={STROKE} fill="none" strokeLinecap="round" strokeDasharray={`${length} ${length}`} strokeDashoffset={length * (1 - progress)} />
          </Svg>
          <Txt testID="timer-clock" style={[displayText(phase.kind === 'COUNTDOWN' ? 96 : 64)]} color={warn ? colors.warning : colors.text}>{big}</Txt>
          <Txt testID="timer-sub" variant="small" style={{ fontWeight: '700', textAlign: 'center', paddingHorizontal: space.lg }} color={colors.outline}>{sub}</Txt>
        </View>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          {done ? (
            <Button testID="timer-again" icon="replay" label={t('timerAgain')} onPress={start} />
          ) : phase.kind === 'TIMER' ? (
            <Button testID="timer-pause" icon={paused ? 'play-arrow' : 'pause'} label={paused ? t('timerResume') : t('timerPause')} onPress={() => setState(paused ? timerResume(state, new Date().toISOString()) : timerPause(state, new Date().toISOString()))} />
          ) : null}
          <Button testID="timer-reset" kind="outlined" icon="stop" label={t('timerReset')} onPress={() => setState(null)} />
        </View>
      </View>
    </View>
  );
}
