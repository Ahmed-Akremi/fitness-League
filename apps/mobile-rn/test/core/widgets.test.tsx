import { fireEvent } from 'expo-router/testing-library';

import { SectionHeader, StatusPill } from '../../src/core/widgets/common';
import { ListGroup, ListRow } from '../../src/core/widgets/kit';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

describe('shared widgets', () => {
  it('ListGroup puts one divider between rows and skips empty children', async () => {
    const show = false;
    const screen = await renderScreen(
      () => (
        <ListGroup>
          <ListRow title="A" />
          {show && <ListRow title="hidden" />}
          {null}
          <ListRow title="B" />
          <ListRow title="C" />
        </ListGroup>
      ),
      new FakeBackend(),
    );
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.queryByText('hidden')).toBeNull();
    expect(screen.getAllByTestId('list-divider')).toHaveLength(2);
  });

  it('SectionHeader renders its action as a link', async () => {
    const onAction = jest.fn();
    const screen = await renderScreen(() => <SectionHeader title="My gym" actionLabel="Gyms" onAction={onAction} />, new FakeBackend());
    fireEvent.press(screen.getByText('Gyms'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('StatusPill shows its label', async () => {
    const screen = await renderScreen(() => <StatusPill label="Accepted" color="#C6F432" />, new FakeBackend());
    expect(screen.getByText('Accepted')).toBeTruthy();
  });
});
