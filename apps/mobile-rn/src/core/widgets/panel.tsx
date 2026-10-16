import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { space, ThemeScope, useTheme, webDense } from '../theme';
import { useReducedMotion } from './common';
import { IconButton, Txt } from './kit';

export const PANEL_WIDTH = 420;

/**
 * Right drawer (Circle21 refs 08, 13): 420 px, slides in over 200 ms, light even on a dark page. Esc or a click on the
 * backdrop closes it; react-native-web's Modal keeps the keyboard focus inside and gives it back to what opened it.
 */
export function SidePanel({ visible, title, closeLabel, onClose, footer, children, testID = 'side-panel' }: { visible: boolean; title: string; closeLabel: string; onClose: () => void; footer?: ReactNode; children: ReactNode; testID?: string }) {
  return (
    <Modal testID={`${testID}-modal`} visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <ThemeScope scheme="light">
        <Drawer title={title} closeLabel={closeLabel} onClose={onClose} footer={footer} testID={testID}>
          {children}
        </Drawer>
      </ThemeScope>
    </Modal>
  );
}

function Drawer({ title, closeLabel, onClose, footer, children, testID }: { title: string; closeLabel: string; onClose: () => void; footer?: ReactNode; children: ReactNode; testID: string }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const x = useRef(new Animated.Value(PANEL_WIDTH)).current;
  useEffect(() => {
    if (reduced) x.setValue(0);
    else Animated.timing(x, { toValue: 0, duration: 200, useNativeDriver: false }).start();
  }, [reduced, x]);
  return (
    <View style={{ flex: 1 }}>
      {/* Not focusable: the keyboard goes straight to the drawer, Esc closes it. */}
      <Pressable testID={`${testID}-backdrop`} focusable={false} importantForAccessibility="no" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: '#00000066' }]} />
      <Animated.View testID={testID} accessibilityViewIsModal style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: PANEL_WIDTH, maxWidth: '100%', backgroundColor: colors.background, transform: [{ translateX: x }] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 56, paddingStart: space.xl, paddingEnd: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Txt numberOfLines={1} style={[webDense.cardTitle, { flex: 1, fontSize: 16 }]}>
            {title}
          </Txt>
          <IconButton testID={`${testID}-close`} icon="close" label={closeLabel} onPress={onClose} />
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.xl, gap: space.lg }}>
          {children}
        </ScrollView>
        {footer ? <View style={{ flexDirection: 'row', gap: space.md, padding: space.lg, borderTopWidth: 1, borderTopColor: colors.border }}>{footer}</View> : null}
      </Animated.View>
    </View>
  );
}
