import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { SectionHeader, StatusPill } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Button, Card, Checkbox, Chip, Screen, TextField, Txt, toast } from '../../../core/widgets/kit';
import { DateField } from '../../../core/widgets/pickers';
import { useRegistrations, useStaff } from './api';
import { LocalBadge } from './local-badge';
import { messageProblems, messageStatus, recipients, SEGMENTS, type SegmentKind } from './logic-messages';
import { OrgPageHeader } from './page';
import { useLocalList } from './roster';

const CHANNELS = ['EMAIL', 'PUSH'] as const;

/**
 * Phase 11: messages to a segment (all athletes, a division, unpaid, not checked in, waiting list, staff,
 * volunteers), now or later. The outbox shows what the server will send; nothing leaves the app yet.
 */
export function MessagesTab({ c }: { c: Json }) {
  const t = useT();
  const api = useApi();
  const locale = useLocale();
  const qc = useQueryClient();
  const { colors } = useTheme();
  const regs = useRegistrations(c.id);
  const staff = useStaff(c.id);
  const checkins = useLocalList(c.id, 'checkins');
  const waiting = useLocalList(c.id, 'waiting-list');
  const applications = useLocalList(c.id, 'staff-applications');
  const outbox = useLocalList(c.id, 'messages');
  const categories: Json[] = (c.categories ?? []).filter((k: Json) => k.active !== false);
  const [kind, setKind] = useState<SegmentKind>('ALL_ATHLETES');
  const [categoryId, setCategoryId] = useState<string | null>(categories[0]?.id ?? null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [channels, setChannels] = useState<string[]>([...CHANNELS]);
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState(() => new Date(Date.now() + 3_600_000));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const segment = { kind, categoryId: kind === 'DIVISION' ? categoryId : null };
  const to = recipients(segment, { registrations: regs.data ?? [], checkins: checkins.data ?? [], waitingList: waiting.data ?? [], staff: staff.data ?? [], applications: applications.data ?? [] });
  const sendAt = later ? when.toISOString() : null;
  const problems = messageProblems({ subject, body, sendAt }, to.length, now);
  const refresh = () => qc.invalidateQueries({ queryKey: ['competitions', c.id, 'local', 'messages'] });

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/competitions/${c.id}/messages`, { subject: subject.trim(), body: body.trim(), segment, channels, recipients: to, sendAt: sendAt ?? new Date().toISOString(), cancelled: false });
      setSubject('');
      setBody('');
      setNow(Date.now());
      toast(t('msgAdded'));
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setError(null);
    try {
      await api.put(`/competitions/${c.id}/messages/${id}`, { cancelled: true });
      await refresh();
    } catch (e) {
      setError(e);
    }
  }

  const items = [...(outbox.data ?? [])].sort((a, b) => Date.parse(b.sendAt) - Date.parse(a.sendAt));
  const statusColor = { SCHEDULED: colors.primary, SENT: colors.success, CANCELLED: colors.outline };

  return (
    <>
      <OrgPageHeader tab="messages" />
      <Screen>
        <View style={{ alignSelf: 'flex-start' }}>
          <LocalBadge />
        </View>
        <SectionHeader title={t('msgCompose')} />
        <Card style={{ gap: space.sm }}>
          <Txt variant="label" color={colors.outline}>{t('msgSegment')}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {SEGMENTS.map((k) => (
              <Chip key={k} testID={`msg-seg-${k}`} label={t(`msgSeg${k}`)} selected={kind === k} onPress={() => setKind(k)} />
            ))}
          </View>
          {kind === 'DIVISION' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {categories.map((k) => (
                <Chip key={k.id} testID={`msg-cat-${k.id}`} label={k.name} selected={categoryId === k.id} onPress={() => setCategoryId(k.id)} />
              ))}
            </View>
          ) : null}
          <Txt testID="msg-count" style={{ fontWeight: '700' }}>{t('msgCount', { count: to.length })}</Txt>
          <TextField testID="msg-subject" label={t('msgSubject')} value={subject} onChangeText={setSubject} maxLength={120} />
          <TextField testID="msg-body" label={t('msgBody')} value={body} onChangeText={setBody} maxLength={5000} multiline />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
            {CHANNELS.map((ch) => (
              <Checkbox key={ch} testID={`msg-ch-${ch}`} label={t(`msgChannel${ch}`)} value={channels.includes(ch)} onChange={(on) => setChannels(on ? [...channels, ch] : channels.filter((x) => x !== ch))} />
            ))}
          </View>
          <Checkbox testID="msg-later" label={t('msgLater')} value={later} onChange={setLater} />
          {later ? <DateField testID="msg-when" mode="datetime" label={t('msgWhen')} value={when} onChange={setWhen} minimumDate={new Date()} /> : null}
          {problems.includes('PAST') ? <Txt color={colors.error}>{t('msgProblemPAST')}</Txt> : null}
          <ErrorText error={error} />
          <Button testID="msg-send" icon={later ? 'schedule-send' : 'send'} label={later ? t('msgSchedule') : t('msgSend')} busy={busy} disabled={problems.length > 0 || channels.length === 0} onPress={() => void send()} />
        </Card>

        <SectionHeader title={t('msgOutbox')} />
        <Txt variant="small" color={colors.outline}>{t('msgOutboxHint')}</Txt>
        {items.length === 0 ? <Txt color={colors.outline}>{t('msgOutboxEmpty')}</Txt> : null}
        {items.map((m) => {
          const status = messageStatus(m as { sendAt: string; cancelled?: boolean }, now);
          return (
            <Card key={m.id} testID={`msg-${m.id}`} style={{ gap: space.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Txt variant="title" style={{ flex: 1 }}>{m.subject}</Txt>
                <StatusPill label={t(`msgStatus${status}`)} color={statusColor[status]} />
              </View>
              <Txt variant="small" color={colors.outline}>{`${t(`msgSeg${m.segment?.kind as SegmentKind}`)} · ${t('msgLine', { count: (m.recipients ?? []).length, when: formatDate(m.sendAt, locale, { dateStyle: 'medium', timeStyle: 'short' }) })}`}</Txt>
              <Txt numberOfLines={3}>{m.body}</Txt>
              {status === 'SCHEDULED' ? <Button testID={`msg-cancel-${m.id}`} kind="outlined" icon="cancel-schedule-send" label={t('msgCancel')} onPress={() => void cancel(m.id)} /> : null}
            </Card>
          );
        })}
      </Screen>
    </>
  );
}
