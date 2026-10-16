import { useState } from 'react';
import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { space, useTheme } from '../../../core/theme';
import { EmptyState, RankRow, SkeletonList, StatusPill } from '../../../core/widgets/common';
import { ErrorView } from '../../../core/widgets/error';
import { Card, Chip, ListGroup, Screen, TextField, Txt } from '../../../core/widgets/kit';
import { SearchField } from '../../../core/widgets/web';
import { useCompLeaderboard } from '../api';
import { exportCsv } from './export';
import { Guide } from './guide';
import type { ManageTab } from './logic';
import { csvSeparator, leaderboardCsv } from './logic-b';
import { boardFileName, filterBoard, LIVE_REFRESH_MS } from './logic-web';
import { ExportButton, OrgPageHeader } from './page';
import { useWideWeb } from './web';

/** « Classement » (spec §1.3 item 8, lot Web 3 item 12): the ranking per category, searched by name, exported per category. Read only: the head judge publishes the final leaderboard (admin panel). */
export function LeaderboardTab({ c, onGo }: { c: Json; onGo?: (tab: ManageTab) => void }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const categories: Json[] = (c.categories ?? []).filter((k: Json) => k.active !== false);
  const [categoryId, setCategoryId] = useState<string | undefined>(categories[0]?.id);
  const [q, setQ] = useState('');
  // Read again every 30 s while this page is open (analysis §3 item 11).
  const board = useCompLeaderboard(c.id, categoryId, undefined, LIVE_REFRESH_MS);
  const wide = useWideWeb();
  const category = categories.find((k) => k.id === categoryId)?.name ?? '';
  const all: Json[] = board.data?.rows ?? [];
  const rows = filterBoard(all, q);
  const exportBtn = <ExportButton testID="board-export" disabled={rows.length === 0} onPress={() => exportCsv(boardFileName(c, category), leaderboardCsv(rows, category, csvSeparator(locale)))} />;
  const search = wide ? (
    <SearchField testID="board-search" placeholder={t('orgHeatSearch')} value={q} onChangeText={setQ} />
  ) : (
    <TextField testID="board-search" icon="search" placeholder={t('orgHeatSearch')} value={q} onChangeText={setQ} autoCapitalize="none" />
  );
  return (
    <>
      <OrgPageHeader
        tab="leaderboard"
        actions={
          board.data ? (
            <>
              {all.length ? search : null}
              {exportBtn}
            </>
          ) : undefined
        }
      />
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
            {all.length === 0 ? (
              <EmptyState icon="leaderboard" message={t('orgBoardEmpty')} />
            ) : (
              <>
                {wide ? null : search}
                {rows.length === 0 ? (
                  <Txt color={colors.outline}>{t('orgBoardNoMatch')}</Txt>
                ) : (
                  <ListGroup>
                    {rows.map((r: Json) => (
                      <RankRow key={r.athlete.id} testID={`board-${r.athlete.id}`} rank={r.rank} name={r.athlete.fullName || r.athlete.username || '—'} value={t('orgBoardPoints', { points: r.totalPoints })} subtitle={r.pending ? t('orgBoardPending', { count: r.pending }) : undefined} />
                    ))}
                  </ListGroup>
                )}
              </>
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
