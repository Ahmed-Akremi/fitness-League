import { fireEvent, waitFor } from 'expo-router/testing-library';

import { JudgeReviewScreen, JudgeScreen } from '../../src/features/competitions/judge';
import { CompetitionScreen, RegisterScreen, SubmitScreen } from '../../src/features/competitions/screens';
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

describe('score submission', () => {
  it('needs the YouTube link to submit, then sends it with the score', async () => {
    const backend = new FakeBackend()
      .on('GET', '/competitions/c1', [200, { ...competition, myRegistration: { registrationStatus: 'CONFIRMED' }, workouts: [{ id: 'w1', number: 1, name: 'WOD 1', description: 'Max burpees', scoreType: 'REPS', maximumPoints: 100 }] }])
      .on('POST', '/competitions/c1/wods/w1/submissions', [201, { id: 's1', status: 'SUBMITTED' }]);
    const screen = await renderScreen(() => <SubmitScreen id="c1" wodId="w1" />, backend);
    await fireEvent.changeText(await screen.findByTestId('sub-reps'), '87');
    expect(screen.getByText('Add the YouTube link of your video to submit your score.')).toBeTruthy();
    expect(screen.queryByTestId('sub-upload')).toBeNull();
    await fireEvent.press(screen.getByTestId('sub-send'));
    expect(backend.calls('POST', '/competitions/c1/wods/w1/submissions')).toHaveLength(0);
    await fireEvent.changeText(screen.getByTestId('sub-video'), 'https://youtu.be/dQw4w9WgXcQ');
    await fireEvent.press(screen.getByTestId('sub-send'));
    await waitFor(() => expect(backend.calls('POST', '/competitions/c1/wods/w1/submissions')).toHaveLength(1));
    expect(backend.calls('POST', '/competitions/c1/wods/w1/submissions')[0].body).toMatchObject({ raw: { reps: 87 }, videoUrl: 'https://youtu.be/dQw4w9WgXcQ', submit: true });
  });
});

describe('judge space by athlete', () => {
  it('lists each athlete with their completed WODs and the YouTube link of each', async () => {
    const sub = (id: string, n: number, url: string | null) => ({ id, status: 'SUBMITTED', workout: { id: `w${n}`, number: n, name: `WOD ${n}` }, rawValue: 90 + n, points: null, videoUrl: url, youtubeId: url ? 'dQw4w9WgXcQ' : null });
    const backend = new FakeBackend().on('GET', '/judge/athletes', [
      200,
      [
        {
          competition: { id: 'c1', title: 'Tunisia Functional Fitness Championship' },
          wodCount: 3,
          athletes: [
            { athlete: { id: 'u1', fullName: 'Ahmed Ben Salah' }, category: { id: 'rxm', name: 'RX Male' }, submissions: [sub('s1', 1, 'https://youtu.be/dQw4w9WgXcQ'), sub('s2', 2, 'https://youtu.be/abcdefghijk')] },
            { athlete: { id: 'u2', fullName: 'Ali Trabelsi' }, category: { id: 'rxm', name: 'RX Male' }, submissions: [sub('s3', 1, null)] },
          ],
        },
      ],
    ]);
    const screen = await renderScreen(() => <JudgeScreen />, backend);
    expect(await screen.findByText('Ahmed Ben Salah')).toBeTruthy();
    expect(screen.getByText('2 / 3 WODs')).toBeTruthy();
    expect(screen.getByText('1 / 3 WODs')).toBeTruthy();
    expect(screen.getByText('▶ https://youtu.be/dQw4w9WgXcQ')).toBeTruthy();
    expect(screen.getByText('▶ https://youtu.be/abcdefghijk')).toBeTruthy();
    expect(screen.getByText('No video link')).toBeTruthy();
    expect(screen.getAllByText('WOD 1')).toHaveLength(2);
  });
});

describe('heats', () => {
  it('shows the athlete their heat and lane on the competition page', async () => {
    const backend = new FakeBackend()
      .on('GET', '/competitions/c1', [200, { ...competition, format: 'ONSITE', description: 'Finals', eventStart: '2026-10-20T08:00:00Z', participants: 2, organizer: { fullName: 'Org' }, myRegistration: { registrationStatus: 'CONFIRMED' } }])
      .on('GET', '/competitions/c1/my-submissions', [200, []])
      .on('GET', '/competitions/c1/heats', [
        200,
        [
          { id: 'h1', number: 1, name: 'RX Male · Heat 1', startsAt: '2026-10-20T09:00:00Z', workout: { id: 'w1', name: 'WOD 1' }, category: { id: 'rxm', name: 'RX Male' }, lanes: [{ lane: 1, mine: false, athlete: { id: 'u2' } }] },
          { id: 'h2', number: 2, name: 'RX Male · Heat 2', startsAt: '2026-10-20T09:15:00Z', workout: { id: 'w1', name: 'WOD 1' }, category: { id: 'rxm', name: 'RX Male' }, lanes: [{ lane: 3, mine: true, athlete: { id: 'u1' } }] },
        ],
      ]);
    const screen = await renderScreen(() => <CompetitionScreen id="c1" />, backend);
    expect(await screen.findByTestId('my-heat')).toBeTruthy();
    expect(screen.getAllByText('RX Male · Heat 2 · Lane 3')).toHaveLength(1);
    expect(screen.getByText('RX Male · Heat 1')).toBeTruthy();
  });
});
