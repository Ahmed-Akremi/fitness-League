import { useRef, useState } from 'react';

import type { Json } from '../../../core/api/client';
import { ApiError } from '../../../core/api/errors';
import { useLocale, useT, type T } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { formatDate } from '../../../core/utils/format';
import { Dialog, toast } from '../../../core/widgets/kit';
import { formatMoney } from '../api';
import { organizerApi, useRefreshCompetition } from './api';
import { shareOrCopy } from './export';
import { personName } from './logic-b';
import { markPaidBatch, type PayBatch } from './logic-web';

/** Payment status in words. */
export const paymentLabels = (t: T): Record<string, string> => ({ PENDING: t('orgPayPending'), PAID: t('orgPayPaid'), FREE: t('orgPayFree'), FAILED: t('orgPayFailed'), REFUNDED: t('orgPayRefunded') });

/** « Marquer payé » for one registration (are you sure, the request, the receipt), shared by the phone list and the computer table. */
export function useMarkPaid(c: Json) {
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const refresh = useRefreshCompetition();
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [paying, setPaying] = useState<Json | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const money = (r: Json) => formatMoney(r.finalPrice ?? 0, r.currency ?? c.currency, locale);
  const receiptOf = (r: Json, date: Date | string) => t('orgReceipt', { title: c.title, name: personName(r), category: r.category?.name ?? '', amount: money(r), date: formatDate(date, locale) });

  async function markPaid(r: Json) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await organizerApi(api).markPaid(c.id, r.id);
      setReceipt(receiptOf(r, new Date()));
    } catch (e) {
      // A co-organizer settled it first: the reload below shows the real state.
      if (e instanceof ApiError && e.status === 409) setInfo(t('orgAlreadyPaid'));
      else setError(e);
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  return {
    busy,
    error,
    info,
    paying,
    receipt,
    money,
    ask: setPaying,
    markPaid,
    /** The receipt of a registration already paid; it was paid when the registration last changed. */
    showReceipt: (r: Json) => setReceipt(receiptOf(r, r.updatedAt ?? r.registeredAt)),
    closeReceipt: () => setReceipt(null),
  };
}

export type MarkPaid = ReturnType<typeof useMarkPaid>;

/** The two dialogs of « Marquer payé »: are you sure, then the receipt to share. */
export function MarkPaidDialogs({ pay }: { pay: MarkPaid }) {
  const t = useT();
  return (
    <>
      <Dialog
        visible={pay.paying != null}
        title={t('orgMarkPaid')}
        message={pay.paying ? t('orgMarkPaidConfirm', { name: personName(pay.paying), amount: pay.money(pay.paying) }) : undefined}
        confirmLabel={t('orgMarkPaid')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          const r = pay.paying;
          pay.ask(null);
          if (r) void pay.markPaid(r);
        }}
        onCancel={() => pay.ask(null)}
      />
      <Dialog
        visible={pay.receipt != null}
        title={t('orgReceiptTitle')}
        message={pay.receipt ?? undefined}
        confirmLabel={t('orgShareReceipt')}
        cancelLabel={t('orgClose')}
        onConfirm={() => {
          const text = pay.receipt;
          pay.closeReceipt();
          if (text)
            void shareOrCopy(text).then((done) => {
              if (done === 'copied') toast(t('orgCopied'));
              else if (done === 'failed') toast(t('errorGeneric'));
            });
        }}
        onCancel={pay.closeReceipt}
      />
    </>
  );
}

/** « Marquer payé (n) »: one request at a time, a summary at the end; a second click while it runs does nothing. */
export function useMarkPaidBatch(c: Json) {
  const api = useApi();
  const refresh = useRefreshCompetition();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PayBatch | null>(null);

  async function run(ids: string[]): Promise<PayBatch | null> {
    if (running.current || ids.length === 0) return null;
    running.current = true;
    setBusy(true);
    setResult(null);
    try {
      const r = await markPaidBatch(ids, (id) => organizerApi(api).markPaid(c.id, id));
      setResult(r);
      return r;
    } finally {
      await refresh();
      running.current = false;
      setBusy(false);
    }
  }

  return { busy, result, run, clear: () => setResult(null) };
}
