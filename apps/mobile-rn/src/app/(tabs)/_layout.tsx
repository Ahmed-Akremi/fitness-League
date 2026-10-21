import { MaterialIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { useT } from '../../core/prefs';
import { fonts, useTheme } from '../../core/theme';
import { TABS } from '../../features/shell/tabs';

type Name = ComponentProps<typeof MaterialIcons>['name'];
const icon = (outline: Name, filled: Name) => ({ focused, color }: { focused: boolean; color: ColorValue }) => (
  <MaterialIcons name={focused ? filled : outline} size={24} color={color} />
);

/** Bottom bar (spec §19.1) on Android and the web: JavaScript tabs. iOS uses native tabs (_layout.ios.tsx). */
export default function TabsLayout() {
  const t = useT();
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: fonts.display, fontSize: 26 },
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.surfaceHigh },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.outline,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: t(tab.label), ...(tab.name === 'index' ? { headerShown: false } : null), tabBarIcon: icon(tab.icon, tab.selectedIcon) }} />
      ))}
    </Tabs>
  );
}
