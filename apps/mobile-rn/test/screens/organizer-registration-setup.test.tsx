import { fireEvent, waitFor } from 'expo-router/testing-library';

import { formatMoney } from '../../src/features/competitions/api';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { ORG_MENU } from '../../src/features/competitions/organizer/web';
import { renderScreen } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';

// Bytes 0,1,0,0 → 65 536 → code « 065536 ».
jest.mock('expo-crypto', () => ({ ...jest.requireActual('expo-crypto'), getRandomBytes: () => new Uint8Array([0, 1, 0, 0]) }));

const tnd = (millimes: number) => formatMoney(millimes, 'TND', 'en');

describe('divisions (phase 3)', () => {
  it('creates a team division under a parent, locked with a code, its extras kept on the device', async () => {
    let categories = event.categories;
    const backend = orgBackend(event)
      .on('GET', '/competitions/c9', () => [200, { ...event, categories }])
      .on('POST', '/competitions/c9/categories', (req) => {
        categories = [...categories, { id: 'k3', name: req.body.name, gender: 'MIXED', active: true, sortOrder: 2 }];
        return [201, categories[2]];
      });
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="categories" />, backend);
    await fireEvent.press(await screen.findByTestId('cat-new'));
    await fireEvent.changeText(screen.getByTestId('cat-name'), 'Teams RX');
    await fireEvent.press(screen.getByTestId('div-type-TEAM'));
    await fireEvent.changeText(screen.getByTestId('div-team-male'), '1');
    expect(screen.getByText('A team needs at least two athletes.')).toBeTruthy();
    expect(screen.getByTestId('cat-save').props.accessibilityState?.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('div-team-female'), '1');
    await fireEvent.press(screen.getByTestId('div-parent-k1'));
    await fireEvent(screen.getByTestId('div-locked'), 'valueChange', true);
    expect(screen.getByText('Unlock code: 065536')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('cat-save'));

    await waitFor(() => expect(backend.calls('POST', '/competitions/c9/categories')).toHaveLength(1));
    expect(backend.calls('POST', '/competitions/c9/categories')[0].body).not.toHaveProperty('type');
    const saved = (await screen.services.api.get<{ categories: { id: string }[] }>('/competitions/c9')).categories.find((k) => k.id === 'k3');
    expect(saved).toMatchObject({ type: 'TEAM', teamMale: 1, teamFemale: 1, parentId: 'k1', locked: true, unlockCode: '065536' });
  });

  it('refuses an early-bird price that is not below the price', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="categories" />, orgBackend(event));
    await fireEvent.press(await screen.findByTestId('cat-k1'));
    await fireEvent.changeText(screen.getByTestId('div-early-price'), '45');
    expect(screen.getByText('The early-bird price must be below the normal price.')).toBeTruthy();
    expect(screen.getByTestId('cat-save').props.accessibilityState?.disabled).toBe(true);
  });

  it('shows a sub-division under its parent', async () => {
    const c = { ...event, categories: [event.categories[0], { ...event.categories[1], parentId: 'k1' }] };
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="categories" />, orgBackend(c));
    expect(await screen.findByText(/Sub-division of RX Men/)).toBeTruthy();
  });
});

describe('pricing page (phase 3)', () => {
  it('shows what the athlete pays and saves the choices on the device', async () => {
    const backend = orgBackend(event);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="pricing" />, backend);
    expect((await screen.findByTestId('price-athlete-pays')).props.children).toBe(tnd(43100));
    await fireEvent.press(screen.getByTestId('price-fee-ABSORB'));
    expect(screen.getByTestId('price-athlete-pays').props.children).toBe(tnd(40000));
    expect(screen.getByTestId('price-organizer-gets').props.children).toBe(tnd(36900));
    await fireEvent.press(screen.getByTestId('price-save'));

    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(backend.calls('PUT', '/competitions/c9')).toHaveLength(0);
    await expect(screen.services.api.get('/competitions/c9')).resolves.toMatchObject({ pricing: { fee: 'ABSORB' } });
  });

  it('refuses a VAT rate over 100 %', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="pricing" />, orgBackend(event));
    await fireEvent(await screen.findByTestId('price-tax'), 'valueChange', true);
    await fireEvent.changeText(screen.getByTestId('price-tax-percent'), '120');
    expect(screen.getByText('Enter a rate between 0 and 100.')).toBeTruthy();
    expect(screen.getByTestId('price-save').props.accessibilityState?.disabled).toBe(true);
  });
});

describe('waiver and form page (phase 3)', () => {
  it('adds a required size question and a liability waiver, kept on the device', async () => {
    const backend = orgBackend(event);
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="forms" />, backend);
    await fireEvent.press(await screen.findByTestId('form-add'));
    await fireEvent.changeText(screen.getByTestId('form-field-label'), 'T-shirt');
    await fireEvent.press(screen.getByTestId('form-field-type-SIZE'));
    await fireEvent.press(screen.getByTestId('form-field-save'));
    await fireEvent(screen.getByTestId('agr-liability'), 'valueChange', true);
    await fireEvent.changeText(screen.getByTestId('agr-liability-text'), 'I take part at my own risk.');
    await fireEvent.press(screen.getByTestId('forms-save'));

    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(backend.calls('PUT', '/competitions/c9')).toHaveLength(0);
    await expect(screen.services.api.get('/competitions/c9')).resolves.toMatchObject({
      registrationForm: [{ label: 'T-shirt', type: 'SIZE', required: true }],
      agreements: { liability: { required: true, text: 'I take part at my own risk.' } },
    });
  });

  it('needs two options for a list question', async () => {
    const screen = await renderScreen(() => <ManageScreen id="c9" initialTab="forms" />, orgBackend(event));
    await fireEvent.press(await screen.findByTestId('form-add'));
    await fireEvent.changeText(screen.getByTestId('form-field-label'), 'Level');
    await fireEvent.press(screen.getByTestId('form-field-type-SELECT'));
    await fireEvent.changeText(screen.getByTestId('form-field-options'), 'RX');
    expect(screen.getByText('A list needs at least two options, separated by commas.')).toBeTruthy();
    expect(screen.getByTestId('form-field-save').props.accessibilityState?.disabled).toBe(true);
  });

  it('both new pages sit under General in the computer menu', () => {
    expect(ORG_MENU.find((s) => s.key === 'general')?.tabs).toEqual(expect.arrayContaining(['pricing', 'forms']));
  });
});
