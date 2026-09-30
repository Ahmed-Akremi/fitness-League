import { useFonts } from 'expo-font';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { createServices, ServicesProvider } from '../core/services';
import { AppRoot } from '../features/shell/root';

export default function RootLayout() {
  const [services] = useState(createServices);
  const [fontsLoaded] = useFonts({
    'BarlowCondensed-ExtraBold': require('../../assets/fonts/BarlowCondensed-ExtraBold.ttf'),
    'BarlowCondensed-SemiBold': require('../../assets/fonts/BarlowCondensed-SemiBold.ttf'),
    Inter: require('../../assets/fonts/Inter-Variable.ttf'),
  });
  if (!fontsLoaded) return null;
  return (
    <SafeAreaProvider>
      <ServicesProvider services={services}>
        <AppRoot />
      </ServicesProvider>
    </SafeAreaProvider>
  );
}
