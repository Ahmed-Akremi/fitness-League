import { useEffect, useRef, useState } from 'react';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Card, Dialog, Txt } from '../../../core/widgets/kit';
import { organizerApi, useRefreshCompetition } from './api';
import { delayMinutes, delayTargets, runDelay, timetable } from './logic-b';

/** The current time, read again every 30 seconds. */
function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

type Failure = { heats: Json[]; minutes: number; total: number };

/** Clock of the event day (spec §1.3 item 5): the heat running, the next one, how many are done; « Retard » moves every heat not started yet, then posts one announcement. */
export function TimetableCard({ c, heats }: { c: Json; heats: Json[] }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const refresh = useRefreshCompetition();
  const now = useNow();
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<Failure | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const tt = timetable(heats, now);
  const targets = delayTargets(heats, now);
  const hour = (iso: string) => formatDate(iso, locale, { hour: '2-digit', minute: '2-digit' });

  /** Moves `todo` by `minutes`; `total` counts every heat of this delay, retries included. */
  async function delay(todo: Json[], minutes: number, total: number) {
    if (sending.current || todo.length === 0) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const left = await runDelay(todo, minutes, (heatId, startsAt) => organizerApi(api).updateHeat(c.id, heatId, { startsAt }));
      if (left.length > 0) {
        setFailed({ heats: left, minutes, total });
      } else {
        setFailed(null);
        await organizerApi(api).announce(c.id, { title: t('orgDelayTitle', { minutes }), body: t('orgDelayBody', { minutes }) });
        setDone(t('orgDelayDone', { count: total, minutes }));
      }
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  if (tt.total === 0) return null;
  return (
    <Card testID="timetable" style={{ gap: space.sm }}>
      <Txt variant="headline">{formatDate(new Date(now), locale, { hour: '2-digit', minute: '2-digit' })}</Txt>
      <Txt>{tt.current ? t('orgNowRunning', { name: tt.current.name }) : t('orgNothingRunning')}</Txt>
      {tt.next ? <Txt color={colors.outline}>{t('orgNextHeat', { name: tt.next.name, time: hour(tt.next.startsAt) })}</Txt> : null}
      <Txt color={colors.outline}>{t('orgHeatsDone', { done: tt.done, total: tt.total })}</Txt>
      {failed ? (
        <>
          <Txt color={colors.error}>{t('orgDelayFailed', { names: failed.heats.map((h) => h.name).join(', ') })}</Txt>
          <Button testID="delay-retry" kind="outlined" label={t('retry')} busy={busy} onPress={() => delay(failed.heats, failed.minutes, failed.total)} />
        </>
      ) : null}
      {done ? <Txt color={colors.primary}>{done}</Txt> : null}
      <ErrorText error={error} />
      <Button testID="delay" kind="outlined" icon="schedule" label={t('orgDelay')} busy={busy} disabled={targets.length === 0} onPress={() => setAsking(true)} />
      <Dialog
        visible={asking}
        title={t('orgDelay')}
        message={t('orgDelayAsk', { count: targets.length })}
        confirmLabel={t('orgDelayConfirm')}
        cancelLabel={t('cancel')}
        input={{ label: t('orgDelayMinutes'), keyboardType: 'number-pad', testID: 'delay-minutes', valid: (s) => delayMinutes(s) != null }}
        onConfirm={(s) => {
          setAsking(false);
          const minutes = delayMinutes(s);
          // The heats to move are taken at the moment of the confirmation, not when the dialog opened.
          const todo = delayTargets(heats, Date.now());
          if (minutes != null) void delay(todo, minutes, todo.length);
        }}
        onCancel={() => setAsking(false)}
      />
    </Card>
  );
}
