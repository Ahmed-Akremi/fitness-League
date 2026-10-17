import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { space, useTheme } from '../../../core/theme';
import { SectionHeader, SkeletonList, StatCard } from '../../../core/widgets/common';
import { ErrorText, ErrorView } from '../../../core/widgets/error';
import { Button, Card, ListGroup, ListRow, Screen, Txt } from '../../../core/widgets/kit';
import { formatMoney } from '../api';
import { statusLabelForCompetition } from '../screens';
import { useOrganizerDashboard } from './api';
import { RegistrationsBreakdown } from './breakdown';
import { CHECKLIST, TAB_FOR, type ChecklistItem } from './logic';
import { OverviewWeb } from './overview';
import { OrgPageHeader } from './page';
import { usePublication } from './publication';
import { useWideWeb, type Go } from './web';

export function DashboardTab({ c, onGo }: { c: Json; onGo: Go }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const wide = useWideWeb();
  const dash = useOrganizerDashboard(c.id);
  const { state, missing, canRequest, busy, error, request, share } = usePublication(c);
  const labels: Record<ChecklistItem, string> = { DESCRIPTION: t('orgCheckDescription'), DATES: t('orgCheckDates'), COVER: t('orgCheckCover'), CATEGORY: t('orgCheckCategory'), WOD: t('orgCheckWod') };
  const stateText = {
    DRAFT: t('orgStateDraft'),
    REQUESTED: t('orgStateRequested'),
    RETURNED: t('orgStateReturned'),
    PUBLISHED: t('orgStatePublished', { status: statusLabelForCompetition(t, c.status) }),
    CANCELLED: t('orgStateCancelled'),
  }[state];

  const d = dash.data;
  return (
    <>
      <OrgPageHeader tab="dashboard" />
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
        {wide ? null : <SectionHeader title={t('orgFigures')} />}
        {dash.isError ? (
          <ErrorView error={dash.error} onRetry={() => dash.refetch()} />
        ) : !d ? (
          <SkeletonList count={2} label={t('orgLoading')} />
        ) : wide ? (
          <OverviewWeb c={c} d={d} onGo={onGo} />
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
            <Figure label={t('orgParticipants')} value={String(d.participants)} />
            <Figure label={t('orgPaid')} value={String(d.paidRegistrations)} />
            <Figure label={t('orgToCollect')} value={String(d.pendingPayments)} />
            <Figure label={t('orgRevenue')} value={formatMoney(d.revenue, c.currency, locale)} />
            <Figure label={t('orgToJudge')} value={String(d.pendingJudging)} />
            <Figure label={t('orgApproved')} value={String(d.approvedSubmissions)} />
            <Figure label={t('orgRejected')} value={String(d.rejectedSubmissions)} />
          </View>
        )}
        {wide ? null : <RegistrationsBreakdown c={c} />}
      </Screen>
    </>
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
