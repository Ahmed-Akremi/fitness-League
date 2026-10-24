import { fireEvent, waitFor } from 'expo-router/testing-library';

import { formatMoney } from '../../src/features/competitions/api';
import { RegisterScreen } from '../../src/features/competitions/screens';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

const base = {
  id: 'c1',
  title: 'Summer Open',
  currency: 'TND',
  registrationPrice: 40000,
  status: 'REGISTRATION_OPEN',
  categories: [{ id: 'k1', name: 'RX', gender: 'MIXED', active: true, price: 40000 }],
  workouts: [],
  prizes: [],
  myRegistration: null,
  registrationEnd: '2026-12-01T00:00:00Z',
  deadlines: { registrationEnd: '2026-12-01T00:00:00Z' },
};
const tnd = (m: number) => formatMoney(m, 'TND', 'en');
const backendFor = (c: object) => new FakeBackend().on('GET', '/competitions/c1', [200, c]).on('GET', '/me', [200, { id: 'u1', username: 'sami', email: 'sami@x.tn' }]);
const disabled = (el: { props: { accessibilityState?: { disabled?: boolean } } }) => el.props.accessibilityState?.disabled === true;

describe('athlete registration (phase 4)', () => {
  it('asks for the code of a password-protected event', async () => {
    const screen = await renderScreen(() => <RegisterScreen id="c1" />, backendFor({ ...base, visibility: 'PASSWORD', accessCode: '123456' }));
    await fireEvent.changeText(await screen.findByTestId('reg-event-code'), '111111');
    await fireEvent.press(screen.getByTestId('reg-event-unlock'));
    expect(screen.getByText('Wrong code.')).toBeTruthy();
    expect(screen.queryByTestId('cat-k1')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('reg-event-code'), '123456');
    await fireEvent.press(screen.getByTestId('reg-event-unlock'));
    expect(await screen.findByTestId('cat-k1')).toBeTruthy();
  });

  it('tells an athlete who is not on the list of an invite-only event', async () => {
    const screen = await renderScreen(() => <RegisterScreen id="c1" />, backendFor({ ...base, inviteOnly: true, settings: { invitedEmails: ['coach@x.tn'] } }));
    expect(await screen.findByText('This event is by invitation only, and your email is not on the list.')).toBeTruthy();
    expect(screen.queryByTestId('cat-k1')).toBeNull();
  });

  it('unlocks a locked division with its code', async () => {
    const c = { ...base, categories: [{ ...base.categories[0], locked: true, unlockCode: '654321' }] };
    const screen = await renderScreen(() => <RegisterScreen id="c1" />, backendFor(c));
    await fireEvent.press(await screen.findByTestId('cat-k1'));
    expect(disabled(screen.getByTestId('reg-next'))).toBe(true);
    await fireEvent.changeText(screen.getByTestId('reg-div-code'), '654321');
    await fireEvent.press(screen.getByTestId('reg-div-unlock'));
    await waitFor(() => expect(disabled(screen.getByTestId('reg-next'))).toBe(false));
  });

  it('registers a team: name and teammate emails stay on the device, the server gets the category', async () => {
    let mine: object | null = null;
    const c = { ...base, categories: [{ ...base.categories[0], type: 'TEAM', teamMale: 1, teamFemale: 1 }] };
    const backend = backendFor(c)
      .on('GET', '/competitions/c1', () => [200, { ...c, myRegistration: mine }])
      .on('POST', '/competitions/c1/register', () => {
        mine = { id: 'r1', registrationStatus: 'PENDING', paymentStatus: 'PENDING' };
        return [201, mine];
      });
    const screen = await renderScreen(() => <RegisterScreen id="c1" />, backend);
    await fireEvent.press(await screen.findByTestId('cat-k1'));
    expect(disabled(screen.getByTestId('reg-next'))).toBe(true);
    await fireEvent.changeText(screen.getByTestId('reg-team-name'), 'Box Bandits');
    await fireEvent.changeText(screen.getByTestId('reg-member-0'), 'Mate@x.tn');
    await fireEvent.press(screen.getByTestId('reg-next'));
    await fireEvent.press(screen.getByTestId('register-confirm'));

    await waitFor(() => expect(backend.calls('POST', '/competitions/c1/register')).toHaveLength(1));
    expect(backend.calls('POST', '/competitions/c1/register')[0].body).toEqual({ categoryId: 'k1' });
    await expect(screen.services.api.get('/competitions/c1')).resolves.toMatchObject({ myRegistration: { id: 'r1', teamName: 'Box Bandits', teamMembers: ['mate@x.tn'] } });
  });

  it('waits for the required answers and agreements', async () => {
    const c = {
      ...base,
      registrationForm: [{ id: 'tshirt', label: 'T-shirt', type: 'SIZE', required: true, options: [] }],
      agreements: { liability: { required: true, text: 'I take part at my own risk.' } },
    };
    const screen = await renderScreen(() => <RegisterScreen id="c1" />, backendFor(c));
    await fireEvent.press(await screen.findByTestId('cat-k1'));
    // Division → Info → Waiver → Payment.
    expect(screen.getByTestId('reg-step-DETAILS')).toBeTruthy();
    expect(screen.getByTestId('reg-step-AGREEMENTS')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('reg-next'));
    expect(disabled(screen.getByTestId('reg-next'))).toBe(true);
    await fireEvent.press(screen.getByTestId('reg-answer-tshirt-M'));
    await fireEvent.press(screen.getByTestId('reg-next'));
    expect(screen.getByText('I take part at my own risk.')).toBeTruthy();
    expect(disabled(screen.getByTestId('reg-next'))).toBe(true);
    await fireEvent.press(screen.getByTestId('reg-agree-LIABILITY'));
    expect(disabled(screen.getByTestId('reg-next'))).toBe(false);
    await fireEvent.press(screen.getByTestId('reg-next'));
    expect(disabled(screen.getByTestId('register-confirm'))).toBe(false);
    // Back keeps what was typed; a step already done opens again from the bar.
    await fireEvent.press(screen.getByTestId('reg-back'));
    expect(screen.getByTestId('reg-agree-LIABILITY')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('reg-step-DIVISION'));
    expect(screen.getByTestId('cat-k1')).toBeTruthy();
  });

  it('lets the athlete pay a deposit now and the balance later', async () => {
    const c = { ...base, pricing: { fee: 'ABSORB', deposit: { enabled: true, type: 'PERCENT', value: 30 } } };
    const backend = backendFor(c).on('POST', '/competitions/c1/register', [201, { id: 'r1', registrationStatus: 'PENDING', paymentStatus: 'PENDING' }]);
    const screen = await renderScreen(() => <RegisterScreen id="c1" />, backend);
    await fireEvent.press(await screen.findByTestId('cat-k1'));
    await fireEvent.press(screen.getByTestId('reg-next'));
    await fireEvent.press(screen.getByTestId('reg-plan-DEPOSIT'));
    await fireEvent.press(screen.getByTestId('register-confirm'));
    expect(await screen.findByText(`Deposit to pay now: ${tnd(12000)}. Balance: ${tnd(28000)}.`)).toBeTruthy();
  });

  it('offers the waiting list when the division is full', async () => {
    const backend = backendFor(base).on('POST', '/competitions/c1/register', [409, { code: 'CATEGORY_FULL', status: 409 }]);
    const screen = await renderScreen(() => <RegisterScreen id="c1" />, backend);
    await fireEvent.press(await screen.findByTestId('cat-k1'));
    await fireEvent.press(screen.getByTestId('reg-next'));
    await fireEvent.press(screen.getByTestId('register-confirm'));
    await fireEvent.press(await screen.findByTestId('reg-waitlist'));
    expect(await screen.findByText('You’re on the waiting list. The organizer will contact you if a place opens.')).toBeTruthy();
    await expect(screen.services.api.get('/competitions/c1/waiting-list')).resolves.toEqual([expect.objectContaining({ categoryId: 'k1', email: 'sami@x.tn' })]);
  });

  it('makes athletes of a busy event wait their turn, then lets them in', async () => {
    const screen = await renderScreen(() => <RegisterScreen id="c1" />, backendFor({ ...base, settings: { highDemand: true } }));
    expect(await screen.findByText(/ahead of you/)).toBeTruthy();
    expect(await screen.findByTestId('cat-k1', {}, { timeout: 10_000 })).toBeTruthy();
  });
});
