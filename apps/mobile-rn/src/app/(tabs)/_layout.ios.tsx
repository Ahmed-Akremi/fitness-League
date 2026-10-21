import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useT } from '../../core/prefs';
import { useTheme } from '../../core/theme';
import { TABS } from '../../features/shell/tabs';

/**
 * iOS bottom bar: the system tab bar (Liquid Glass on iOS 26, sidebar-ready), filled SF Symbols (HIG Tab bars). Same
 * five tabs, order and URLs as the JavaScript tabs; each tab folder brings its own navigation stack.
 */
export default function TabsLayout() {
  const t = useT();
  const { colors } = useTheme();
  return (
    <NativeTabs tintColor={colors.primary}>
      {TABS.map((tab) => (
        <NativeTabs.Trigger key={tab.name} name={tab.name}>
          <NativeTabs.Trigger.Icon sf={tab.sf} />
          <NativeTabs.Trigger.Label>{t(tab.label)}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
