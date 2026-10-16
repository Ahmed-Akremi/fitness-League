import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';

describe('organizer space: dashboard breakdown', () => {
  it('counts the registrations still standing per category, women / men, and per day', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" />, orgBackend());
    expect(await screen.findByText('By category')).toBeTruthy();
    expect(screen.getByTestId('split-k1')).toBeTruthy();
    expect(screen.getByTestId('split-k2')).toBeTruthy();
    expect(screen.getByText('Women 2 · Men 2 · Mixed 0')).toBeTruthy();
    for (const day of ['2026-10-19', '2026-10-20', '2026-10-21']) expect(screen.getByTestId(`day-${day}`)).toBeTruthy();
    // Omar's registration of 22 October was cancelled.
    expect(screen.queryByTestId('day-2026-10-22')).toBeNull();
  });
});
