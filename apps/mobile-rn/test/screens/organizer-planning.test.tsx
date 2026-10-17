import { fireEvent, waitFor } from 'expo-router/testing-library';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { orgBackend, regs } from '../organizer-fixtures';

const lane = (n: number, r: (typeof regs)[number]) => ({ lane: n, registrationId: r.id, athlete: { id: r.userId, fullName: r.user.profile.fullName, username: r.user.username }, mine: false });
const heats = [
  { id: 'h1', number: 1, name: 'RX Men · Heat 1', startsAt: '2026-12-12T10:00:00.000Z', durationMin: 12, laneCount: 4, workout: { id: 'w1', name: 'WOD 1', number: 1 }, category: { id: 'k1', name: 'RX Men' }, lanes: [lane(1, regs[2])] },
  { id: 'h2', number: 2, name: 'RX Women · Heat 1', startsAt: '2026-12-13T10:00:00.000Z', durationMin: 12, laneCount: 4, workout: { id: 'w2', name: 'WOD 2', number: 2 }, category: { id: 'k2', name: 'RX Women' }, lanes: [lane(1, regs[1])] },
];
const planning = () => orgBackend().on('GET', '/competitions/c9/heats', [200, heats]);
const open = () => <ManageScreen id="c9" initialTab="planning" />;

describe('organizer space: planning', () => {
  it('lists the heats with their time, WOD, category and lanes', async () => {
    const screen = await renderScreen(open, planning());
    expect(await screen.findByText('RX Men · Heat 1')).toBeTruthy();
    expect(screen.getByText('RX Women · Heat 1')).toBeTruthy();
    expect(screen.getAllByText(/WOD 1 · RX Men · 1\/4 lanes/)).toHaveLength(1);
  });

  it('says so when there is no heat yet', async () => {
    const screen = await renderScreen(open, orgBackend().on('GET', '/competitions/c9/heats', [200, []]));
    expect(await screen.findByText('No heat yet. Create one, or generate them from a category.')).toBeTruthy();
  });

  it('filters by athlete and by day', async () => {
    const screen = await renderScreen(open, planning());
    await fireEvent.changeText(await screen.findByTestId('heat-search'), 'kefi');
    expect(screen.getByText('RX Men · Heat 1')).toBeTruthy();
    expect(screen.queryByText('RX Women · Heat 1')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('heat-search'), '');
    await fireEvent.press(screen.getByTestId('heat-day-2026-12-13'));
    expect(screen.queryByText('RX Men · Heat 1')).toBeNull();
    expect(screen.getByText('RX Women · Heat 1')).toBeTruthy();
  });

  it('creates a heat with what was filled', async () => {
    const backend = planning().on('POST', '/competitions/c9/heats', [201, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('heat-new'));
    await fireEvent.changeText(screen.getByTestId('heat-name'), 'Final');
    await fireEvent.changeText(screen.getByTestId('heat-duration'), '20');
    await fireEvent.changeText(screen.getByTestId('heat-lanes'), '6');
    await fireEvent.press(screen.getByTestId('heat-save'));
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/heats')).toHaveLength(1));
    expect(backend.calls('POST', '/competitions/c9/heats')[0].body).toEqual({ name: 'Final', durationMin: 20, laneCount: 6 });
    expect(await screen.findByTestId('heat-new')).toBeTruthy();
  });

  it('edits a heat, then deletes it after confirmation', async () => {
    const backend = planning().on('PUT', '/competitions/c9/heats/h1', [200, {}]).on('DELETE', '/competitions/c9/heats/h1', [200, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press((await screen.findAllByLabelText('Edit the heat'))[0]);
    await fireEvent.changeText(screen.getByTestId('heat-lanes'), '5');
    await fireEvent.press(screen.getByTestId('heat-save'));
    await waitFor(() => expect(backend.calls('PUT', '/competitions/c9/heats/h1')).toHaveLength(1));
    expect(backend.calls('PUT', '/competitions/c9/heats/h1')[0].body).toEqual({ name: 'RX Men · Heat 1', workoutId: 'w1', categoryId: 'k1', startsAt: '2026-12-12T10:00:00.000Z', durationMin: 12, laneCount: 5 });
    await fireEvent.press((await screen.findAllByLabelText('Edit the heat'))[0]);
    await fireEvent.press(screen.getByTestId('heat-delete'));
    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    await waitFor(() => expect(backend.calls('DELETE', '/competitions/c9/heats/h1')).toHaveLength(1));
  });

  it('generates the heats of a category and says how many', async () => {
    const backend = planning().on('POST', '/competitions/c9/heats/auto', [201, { heats: 2, athletes: 7 }]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('heat-auto'));
    await fireEvent.press(screen.getByTestId('auto-run'));
    expect(await screen.findByText('Heats created: 2, athletes placed: 7.')).toBeTruthy();
    expect(backend.calls('POST', '/competitions/c9/heats/auto')[0].body).toEqual({ categoryId: 'k1', laneCount: 8, intervalMin: 15 });
  });

  it('says when the category already has heats for this WOD', async () => {
    const backend = planning().on('POST', '/competitions/c9/heats/auto', [409, { code: 'CONFLICT', status: 409, reason: 'HEATS_EXIST' }]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('heat-auto'));
    await fireEvent.press(screen.getByTestId('auto-run'));
    expect(await screen.findByText('This category already has heats for this WOD.')).toBeTruthy();
  });

  it('fills a free lane with a confirmed athlete of the heat category, and frees a lane', async () => {
    const karim = { ...regs[0], id: 'r6', registrationStatus: 'CONFIRMED', paymentStatus: 'PAID', user: { username: 'karim', profile: { fullName: 'Karim Mansour' } } };
    const backend = planning()
      .on('GET', '/competitions/c9/registrations', [200, [...regs, karim]])
      .on('POST', '/competitions/c9/heats/h1/lanes', [201, {}])
      .on('DELETE', '/competitions/c9/heats/h1/lanes/1', [200, {}]);
    const screen = await renderScreen(open, backend);
    await fireEvent.press(await screen.findByTestId('heat-h1'));
    expect(screen.getByText('Hédi Kéfi')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('lane-2'));
    // Amira is in RX Women, Sami and Yasmine are not confirmed, Omar cancelled, Hédi already in the heat.
    expect(await screen.findByTestId('lane-cand-r6')).toBeTruthy();
    for (const id of ['r1', 'r2', 'r3', 'r4', 'r5']) expect(screen.queryByTestId(`lane-cand-${id}`)).toBeNull();
    await fireEvent.press(screen.getByTestId('lane-cand-r6'));
    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/heats/h1/lanes')).toHaveLength(1));
    expect(backend.calls('POST', '/competitions/c9/heats/h1/lanes')[0].body).toEqual({ registrationId: 'r6', lane: 2 });
    await fireEvent.press(screen.getByLabelText('Free the lane'));
    await waitFor(() => expect(backend.calls('DELETE', '/competitions/c9/heats/h1/lanes/1')).toHaveLength(1));
  });
});
