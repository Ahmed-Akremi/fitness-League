import { useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { space, useTheme } from '../../../core/theme';
import { EmptyState, RankRow, SkeletonList, StatusPill } from '../../../core/widgets/common';
import { ErrorView } from '../../../core/widgets/error';
import { Card, Chip, ListGroup, Screen, Txt } from '../../../core/widgets/kit';
import { useCompLeaderboard } from '../api';
import { exportCsv } from './export';
import { Guide } from './guide';
import type { ManageTab } from './logic';
import { csvFileName, csvSeparator, leaderboardCsv } from './logic-b';
import { LIVE_REFRESH_MS } from './logic-web';
import { ExportButton, OrgPageHeader } from './page';
import { useWideWeb } from './web';

/** « Classement » (spec §1.3 item 8): the ranking per category. Read only: the server lets only the head judge (admin panel) publish the final leaderboard. */
export function LeaderboardTab({ c, onGo }: { c: Json; onGo?: (tab: ManageTab) => void }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const categories: Json[] = (c.categories ?? []).filter((k: Json) => k.active !== false);
  const [categoryId, setCategoryId] = useState<string | undefined>(categories[0]?.id);
  // Read again every 30 s while this page is open (analysis §3 item 11).
  const board = useCompLeaderboard(c.id, categoryId, undefined, LIVE_REFRESH_MS);
  const wide = useWideWeb();
  const rows: Json[] = board.data?.rows ?? [];
  const exportBtn = <ExportButton testID="board-export" disabled={rows.length === 0} onPress={() => exportCsv(csvFileName(c, 'leaderboard'), leaderboardCsv(rows, categories.find((k) => k.id === categoryId)?.name ?? '', csvSeparator(locale)))} />;
  return (
    <>
      <OrgPageHeader tab="leaderboard" actions={board.data ? exportBtn : undefined} />
      <Screen>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {categories.map((k) => (
            <Chip key={k.id} testID={`board-cat-${k.id}`} label={k.name} selected={categoryId === k.id} onPress={() => setCategoryId(k.id)} />
          ))}
        </View>
        {categories.length === 0 ? (
          <Guide testID="guide-categories" message={t('orgNeedCategory')} action={t('orgGoCategories')} onPress={onGo && (() => onGo('categories'))} />
        ) : !(c.workouts ?? []).length ? (
          <Guide testID="guide-wods" message={t('orgNeedWod')} action={t('orgGoWods')} onPress={onGo && (() => onGo('wods'))} />
        ) : board.isError ? (
          <ErrorView error={board.error} onRetry={() => board.refetch()} />
        ) : !board.data ? (
          <SkeletonList label={t('orgLoading')} />
        ) : (
          <>
            <StatusPill testID="board-status" label={board.data.provisional ? t('orgBoardProvisional') : t('orgBoardFinal')} color={board.data.provisional ? colors.outline : colors.primary} />
            {wide ? null : exportBtn}
            {board.data.rows.length === 0 ? (
              <EmptyState icon="leaderboard" message={t('orgBoardEmpty')} />
            ) : (
              <ListGroup>
                {board.data.rows.map((r: Json) => (
                  <RankRow key={r.athlete.id} testID={`board-${r.athlete.id}`} rank={r.rank} name={r.athlete.fullName || r.athlete.username || '—'} value={t('orgBoardPoints', { points: r.totalPoints })} subtitle={r.pending ? t('orgBoardPending', { count: r.pending }) : undefined} />
                ))}
              </ListGroup>
            )}
          </>
        )}
        <Card style={{ gap: space.sm }}>
          <Txt variant="title">{t('orgBoardPublishTitle')}</Txt>
          <Txt color={colors.outline}>{t('orgBoardPublishHint')}</Txt>
        </Card>
      </Screen>
    </>
  );
}
