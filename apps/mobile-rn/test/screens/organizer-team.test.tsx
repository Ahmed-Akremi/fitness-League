import { act, fireEvent, waitFor } from 'expo-router/testing-library';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend } from '../organizer-fixtures';

const staff = [
  { id: 's1', userId: 'u-me', role: 'ORGANIZER', user: { username: 'ahmed_rx', profile: { fullName: 'Ahmed Ben Salah' } }, assignments: [] },
  { id: 's2', userId: 'u-2', role: 'ORGANIZER', user: { username: 'bilel', profile: { fullName: 'Bilel Haddad' } }, assignments: [] },
  { id: 's3', userId: 'u-3', role: 'HEAD_JUDGE', user: { username: 'hj_one', profile: { fullName: 'Head Judge One' } }, assignments: [] },
];
const team = () => orgBackend().on('GET', '/competitions/c9/staff', [200, staff]);
const open = () => <ManageScreen id="c9" initialTab="team" />;

describe('organizer space: team', () => {
  it('shows the team by role and never offers to remove yourself', async () => {
    const screen = await renderScreen(open, team());
    expect(await screen.findByText('Ahmed Ben Salah')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('Head Judge One')).toBeTruthy();
    expect(screen.getByText('Nobody yet.')).toBeTruthy();
    expect(screen.getByText('Judges and head judges are managed by the Fitness League team in the admin panel.')).toBeTruthy();
    expect(await screen.findAllByLabelText('Remove from the organizers')).toHaveLength(1);
  });

  it('removes a co-organizer after confirmation', async () => {
    const backend = team().on('DELETE', '/competitions/c9/staff/s2', [200, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press((await screen.findAllByLabelText('Remove from the organizers'))[0]);
    expect(screen.getByText('Bilel Haddad will no longer manage this event.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    await waitFor(() => expect(backend.calls('DELETE', '/competitions/c9/staff/s2')).toHaveLength(1));
  });

  it('adds a co-organizer found by name, once; an organizer already in the team cannot be picked', async () => {
    const backend = team()
      .on('GET', '/search/athletes', [200, { data: [{ id: 'u-7', username: 'amira', fullName: 'Amira Trabelsi' }, { id: 'u-2', username: 'bilel', fullName: 'Bilel Haddad' }], page: {} }])
      .on('POST', '/competitions/c9/staff', [201, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('team-add'));
    await fireEvent.changeText(screen.getByTestId('team-search'), 'ami');
    expect(await screen.findByTestId('team-pick-u-7')).toBeTruthy();
    expect(screen.getByText('Already an organizer')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('team-pick-u-2'));
    expect(backend.calls('POST', '/competitions/c9/staff')).toHaveLength(0);
    await act(async () => {
      fireEvent.press(screen.getByTestId('team-pick-u-7'));
      fireEvent.press(screen.getByTestId('team-pick-u-7'));
    });
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/staff')).toHaveLength(1));
    expect(backend.calls('POST', '/competitions/c9/staff')[0].body).toEqual({ userId: 'u-7', role: 'ORGANIZER' });
    expect(await screen.findByTestId('team-add')).toBeTruthy();
  });
});
