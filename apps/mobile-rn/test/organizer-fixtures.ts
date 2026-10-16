import { FakeBackend } from './fake-api';

/** Organizer space, lot B: a published event (id c9) organized by the signed-in user, and its registrations. */
export const event = {
  id: 'c9',
  title: 'Sousse Summer Throwdown',
  description: 'Two days on site.',
  status: 'REGISTRATION_OPEN',
  format: 'ONSITE',
  city: 'Sousse',
  location: 'Bodynade',
  countryCode: 'TN',
  currency: 'TND',
  registrationPrice: 40000,
  maxParticipants: null,
  coverUrl: 'https://cdn.test/cover.webp',
  deadlines: { registrationStart: '2026-10-20T08:00:00.000Z', registrationEnd: '2026-12-01T22:00:00.000Z' },
  registrationEnd: '2026-12-01T22:00:00.000Z',
  eventStart: '2026-12-12T08:00:00.000Z',
  eventEnd: '2026-12-13T18:00:00.000Z',
  categories: [
    { id: 'k1', name: 'RX Men', gender: 'MALE', active: true, sortOrder: 0 },
    { id: 'k2', name: 'RX Women', gender: 'FEMALE', active: true, sortOrder: 1 },
  ],
  workouts: [
    { id: 'w1', number: 1, name: 'WOD 1', scoreType: 'REPS', variants: [] },
    { id: 'w2', number: 2, name: 'WOD 2', scoreType: 'TIME', variants: [] },
  ],
  prizes: [],
  participants: 2,
  myRoles: ['ORGANIZER'],
  myRegistration: null,
  publicationRequestedAt: null,
  publicationNote: null,
};

const reg = (id: string, categoryId: string, category: string, fullName: string, username: string, registrationStatus: string, paymentStatus: string, finalPrice: number, registeredAt: string) => ({
  id,
  categoryId,
  userId: `u-${id}`,
  registrationStatus,
  paymentStatus,
  finalPrice,
  currency: 'TND',
  registeredAt,
  category: { name: category },
  user: { username, profile: { fullName } },
});

export const regs = [
  reg('r1', 'k1', 'RX Men', 'Sami Ben Ali', 'sami_rx', 'PENDING', 'PENDING', 40000, '2026-10-21T09:00:00.000Z'),
  reg('r2', 'k2', 'RX Women', 'Amira Trabelsi', 'amira', 'CONFIRMED', 'PAID', 35000, '2026-10-20T09:00:00.000Z'),
  reg('r3', 'k1', 'RX Men', 'Hédi Kéfi', 'hedi', 'CONFIRMED', 'FREE', 0, '2026-10-21T15:00:00.000Z'),
  reg('r4', 'k2', 'RX Women', 'Yasmine Jaziri', 'yasmine', 'PENDING', 'PENDING', 35000, '2026-10-19T09:00:00.000Z'),
  reg('r5', 'k1', 'RX Men', 'Omar Zid', 'omar', 'CANCELLED', 'PENDING', 40000, '2026-10-22T09:00:00.000Z'),
];

export const me = { id: 'u-me', username: 'ahmed_rx' };

/** The event, its dashboard figures, its registrations and the signed-in organizer; each test adds the routes it exercises. */
export const orgBackend = (c: object = event) =>
  new FakeBackend()
    .on('GET', '/competitions/c9', [200, c])
    .on('GET', '/competitions/c9/dashboard', [200, { participants: 5, paidRegistrations: 1, freeRegistrations: 1, pendingPayments: 2, revenue: 35000, pendingSubmissions: 0, pendingJudging: 0, approvedSubmissions: 0, rejectedSubmissions: 0 }])
    .on('GET', '/competitions/c9/registrations', [200, regs])
    .on('GET', '/me', [200, me]);
