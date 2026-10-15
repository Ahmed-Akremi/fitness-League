import { useEffect, useRef, useState } from 'react';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Card, Dialog, Txt } from '../../../core/widgets/kit';
import { competitionsApi } from '../api';
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

type Failure = { heats: Json[]; minutes: number; total: number; day: string };
/** Every heat moved but the announcement did not go out. */
type Unannounced = { minutes: number; total: number; day: string };

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
  const [unannounced, setUnannounced] = useState<Unannounced | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const tt = timetable(heats, now);
  const targets = delayTargets(heats, now);
  const hour = (iso: string) => formatDate(iso, locale, { hour: '2-digit', minute: '2-digit' });
  const dayOf = (iso: string) => formatDate(iso, locale, { weekday: 'long', day: 'numeric', month: 'long' });

  async function guarded(fn: () => Promise<void>) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  async function announce(minutes: number, total: number, day: string) {
    try {
      await organizerApi(api).announce(c.id, { title: t('orgDelayTitle', { minutes }), body: t('orgDelayBody', { minutes, day }) });
    } catch (e) {
      // The heats have moved: only the announcement is left (« Retard » again would move them twice).
      setUnannounced({ minutes, total, day });
      throw e;
    }
    setUnannounced(null);
    setDone(t('orgDelayDone', { count: total, minutes }));
  }

  /** Moves `todo` by `minutes`; `total` counts every heat of this delay, retries included. */
  async function move(todo: Json[], minutes: number, total: number, day: string) {
    const left = await runDelay(todo, minutes, (heatId, startsAt) => organizerApi(api).updateHeat(c.id, heatId, { startsAt }));
    if (left.length > 0) {
      setFailed({ heats: left, minutes, total, day });
      return;
    }
    setFailed(null);
    await announce(minutes, total, day);
  }

  /** The start times are read again first: a co-organizer may have moved the heats from another phone. */
  const delay = (minutes: number) =>
    guarded(async () => {
      const todo = delayTargets(await competitionsApi(api).heats(c.id), Date.now());
      if (todo.length > 0) await move(todo, minutes, todo.length, dayOf(todo[0].startsAt));
    });

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
          <Button testID="delay-retry" kind="outlined" label={t('retry')} busy={busy} onPress={() => guarded(() => move(failed.heats, failed.minutes, failed.total, failed.day))} />
        </>
      ) : null}
      {unannounced ? (
        <>
          <Txt color={colors.error}>{t('orgDelayNotAnnounced', { count: unannounced.total, minutes: unannounced.minutes })}</Txt>
          <Button testID="delay-announce" kind="outlined" icon="campaign" label={t('orgDelayPostAnnouncement')} busy={busy} onPress={() => guarded(() => announce(unannounced.minutes, unannounced.total, unannounced.day))} />
        </>
      ) : null}
      {done ? <Txt color={colors.primary}>{done}</Txt> : null}
      <ErrorText error={error} />
      <Button testID="delay" kind="outlined" icon="schedule" label={t('orgDelay')} busy={busy} disabled={targets.length === 0 || failed != null || unannounced != null} onPress={() => setAsking(true)} />
      <Dialog
        visible={asking}
        title={t('orgDelay')}
        message={t('orgDelayAsk', { count: targets.length, day: targets[0] ? dayOf(targets[0].startsAt) : '' })}
        confirmLabel={t('orgDelayConfirm')}
        cancelLabel={t('cancel')}
        input={{ label: t('orgDelayMinutes'), keyboardType: 'number-pad', testID: 'delay-minutes', valid: (s) => delayMinutes(s) != null }}
        onConfirm={(s) => {
          setAsking(false);
          const minutes = delayMinutes(s);
          if (minutes != null) void delay(minutes);
        }}
        onCancel={() => setAsking(false)}
      />
    </Card>
  );
}
