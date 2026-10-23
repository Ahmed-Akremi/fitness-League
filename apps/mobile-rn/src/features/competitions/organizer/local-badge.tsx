import { View } from 'react-native';

import { useT } from '../../../core/prefs';
import { useTheme } from '../../../core/theme';
import { StatusPill } from '../../../core/widgets/common';

/** On pages whose data stays on this device until the server has it (design 2026-10-22, `core/api/org-local.ts`). */
export function LocalBadge() {
  const t = useT();
  const { colors } = useTheme();
  return (
    <View testID="local-badge" accessible accessibilityLabel={t('orgLocalBadgeHint')}>
      <StatusPill label={t('orgLocalBadge')} color={colors.warning} />
    </View>
  );
}
