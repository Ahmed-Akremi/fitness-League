import { boardFileName, filterBoard, finance, LIVE_REFRESH_MS, setActive, toSlug } from '../../src/features/competitions/organizer/logic-web';
import { FakeBackend } from '../fake-api';

describe('lot Web 3 rules', () => {
  const rows = [
    { rank: 1, athlete: { fullName: 'Hédi Kéfi', username: 'hedi' } },
    { rank: 2, athlete: { fullName: null, username: 'karim_m' } },
  ];

  it('the leaderboard search ignores accents and case, and looks at the username too', () => {
    expect(filterBoard(rows, 'KEFI').map((r) => r.rank)).toEqual([1]);
    expect(filterBoard(rows, 'karim').map((r) => r.rank)).toEqual([2]);
    expect(filterBoard(rows, '  ')).toBe(rows);
    expect(filterBoard(rows, 'zz')).toEqual([]);
  });

  it('file names carry the category, Arabic names fall back to the plain list name', () => {
    expect(toSlug('RX Femmes 18-35')).toBe('rx-femmes-18-35');
    expect(toSlug('Élite ')).toBe('elite');
    expect(boardFileName({ slug: 'sousse-2026' }, 'RX Men')).toBe('sousse-2026-leaderboard-rx-men.csv');
    expect(boardFileName({}, 'رجال')).toBe('event-leaderboard.csv');
  });

  it('switches one code on or off and leaves the others', () => {
    const list = [{ id: 'a', active: true }, { id: 'b', active: true }];
    expect(setActive(list, 'a', false)).toEqual([{ id: 'a', active: false }, { id: 'b', active: true }]);
    expect(list[0].active).toBe(true);
  });

  it('live pages read again every 30 s', () => {
    expect(LIVE_REFRESH_MS).toBe(30_000);
  });

  // Lot Web 2 review: the invariant on every payment × registration status the API can send (passes at once: it covers code that exists).
  it('the money adds up for every payment and registration status the API can send', () => {
    const pays = ['PENDING', 'PAID', 'FREE', 'FAILED', 'REFUNDED'];
    const statuses = ['PENDING', 'CONFIRMED', 'CANCELLED', 'REFUNDED'];
    const all = pays.flatMap((p, i) =>
      statuses.map((s, j) => ({
        id: `${p}-${s}`,
        paymentStatus: p,
        registrationStatus: s,
        originalPrice: 40000,
        discount: p === 'FREE' ? 40000 : 5000 * j,
        finalPrice: p === 'FREE' ? 0 : 40000 - 5000 * j,
        currency: 'TND',
        registeredAt: `2026-10-${10 + i}T0${j}:00:00.000Z`,
        user: { username: `u${i}${j}` },
      })),
    );
    const f = finance(all);
    const amounts = f.rows.reduce((sum, r) => sum + r.finalPrice, 0);
    expect(amounts).toBe(f.gross - f.discounts);
    expect(amounts).toBe(f.collected + f.toCollect + f.refunded);
    expect(f.rows.some((r) => r.paymentStatus === 'FAILED')).toBe(false);
    expect(f.rows.filter((r) => r.paymentStatus === 'PENDING').map((r) => r.registrationStatus).sort()).toEqual(['CONFIRMED', 'PENDING']);
  });
});

describe('test backend', () => {
  it('a handler can hold its answer until the test releases it', async () => {
    let release!: (answer: [number, unknown]) => void;
    const b = new FakeBackend().on('GET', '/x', () => new Promise<[number, unknown]>((r) => (release = r)));
    let done = false;
    const call = b.fetch('http://test/x', {}).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    release([200, { ok: true }]);
    await call;
    expect(done).toBe(true);
  });
});
