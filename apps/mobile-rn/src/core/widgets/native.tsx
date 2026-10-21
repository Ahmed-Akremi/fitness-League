import type { SFSymbol } from 'expo-symbols';

/** Android and the web: no SwiftUI. The callers only use these on iOS (see native.ios.tsx). */
export function NativeMenu(_: { label: string; systemImage: SFSymbol; color: string; items: { label: string; onPress: () => void; testID?: string }[]; testID?: string }) {
  return null;
}

export function NativePicker(_: { label: string; value: string | null | undefined; options: { value: string; label: string }[]; onChange: (v: string) => void; color: string; testID?: string }) {
  return null;
}
