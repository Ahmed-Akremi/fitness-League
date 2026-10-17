import { fireEvent } from 'expo-router/testing-library';

import type { ManageTab } from '../../src/features/competitions/organizer/logic';
import { ManageScreen } from '../../src/features/competitions/organizer/manage';
import { renderScreen } from '../harness';
import { event, orgBackend } from '../organizer-fixtures';

const open = (tab: ManageTab) => () => <ManageScreen id="c9" initialTab={tab} />;
const noCategory = { ...event, categories: [] };
const noWod = { ...event, workouts: [] };

describe('organizer space: empty pages guide the organizer', () => {
  it('heats without a category: create one first, the button opens Categories', async () => {
    const screen = await renderScreen(open('planning'), orgBackend(noCategory).on('GET', '/competitions/c9/heats', [200, []]));
    expect(await screen.findByText('Create a category first: heats and the leaderboard belong to one.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('guide-categories-go'));
    expect(await screen.findByTestId('cat-new')).toBeTruthy();
  });

  it('heats with a category but no WOD: add a WOD first', async () => {
    const screen = await renderScreen(open('planning'), orgBackend(noWod).on('GET', '/competitions/c9/heats', [200, []]));
    expect(await screen.findByText('Add a WOD first: heats and the leaderboard need one.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('guide-wods-go'));
    expect(await screen.findByTestId('wod-new')).toBeTruthy();
  });

  it('heats once categories and WODs exist: the usual empty message', async () => {
    const screen = await renderScreen(open('planning'), orgBackend().on('GET', '/competitions/c9/heats', [200, []]));
    expect(await screen.findByText('No heat yet. Create one, or generate them from a category.')).toBeTruthy();
    expect(screen.queryByTestId('guide-categories')).toBeNull();
  });

  it('the leaderboard without a WOD guides to WODs', async () => {
    const screen = await renderScreen(open('leaderboard'), orgBackend(noWod));
    await fireEvent.press(await screen.findByTestId('guide-wods-go'));
    expect(await screen.findByTestId('wod-new')).toBeTruthy();
  });

  it('the leaderboard without a category guides to Categories', async () => {
    const screen = await renderScreen(open('leaderboard'), orgBackend(noCategory));
    expect(await screen.findByTestId('guide-categories')).toBeTruthy();
  });

  it('WODs without a category: a hint, and a WOD can still be created', async () => {
    const screen = await renderScreen(open('wods'), orgBackend({ ...noCategory, workouts: [] }));
    expect(await screen.findByTestId('guide-categories')).toBeTruthy();
    expect(screen.getByTestId('wod-new')).toBeTruthy();
  });
});
