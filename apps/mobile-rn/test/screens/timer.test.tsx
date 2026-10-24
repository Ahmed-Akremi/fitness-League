import { act, fireEvent } from 'expo-router/testing-library';

import { TimerScreen } from '../../src/features/timer/screen';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

/** Moves the clock the screen reads, then lets its 100 ms tick run. */
async function pass(ms: number) {
  await act(async () => {
    jest.setSystemTime(Date.now() + ms);
    jest.advanceTimersByTime(200);
  });
}

describe('workout timer (Circle21 « Timer »)', () => {
  it('refuses 0:00 and missing rounds', async () => {
    const screen = await renderScreen(TimerScreen, new FakeBackend());
    await fireEvent.press(screen.getByTestId('timer-mode-AMRAP'));
    await fireEvent.changeText(screen.getByTestId('timer-length'), '0:00');
    expect(screen.getByText('The timer length can’t be 0:00.')).toBeTruthy();
    expect(screen.getByTestId('timer-set').props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('timer-mode-EMOM'));
    await fireEvent.changeText(screen.getByTestId('timer-rounds'), '');
    expect(screen.getByText('Enter the number of rounds.')).toBeTruthy();
  });

  it('counts down ten seconds, runs an AMRAP, pauses with the screen dimmed, and resets', async () => {
    const screen = await renderScreen(TimerScreen, new FakeBackend());
    await fireEvent.press(screen.getByTestId('timer-mode-AMRAP'));
    await fireEvent.changeText(screen.getByTestId('timer-length'), '1:00');
    await fireEvent.press(screen.getByTestId('timer-set'));
    expect(screen.getByTestId('timer-clock')).toHaveTextContent('10');
    expect(screen.getByText('Get ready')).toBeTruthy();
    await pass(10_000);
    await pass(5_000);
    expect(screen.getByTestId('timer-clock')).toHaveTextContent('0:55');
    await fireEvent.press(screen.getByTestId('timer-pause'));
    expect(screen.getByTestId('timer-ring')).toHaveStyle({ opacity: 0.45 });
    await fireEvent.press(screen.getByTestId('timer-reset'));
    expect(screen.getByTestId('timer-set')).toBeTruthy();
  });
});
