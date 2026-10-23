import { useLocalSearchParams } from 'expo-router';
import { fireEvent, waitFor } from 'expo-router/testing-library';

import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { StaffApplyScreen } from '../../src/features/competitions/organizer/staff-apply';
import { renderScreen } from '../harness';
import { event, orgBackend, regs } from '../organizer-fixtures';

function ApplyRoute() {
  const { id, form } = useLocalSearchParams<{ id: string; form: string }>();
  return <StaffApplyScreen id={id} formId={form} />;
}

describe('roster (phase 5)', () => {
  it('checks athletes in and counts them, cancelled registrations left out', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="roster" />, orgBackend(event));
    expect(await screen.findByText('0 of 4 checked in')).toBeTruthy();
    await fireEvent(screen.getByTestId('checkin-r1'), 'valueChange', true);
    expect(await screen.findByText('1 of 4 checked in')).toBeTruthy();
  });

  it('lists the teams with their members', async () => {
    const withTeam = regs.map((r) => (r.id === 'r2' ? { ...r, teamName: 'Box Bandits', teamMembers: ['mate@x.tn'] } : r));
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="roster" />, orgBackend(event).on('GET', '/competitions/c9/registrations', [200, withTeam]));
    expect(await screen.findByText('Box Bandits')).toBeTruthy();
    expect(screen.getByText(/mate@x\.tn/)).toBeTruthy();
  });

  it('adds and removes a sponsor', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="roster" />, orgBackend(event));
    await fireEvent.changeText(await screen.findByTestId('sponsor-name'), 'Box Gear');
    await fireEvent.press(screen.getByTestId('sponsor-add'));
    expect(await screen.findByText('Box Gear')).toBeTruthy();
    const [sponsor] = await screen.services.api.get<{ id: string }[]>('/competitions/c9/sponsors');
    await fireEvent.press(screen.getByTestId(`sponsor-remove-${sponsor.id}`));
    await waitFor(() => expect(screen.queryByText('Box Gear')).toBeNull());
  });

  it('invites the top athletes of a linked qualifier', async () => {
    const backend = orgBackend(event)
      .on('GET', '/competitions', [200, [{ id: 'q1', title: 'Online Qualifier', myRoles: ['ORGANIZER'] }]])
      .on('GET', '/competitions/q1', [200, { id: 'q1', title: 'Online Qualifier', categories: [{ id: 'qk1', name: 'RX Men', active: true }] }])
      .on('GET', '/competitions/q1/leaderboard', [200, { rows: [{ rank: 1, athlete: { id: 'u-h', fullName: 'Hédi Kéfi' }, totalPoints: 180 }, { rank: 2, athlete: { id: 'u-k', fullName: 'Karim Mansour' }, totalPoints: 150 }] }]);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="roster" />, backend);
    await fireEvent.press(await screen.findByTestId('finalists-src-q1'));
    await fireEvent.changeText(screen.getByTestId('finalists-count'), '1');
    await fireEvent.press(screen.getByTestId('finalists-invite'));
    // Hédi is also registered here: look at the invitation rows, not at the check-in list.
    expect(await screen.findByTestId('finalist-qk1:u-h')).toBeTruthy();
    expect(screen.queryByTestId('finalist-qk1:u-k')).toBeNull();
  });
});

describe('staff (phase 5)', () => {
  it('creates a form, takes an application through the public page, then approves and checks it in', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="staff" />, orgBackend(event), { routes: { 'competitions/[id]/staff-apply': ApplyRoute } });
    await fireEvent.changeText(await screen.findByTestId('staff-form-title'), 'Judges and volunteers');
    await fireEvent.changeText(screen.getByTestId('staff-form-roles'), 'Judge\nVolunteer');
    await fireEvent.changeText(screen.getByTestId('staff-form-shifts'), 'Saturday morning\nSunday');
    await fireEvent.press(screen.getByTestId('staff-form-save'));
    const [form] = await screen.services.api.get<{ id: string }[]>('/competitions/c9/staff-forms');
    await fireEvent.press(await screen.findByTestId(`staff-form-open-${form.id}`));

    await fireEvent.changeText(await screen.findByTestId('apply-name'), 'Sami Ben Ali');
    await fireEvent.changeText(screen.getByTestId('apply-email'), 'sami@x.tn');
    await fireEvent.press(screen.getByTestId('apply-role-Judge'));
    await fireEvent.press(screen.getByTestId('apply-shift-0'));
    await fireEvent.press(screen.getByTestId('apply-send'));
    expect(await screen.findByText('Application sent. The organizer will answer by email.')).toBeTruthy();
    const [app] = await screen.services.api.get<{ id: string; status: string; shifts: string[] }[]>('/competitions/c9/staff-applications');
    expect(app).toMatchObject({ status: 'PENDING', role: 'Judge', shifts: ['Saturday morning'] });
  });

  it('approves an application, checks the person in and filters by status', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="staff" />, orgBackend(event));
    await screen.findByTestId('staff-form-title');
    const form = await screen.services.api.post<{ id: string }>('/competitions/c9/staff-forms', { title: 'Judges', roles: ['Judge'], shifts: [] });
    await screen.services.api.post('/competitions/c9/staff-applications', { formId: form.id, name: 'Sami Ben Ali', email: 'sami@x.tn', role: 'Judge', shifts: [], status: 'PENDING', checkedIn: false });
    await fireEvent.press(screen.getByTestId('staff-refresh'));
    const [app] = await screen.services.api.get<{ id: string }[]>('/competitions/c9/staff-applications');
    await fireEvent.press(await screen.findByTestId(`staff-approve-${app.id}`));
    await fireEvent(await screen.findByTestId(`staff-checkin-${app.id}`), 'valueChange', true);
    expect(await screen.findByText('1 applicants · 1 approved · 0 pending · 0 declined · 1 checked in')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('staff-filter-status-PENDING'));
    expect(screen.queryByTestId(`staff-app-${app.id}`)).toBeNull();
  });
});
