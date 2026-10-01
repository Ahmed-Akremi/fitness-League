import { fireEvent, waitFor } from 'expo-router/testing-library';

import { JudgeReviewScreen } from '../../src/features/competitions/judge';
import { RegisterScreen } from '../../src/features/competitions/screens';
import { FakeBackend } from '../fake-api';
import { renderScreen } from '../harness';

const competition = {
  id: 'c1',
  title: 'Tunisia Functional Fitness Championship',
  currency: 'EUR',
  registrationPrice: 3500,
  status: 'REGISTRATION_OPEN',
  categories: [{ id: 'rxm', name: 'RX Male', gender: 'MALE', minAge: 18, maxAge: 35, active: true, price: 4000 }],
  workouts: [],
  prizes: [],
  myRegistration: null,
  deadlines: { registrationEnd: '2026-10-10T00:00:00Z' },
};

describe('competition registration', () => {
  it('category → FREE coupon → final price 0 → confirmed', async () => {
    const backend = new FakeBackend()
      .on('GET', '/competitions/c1', [200, competition])
      .on('POST', '/competitions/c1/coupon/validate', [200, { originalPrice: 4000, discount: 4000, finalPrice: 0, paymentStatus: 'FREE', currency: 'EUR' }])
      .on('POST', '/competitions/c1/register', [201, { id: 'r1', registrationStatus: 'CONFIRMED', paymentStatus: 'FREE' }]);
    const screen = await renderScreen(() => <RegisterScreen id="c1" />, backend);
    await fireEvent.press(await screen.findByTestId('cat-rxm'));
    await fireEvent.changeText(screen.getByTestId('coupon'), 'free2026');
    await fireEvent.press(screen.getByTestId('coupon-apply'));
    await waitFor(() => expect(backend.calls('POST', '/competitions/c1/coupon/validate')[0]?.body).toEqual({ categoryId: 'rxm', code: 'FREE2026' }));
    expect((await screen.findByTestId('final-price')).props.children).toBe('Free');
    await fireEvent.press(screen.getByTestId('register-confirm'));
    expect(await screen.findByText("You're registered!")).toBeTruthy();
    expect(backend.calls('POST', '/competitions/c1/register')[0].body).toEqual({ categoryId: 'rxm', couponCode: 'FREE2026' });
  });
});

describe('judge review', () => {
  it('shows the score and the video, then approves', async () => {
    const backend = new FakeBackend()
      .on('GET', '/judge/submissions/s1', [
        200,
        {
          id: 's1',
          status: 'SUBMITTED',
          athlete: { id: 'u1', fullName: 'Ahmed Ben Salah' },
          category: { id: 'rxm', name: 'RX Male' },
          workout: { id: 'w3', name: 'WOD 3', scoringMethod: 'DIRECT_POINTS' },
          rawValue: 140,
          points: null,
          videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
          youtubeId: 'dQw4w9WgXcQ',
          submittedAt: '2026-10-01T10:00:00Z',
          versions: [{ version: 1, points: 0, reason: 'Submitted by athlete', createdAt: '2026-10-01T10:00:00Z' }],
        },
      ])
      .on('POST', '/judge/submissions/s1/approve', [200, { id: 's1', status: 'FINAL', points: 140 }]);
    const screen = await renderScreen(() => <JudgeReviewScreen id="s1" />, backend);
    expect(await screen.findByText('Ahmed Ben Salah')).toBeTruthy();
    expect(screen.getByText('140')).toBeTruthy();
    expect(screen.getByTestId('watch-video')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('judge-approve'));
    await waitFor(() => expect(backend.calls('POST', '/judge/submissions/s1/approve')).toHaveLength(1));
  });
});
