import { fireEvent, waitFor } from 'expo-router/testing-library';

import { OnboardingScreen } from '../../src/features/onboarding/screen';
import { FakeBackend } from '../fake-api';
import { renderScreen, sports, squat } from '../harness';

describe('OnboardingScreen', () => {
  it('sports → weekly plan → declared level → calibration starts', async () => {
    const backend = new FakeBackend()
      .on('GET', '/ref/sports', [200, sports])
      .on('GET', '/ref/exercises', [200, [squat]])
      .on('POST', '/me/onboarding/sports', [200, {}])
      .on('PATCH', '/me/profile', [200, {}])
      .on('POST', '/me/onboarding/baselines', [200, {}])
      .on('POST', '/me/onboarding/complete', [200, { completed: true }])
      .on('GET', '/me', [200, {}]);
    const screen = await renderScreen(OnboardingScreen, backend);

    expect(await screen.findByText('What do you train?')).toBeTruthy();
    await fireEvent.press(await screen.findByTestId('sport-BODYBUILDING'));
    await fireEvent.press(screen.getByTestId('onboarding-next'));

    expect(await screen.findByText('How many days a week do you plan to train?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('onboarding-next'));

    await fireEvent.changeText(await screen.findByTestId('baseline-BACK_SQUAT'), '80');
    await fireEvent.press(screen.getByTestId('onboarding-finish'));

    await waitFor(() => expect(backend.calls('POST', '/me/onboarding/complete')).toHaveLength(1));
    expect(backend.calls('POST', '/me/onboarding/sports')[0].body).toEqual({ sportIds: ['sp-bb'], primarySportId: 'sp-bb' });
    expect(backend.calls('PATCH', '/me/profile')[0].body).toEqual({ plannedTrainingDaysPerWeek: 3 });
    expect(backend.calls('POST', '/me/onboarding/baselines')[0].body).toEqual({ entries: [{ exerciseId: 'ex-squat', metricCode: 'E1RM', value: 80 }] });
  });
});
