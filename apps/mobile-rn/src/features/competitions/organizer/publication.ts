import { useRef, useState } from 'react';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { formatDate } from '../../../core/utils/format';
import { toast } from '../../../core/widgets/kit';
import { organizerApi, useRefreshCompetition } from './api';
import { shareOrCopy } from './export';
import { missingForPublication, publicationState } from './logic';

/** Asking for publication and sharing the event: used by the dashboard and by the top bar on a computer. */
export function usePublication(c: Json) {
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const refresh = useRefreshCompetition();
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const state = publicationState(c);
  const missing = missingForPublication(c);
  const canRequest = (state === 'DRAFT' || state === 'RETURNED') && missing.length === 0;

  async function request() {
    if (sending.current || !canRequest) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await organizerApi(api).requestPublication(c.id);
      toast(t('orgRequested'));
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  async function share() {
    const text = t('orgShareText', { title: c.title, date: formatDate(c.eventStart, locale), place: c.city ?? c.location ?? '' });
    const done = await shareOrCopy(`${text}\nfitnessleague://competitions/${c.id}`);
    if (done === 'copied') toast(t('orgCopied'));
    else if (done === 'failed') toast(t('errorGeneric'));
  }

  return { state, missing, canRequest, busy, error, request, share };
}
