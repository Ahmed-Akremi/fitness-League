import { act } from 'expo-router/testing-library';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';
import { setWide } from '../wide-web';

jest.mock('../../src/features/competitions/organizer/web', () => ({
  ...jest.requireActual('../../src/features/competitions/organizer/web'),
  useWideWeb: () => require('../wide-web').useWide(),
}));

// The stack keeps the options a screen set until the route goes away: each layout must say what it wants.
const mockOptions: Record<string, unknown>[] = [];
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  Stack: {
    Screen: ({ options }: { options: Record<string, unknown> }) => {
      mockOptions.push(options);
      return null;
    },
  },
}));

describe('organizer space: the stack header', () => {
  it('a window narrowed from the computer layout shows the stack header again (title and way back)', async () => {
    setWide(true);
    const screen = await renderScreen(() => <ManageScreen id="c9" />, orgBackend());
    await screen.findByTestId('org-menu');
    expect(mockOptions[mockOptions.length - 1]).toMatchObject({ headerShown: false });
    await act(async () => setWide(false));
    await screen.findByTestId('org-tab-dashboard');
    expect(mockOptions[mockOptions.length - 1]).toMatchObject({ title: 'Sousse Summer Throwdown', headerShown: true });
  });
});
