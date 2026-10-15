import { act, fireEvent, waitFor } from 'expo-router/testing-library';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { CompetitionScreen } from '../../src/features/competitions/screens';
import { renderScreen } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';

const posted = [{ id: 'a1', title: 'Heat 3 moved', body: 'Heat 3 now starts at 15:30.', createdAt: '2026-12-12T09:00:00.000Z' }];
const open = () => <ManageScreen id="c9" initialTab="announcements" />;

describe('organizer space: announcements', () => {
  it('lists what was posted and says that no notification is sent', async () => {
    const screen = await renderScreen(open, orgBackend().on('GET', '/competitions/c9/announcements', [200, posted]));
    expect(await screen.findByText('Heat 3 moved')).toBeTruthy();
    expect(screen.getByText('Heat 3 now starts at 15:30.')).toBeTruthy();
    expect(screen.getByText('Shown on the event page. No notification is sent.')).toBeTruthy();
  });

  it('posts once, trimmed, even on a double tap', async () => {
    const backend = orgBackend().on('GET', '/competitions/c9/announcements', [200, []]).on('POST', '/competitions/c9/announcements', [201, {}]);
    const screen = await renderScreen(open, backend);
    expect(await screen.findByText('No announcement yet.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('ann-title'), '  Parking ');
    await fireEvent.changeText(screen.getByTestId('ann-body'), ' Use the north gate. ');
    await act(async () => {
      fireEvent.press(screen.getByTestId('ann-post'));
      fireEvent.press(screen.getByTestId('ann-post'));
    });
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/announcements')).toHaveLength(1));
    expect(backend.calls('POST', '/competitions/c9/announcements')[0].body).toEqual({ title: 'Parking', body: 'Use the north gate.' });
  });

  it('keeps « Post » off until the title has 3 characters', async () => {
    const screen = await renderScreen(open, orgBackend().on('GET', '/competitions/c9/announcements', [200, []]));
    await fireEvent.changeText(await screen.findByTestId('ann-title'), 'Hi');
    await fireEvent.changeText(screen.getByTestId('ann-body'), 'Welcome!');
    expect(screen.getByTestId('ann-post').props.accessibilityState?.disabled).toBe(true);
  });

  it('the event page shows the latest announcements', async () => {
    const backend = orgBackend({ ...event, myRoles: [] }).on('GET', '/competitions/c9/announcements', [200, posted]);
    const screen = await renderScreen(() => <CompetitionScreen id="c9" />, backend);
    expect(await screen.findByText('Heat 3 moved')).toBeTruthy();
    expect(screen.getByText('Announcements')).toBeTruthy();
  });
});
