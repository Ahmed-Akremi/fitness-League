import { MaterialIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { useT } from '../../core/prefs';
import { useTheme } from '../../core/theme';

type Name = ComponentProps<typeof MaterialIcons>['name'];
const icon = (outline: Name, filled: Name) => ({ focused, color }: { focused: boolean; color: ColorValue }) => (
  <MaterialIcons name={focused ? filled : outline} size={24} color={color} />
);

/** Bottom bar (spec §19.1): Home · Train · League · Challenges(Goals) · Profile. */
export default function TabsLayout() {
  const t = useT();
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.surfaceHigh },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.outline,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('navHome'), tabBarIcon: icon('home', 'home') }} />
      <Tabs.Screen name="train" options={{ title: t('navTrain'), tabBarIcon: icon('fitness-center', 'fitness-center') }} />
      <Tabs.Screen name="league" options={{ title: t('navLeague'), tabBarIcon: icon('emoji-events', 'emoji-events') }} />
      <Tabs.Screen name="goals" options={{ title: t('navChallenges'), tabBarIcon: icon('outlined-flag', 'flag') }} />
      <Tabs.Screen name="profile" options={{ title: t('navProfile'), tabBarIcon: icon('person-outline', 'person') }} />
    </Tabs>
  );
}
