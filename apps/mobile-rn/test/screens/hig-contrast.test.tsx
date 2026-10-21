import { act } from 'expo-router/testing-library';
import { AccessibilityInfo, StyleSheet } from 'react-native';

import { ThemeScope, useTheme } from '../../src/core/theme';
import { TextField, Txt } from '../../src/core/widgets/kit';
import { FieldButton } from '../../src/core/widgets/pickers';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

// iOS (the jest platform): Settings › Accessibility › Display & Text Size › Increase Contrast. React Native's jest setup
// mocks AccessibilityInfo per test file, so this stays here.
jest.mocked(AccessibilityInfo.isDarkerSystemColorsEnabled).mockImplementation(() => Promise.resolve(true));

function Probe({ testID }: { testID: string }) {
  const { colors, highContrast } = useTheme();
  return <Txt testID={testID}>{JSON.stringify({ highContrast, border: colors.border, outline: colors.outline })}</Txt>;
}
const read = (screen: Awaited<ReturnType<typeof renderScreen>>, id = 'probe') => JSON.parse(screen.getByTestId(id).props.children);

describe('Increase Contrast (HIG Color)', () => {
  it('hairlines and field borders get stronger in both appearances, and relax when it is turned off', async () => {
    const screen = await renderScreen(
      () => (
        <>
          <Probe testID="probe" />
          <ThemeScope scheme="light">
            <Probe testID="light-probe" />
          </ThemeScope>
          <TextField testID="field" label="Name" />
          <FieldButton testID="button" label="Sport" value="" icon="arrow-drop-down" onPress={() => {}} />
        </>
      ),
      new FakeBackend(),
    );
    await act(async () => {});
    const dark = read(screen);
    expect(dark).toMatchObject({ highContrast: true, border: '#FFFFFF33' });
    expect(read(screen, 'light-probe').border).toBe('#00000029');
    expect(flat(screen.getByTestId('field').parent!).borderColor).toBe(dark.outline);
    expect(flat(screen.getByTestId('button')).borderColor).toBe(dark.outline);

    const changed = jest.mocked(AccessibilityInfo.addEventListener).mock.calls.find(([name]) => (name as string) === 'darkerSystemColorsChanged')![1] as unknown as (on: boolean) => void;
    await act(async () => changed(false));
    expect(read(screen)).toMatchObject({ highContrast: false, border: '#FFFFFF14' });
    expect(flat(screen.getByTestId('field').parent!).borderColor).not.toBe(dark.outline);
  });
});
