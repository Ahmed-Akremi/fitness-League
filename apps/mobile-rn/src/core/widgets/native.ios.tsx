import { Button, Host, Menu, Picker, Text } from '@expo/ui/swift-ui';
import { frame, labelsHidden, labelStyle, pickerStyle, tag, tint } from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'expo-symbols';

/**
 * SwiftUI controls (@expo/ui) for iOS. Kept in a .ios file: their native views are looked up at import, which Android
 * and the web must never do (native.tsx stands in there).
 */

/** The system pull-down menu behind an icon; the label stays for VoiceOver; 44 pt target. */
export function NativeMenu({ label, systemImage, color, items, testID }: { label: string; systemImage: SFSymbol; color: string; items: { label: string; onPress: () => void; testID?: string }[]; testID?: string }) {
  return (
    <Host matchContents testID={testID}>
      <Menu label={label} systemImage={systemImage} modifiers={[labelStyle('iconOnly'), tint(color), frame({ minWidth: 44, minHeight: 44 })]}>
        {items.map((it) => (
          <Button key={it.label} testID={it.testID} label={it.label} onPress={it.onPress} />
        ))}
      </Menu>
    </Host>
  );
}

/** The system pop-up button: the current value, tapping opens the short list. */
export function NativePicker({ label, value, options, onChange, color, testID }: { label: string; value: string | null | undefined; options: { value: string; label: string }[]; onChange: (v: string) => void; color: string; testID?: string }) {
  return (
    <Host matchContents>
      <Picker testID={testID} label={label} selection={value ?? undefined} onSelectionChange={(v: string) => onChange(v)} modifiers={[pickerStyle('menu'), labelsHidden(), tint(color)]}>
        {options.map((o) => (
          <Text key={o.value} modifiers={[tag(o.value)]}>
            {o.label}
          </Text>
        ))}
      </Picker>
    </Host>
  );
}
