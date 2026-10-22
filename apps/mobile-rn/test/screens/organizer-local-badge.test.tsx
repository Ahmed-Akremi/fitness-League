import { LocalBadge } from '../../src/features/competitions/organizer/local-badge';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

describe('« Local » badge (data kept on this device until the server has it)', () => {
  it('says Local and explains it to screen readers', async () => {
    const screen = await renderScreen(() => <LocalBadge />, new FakeBackend());
    expect(screen.getByText('Local')).toBeTruthy();
    expect(screen.getByLabelText('Saved on this device only for now: the server does not keep it yet.')).toBeTruthy();
  });

  it('speaks French', async () => {
    const fr = await renderScreen(() => <LocalBadge />, new FakeBackend(), { locale: 'fr' });
    expect(fr.getByText('Local')).toBeTruthy();
    expect(fr.getByLabelText('Enregistré sur cet appareil seulement pour l’instant : le serveur ne le garde pas encore.')).toBeTruthy();
  });
});
