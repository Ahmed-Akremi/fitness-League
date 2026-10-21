import { Slot, Stack, useNavigation } from 'expo-router';

import { fonts, useTheme } from '../../core/theme';
import { HeaderTarget } from '../../core/widgets/kit';

/** iOS: a tab's own navigation stack — native tabs draw no header (HIG: each tab keeps its navigation bar). */
export function TabStack({ title }: { title: string }) {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: fonts.display, fontSize: 26 },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title }} />
    </Stack>
  );
}

/** Android and the web: the JavaScript tabs draw the header, so the screen's options go to its tab. */
export function TabSlot() {
  const tab = useNavigation();
  return (
    <HeaderTarget.Provider value={tab}>
      <Slot />
    </HeaderTarget.Provider>
  );
}
