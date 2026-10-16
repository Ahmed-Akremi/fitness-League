import { View } from 'react-native';

import type { Json } from '../../../core/api/client';
import { useLocale, useT } from '../../../core/prefs';
import { space, useTheme } from '../../../core/theme';
import { formatDate } from '../../../core/utils/format';
import { SectionHeader } from '../../../core/widgets/common';
import { ErrorText } from '../../../core/widgets/error';
import { Card, ListGroup, ListRow, Txt } from '../../../core/widgets/kit';
import { useRegistrations } from './api';
import { distribution } from './logic-b';

/** Dashboard, lot B (spec §1.3 item 1): registrations per category, women / men, and per day, computed from the registration list. */
export function RegistrationsBreakdown({ c }: { c: Json }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const regs = useRegistrations(c.id);
  if (regs.isError) return <ErrorText error={regs.error} />;
  if (!regs.data) return null;
  const d = distribution(regs.data, c.categories ?? []);
  if (d.byCategory.length === 0) return null;
  const busiest = Math.max(...d.perDay.map((x) => x.count));
  return (
    <View style={{ gap: space.md }}>
      <SectionHeader title={t('orgBreakdown')} />
      <ListGroup>
        {d.byCategory.map((k) => (
          <ListRow key={k.id} testID={`split-${k.id}`} title={k.name} trailing={<Txt variant="title">{String(k.count)}</Txt>} />
        ))}
      </ListGroup>
      <Txt color={colors.outline}>{t('orgSplitGender', { women: d.women, men: d.men, mixed: d.mixed })}</Txt>
      <SectionHeader title={t('orgPerDay')} />
      <Card style={{ gap: space.xs }}>
        {d.perDay.map((x) => (
          <View key={x.day} testID={`day-${x.day}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Txt variant="small" style={{ width: 64 }}>
              {formatDate(`${x.day}T12:00:00`, locale, { day: 'numeric', month: 'short' })}
            </Txt>
            {/* The bar: the day's count against the busiest day. */}
            <View style={{ flex: 1, flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: colors.surfaceHigh }}>
              <View style={{ flex: x.count, backgroundColor: colors.primary }} />
              <View style={{ flex: busiest - x.count }} />
            </View>
            <Txt variant="small" style={{ width: 28, textAlign: 'right' }}>
              {String(x.count)}
            </Txt>
          </View>
        ))}
      </Card>
    </View>
  );
}
