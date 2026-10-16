import { useRef, useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { SectionHeader, SkeletonList } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Button, Card, Screen, TextField, Txt, toast } from '../../../core/widgets/kit';
import { organizerApi, useAnnouncements, useRefreshCompetition } from './api';
import { announcementValid } from './logic-b';
import { OrgPageHeader } from './page';

/** « Annonces » (spec §1.3 item 9): post an announcement; it shows on the event page, without a notification. */
export function AnnouncementsTab({ c }: { c: Json }) {
  const t = useT();
  const { colors } = useTheme();
  const api = useApi();
  const refresh = useRefreshCompetition();
  const list = useAnnouncements(c.id);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ok = announcementValid(title, body);

  async function post() {
    if (sending.current || !ok) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await organizerApi(api).announce(c.id, { title: title.trim(), body: body.trim() });
      setTitle('');
      setBody('');
      toast(t('orgAnnPosted'));
    } catch (e) {
      setError(e);
    } finally {
      await refresh();
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <OrgPageHeader tab="announcements" />
      <Screen>
        <Card style={{ gap: space.md }}>
          <Txt color={colors.outline}>{t('orgAnnHint')}</Txt>
          <TextField testID="ann-title" label={t('orgAnnTitle')} value={title} onChangeText={setTitle} maxLength={120} />
          <TextField testID="ann-body" label={t('orgAnnBody')} value={body} onChangeText={setBody} maxLength={5000} multiline />
          <ErrorText error={error} />
          <Button testID="ann-post" icon="campaign" label={t('orgAnnPost')} busy={busy} disabled={!ok} onPress={post} />
        </Card>
        <SectionHeader title={t('orgAnnList')} />
        {list.isError ? (
          <ErrorView error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data ? (
          <SkeletonList label={t('orgLoading')} />
        ) : list.data.length === 0 ? (
          <Txt color={colors.outline}>{t('orgAnnNone')}</Txt>
        ) : (
          <AnnouncementList items={list.data} />
        )}
      </Screen>
    </>
  );
}

export function AnnouncementList({ items }: { items: Json[] }) {
  const locale = useLocale();
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      {items.map((a) => (
        <Card key={a.id} testID={`ann-${a.id}`} style={{ gap: space.xs }}>
          <Txt variant="title">{a.title}</Txt>
          <Txt variant="small" color={colors.outline}>
            {formatDate(a.createdAt, locale, { dateStyle: 'medium', timeStyle: 'short' })}
          </Txt>
          <Txt>{a.body}</Txt>
        </Card>
      ))}
    </View>
  );
}

/** Event page: the organizers' three latest announcements; nothing when there is none (it is extra information, the page works without it). */
export function CompetitionAnnouncements({ id }: { id: string }) {
  const t = useT();
  const list = useAnnouncements(id);
  const items: Json[] = (list.data ?? []).slice(0, 3);
  if (items.length === 0) return null;
  return (
    <View style={{ gap: space.md }}>
      <SectionHeader title={t('compAnnouncements')} />
      <AnnouncementList items={items} />
    </View>
  );
}
