import { act, fireEvent, waitFor } from 'expo-router/testing-library';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';

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
    // The admin panel's judges, and the floor judges of this on-site event: nobody yet.
    expect(screen.getAllByText('Nobody yet.')).toHaveLength(2);
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
    await fireEvent.press(screen.getByTestId('team-pick-u-7'));
    // Full rights for someone else: asked first.
    expect(screen.getByText('Amira Trabelsi will be able to change everything in this event, like you.')).toBeTruthy();
    expect(backend.calls('POST', '/competitions/c9/staff')).toHaveLength(0);
    await act(async () => {
      fireEvent.press(screen.getByTestId('dialog-confirm'));
      fireEvent.press(screen.getByTestId('dialog-confirm'));
    });
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/staff')).toHaveLength(1));
    expect(backend.calls('POST', '/competitions/c9/staff')[0].body).toEqual({ userId: 'u-7', role: 'ORGANIZER' });
    expect(await screen.findByTestId('team-add')).toBeTruthy();
  });

  it('on-site events: floor judges with their invitation status, invited by name and removed after confirmation', async () => {
    const floor = [
      { id: 'f1', userId: 'u-8', role: 'FLOOR_JUDGE', acceptedAt: '2026-10-21T10:00:00Z', user: { username: 'nour', profile: { fullName: 'Nour Gharbi' } }, assignments: [] },
      { id: 'f2', userId: 'u-9', role: 'FLOOR_JUDGE', acceptedAt: null, user: { username: 'ali', profile: { fullName: 'Ali Trabelsi' } }, assignments: [] },
    ];
    const backend = orgBackend()
      .on('GET', '/competitions/c9/staff', [200, [...staff, ...floor]])
      .on('GET', '/search/athletes', [200, { data: [{ id: 'u-7', username: 'amira', fullName: 'Amira Trabelsi' }, { id: 'u-8', username: 'nour', fullName: 'Nour Gharbi' }], page: {} }])
      .on('POST', '/competitions/c9/staff', [201, {}])
      .on('DELETE', '/competitions/c9/staff/f2', [204, undefined]);
    const screen = await renderScreen(open, backend);
    expect(await screen.findByText('Floor judges')).toBeTruthy();
    expect(screen.getByText('Accepted')).toBeTruthy();
    expect(screen.getByText('Invitation sent')).toBeTruthy();

    await fireEvent.press(screen.getAllByLabelText('Remove this judge')[0]);
    expect(screen.getByText('Ali Trabelsi will no longer judge this event; their lanes will have no judge.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    await waitFor(() => expect(backend.calls('DELETE', '/competitions/c9/staff/f2')).toHaveLength(1));

    await fireEvent.press(await screen.findByTestId('team-floor-invite'));
    await fireEvent.changeText(screen.getByTestId('team-search'), 'ami');
    expect(await screen.findByTestId('team-pick-u-7')).toBeTruthy();
    expect(screen.getByText('Already invited')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('team-pick-u-7'));
    expect(screen.getByText('Invite Amira Trabelsi to judge this event?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/staff')).toHaveLength(1));
    expect(backend.calls('POST', '/competitions/c9/staff')[0].body).toEqual({ userId: 'u-7', role: 'FLOOR_JUDGE' });
  });

  it('online events have no floor judges', async () => {
    const screen = await renderScreen(open, orgBackend({ ...event, format: 'ONLINE' }).on('GET', '/competitions/c9/staff', [200, staff]));
    expect(await screen.findByText('Ahmed Ben Salah')).toBeTruthy();
    expect(screen.queryByTestId('team-floor')).toBeNull();
  });
});
