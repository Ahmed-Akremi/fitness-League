import { useRef, useState } from 'react';
import { Share, View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { useApi } from '../../../core/services';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { Loading, SectionHeader, StatCard } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Button, Card, ListGroup, ListRow, Screen, Txt, toast } from '../../../core/widgets/kit';
import { formatMoney } from '../api';
import { statusLabelForCompetition } from '../screens';
import { organizerApi, useOrganizerDashboard, useRefreshCompetition } from './api';
import { RegistrationsBreakdown } from './breakdown';
import { CHECKLIST, missingForPublication, publicationState, TAB_FOR, type ChecklistItem, type ManageTab } from './logic';

export function DashboardTab({ c, onGo }: { c: Json; onGo: (tab: ManageTab) => void }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const api = useApi();
  const refresh = useRefreshCompetition();
  const dash = useOrganizerDashboard(c.id);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const state = publicationState(c);
  const missing = missingForPublication(c);
  const canRequest = (state === 'DRAFT' || state === 'RETURNED') && missing.length === 0;
  const labels: Record<ChecklistItem, string> = { DESCRIPTION: t('orgCheckDescription'), DATES: t('orgCheckDates'), COVER: t('orgCheckCover'), CATEGORY: t('orgCheckCategory'), WOD: t('orgCheckWod') };
  const stateText = {
    DRAFT: t('orgStateDraft'),
    REQUESTED: t('orgStateRequested'),
    RETURNED: t('orgStateReturned'),
    PUBLISHED: t('orgStatePublished', { status: statusLabelForCompetition(t, c.status) }),
    CANCELLED: t('orgStateCancelled'),
  }[state];

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

  function share() {
    const text = t('orgShareText', { title: c.title, date: formatDate(c.eventStart, locale), place: c.city ?? c.location ?? '' });
    void Share.share({ message: `${text}\nfitnessleague://competitions/${c.id}` });
  }

  const d = dash.data;
  return (
    <Screen>
      <Card testID="org-state" style={{ gap: space.sm }}>
        <Txt variant="title">{stateText}</Txt>
        {state === 'RETURNED' ? (
          <Txt testID="org-note" color={colors.error}>
            {c.publicationNote}
          </Txt>
        ) : null}
      </Card>
      {state === 'PUBLISHED' ? (
        <Button testID="org-share" kind="outlined" icon="share" label={t('orgShare')} onPress={share} />
      ) : state === 'CANCELLED' ? null : (
        <>
          <SectionHeader title={t('orgChecklist')} />
          <ListGroup>
            {CHECKLIST.map((item) => {
              const todo = missing.includes(item);
              return (
                <ListRow
                  key={item}
                  testID={`check-${item}`}
                  icon={todo ? 'radio-button-unchecked' : 'check-circle'}
                  title={labels[item]}
                  subtitle={todo ? t('orgGoTo') : null}
                  chevron={todo}
                  onPress={todo ? () => onGo(TAB_FOR[item]) : undefined}
                />
              );
            })}
          </ListGroup>
          <ErrorText error={error} />
          <Button testID="org-request" label={t('orgRequestPublication')} busy={busy} disabled={!canRequest} onPress={request} />
        </>
      )}
      <SectionHeader title={t('orgFigures')} />
      {dash.isError ? (
        <ErrorView error={dash.error} onRetry={() => dash.refetch()} />
      ) : d ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          <Figure label={t('orgParticipants')} value={String(d.participants)} />
          <Figure label={t('orgPaid')} value={String(d.paidRegistrations)} />
          <Figure label={t('orgToCollect')} value={String(d.pendingPayments)} />
          <Figure label={t('orgRevenue')} value={formatMoney(d.revenue, c.currency, locale)} />
          <Figure label={t('orgToJudge')} value={String(d.pendingJudging)} />
          <Figure label={t('orgApproved')} value={String(d.approvedSubmissions)} />
          <Figure label={t('orgRejected')} value={String(d.rejectedSubmissions)} />
        </View>
      ) : (
        <Loading />
      )}
      <RegistrationsBreakdown c={c} />
    </Screen>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: '47%' }}>
      <StatCard label={label}>
        <Txt variant="headline">{value}</Txt>
      </StatCard>
    </View>
  );
}
