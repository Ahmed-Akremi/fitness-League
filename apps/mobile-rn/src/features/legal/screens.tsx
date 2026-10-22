import { router, Stack } from 'expo-router';
import { View } from 'react-native';

import { useLocale, useT } from '../../core/prefs';
import { space, useTheme } from '../../core/theme';
import { formatDate } from '../../core/utils/format';
import { EmptyState } from '../../core/widgets/common';
import { ListGroup, ListRow, Screen, Txt } from '../../core/widgets/kit';
import { LEGAL_DOCS, LEGAL_UPDATED, LEGAL_VERSION, legalDoc } from './content';

const ICONS = { terms: 'gavel', privacy: 'privacy-tip', health: 'monitor-heart' } as const;

/** Legal documents, open to everyone (signed in or not): terms, privacy policy, health data. */
export function LegalIndexScreen() {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  return (
    <Screen>
      <Stack.Screen options={{ title: t('legalTitle') }} />
      <ListGroup>
        {LEGAL_DOCS.map((id) => {
          const doc = legalDoc(id, locale)!;
          return <ListRow key={id} testID={`legal-${id}`} icon={ICONS[id]} title={doc.title} subtitle={doc.summary} chevron onPress={() => router.push(`/legal/${id}`)} />;
        })}
      </ListGroup>
      <Txt variant="small" color={colors.outline}>{t('legalVersion', { version: LEGAL_VERSION, date: formatDate(LEGAL_UPDATED, locale) })}</Txt>
    </Screen>
  );
}

/** One document, in the app's language. */
export function LegalDocScreen({ id }: { id: string }) {
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const doc = legalDoc(id, locale);
  if (!doc) return <EmptyState icon="description" message={t('legalNotFound')} />;
  return (
    <Screen>
      <Stack.Screen options={{ title: doc.title }} />
      <Txt variant="small" color={colors.outline}>{t('legalVersion', { version: LEGAL_VERSION, date: formatDate(LEGAL_UPDATED, locale) })}</Txt>
      <Txt color={colors.outline}>{doc.summary}</Txt>
      {doc.sections.map((s) => (
        <View key={s.heading} style={{ gap: space.sm }}>
          <Txt variant="title" accessibilityRole="header">{s.heading}</Txt>
          {s.body.map((p, i) => (
            <Txt key={i}>{p}</Txt>
          ))}
        </View>
      ))}
    </Screen>
  );
}
