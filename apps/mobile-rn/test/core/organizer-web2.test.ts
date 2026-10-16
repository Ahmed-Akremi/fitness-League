import { ApiError } from '../../src/core/api/errors';
import { delayTargets, localDay } from '../../src/features/competitions/organizer/logic-b';
import { athleteHeats, dayEnd, daySchedule, fillDays, filterTransactions, finance, judgeCount, markPaidBatch, percentages, scheduleDay, topCategories, transactionsCsv } from '../../src/features/competitions/organizer/logic-web';
import { contentWidth, MENU_ICON, ORG_MENU, phoneTab, WIDE_WIDTH } from '../../src/features/competitions/organizer/web';
import { regs } from '../organizer-fixtures';

/** A registration with the price details the API sends (`originalPrice`, `discount`). */
const priced = (r: object, originalPrice: number, discount: number) => ({ ...r, originalPrice, discount });

describe('overview rules', () => {
  it('percentages are whole and add up to 100; nothing at all stays at 0', () => {
    expect(percentages([1, 1, 1])).toEqual([34, 33, 33]);
    expect(percentages([2, 1, 0])).toEqual([67, 33, 0]);
    expect(percentages([1, 2])).toEqual([33, 67]);
    expect(percentages([0, 0, 0])).toEqual([0, 0, 0]);
    for (const v of [[3, 3, 1], [7, 0, 2], [1, 1, 1, 1, 1, 1, 1]]) expect(percentages(v).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('judges are the judges and head judges of the staff', () => {
    expect(judgeCount([{ role: 'ORGANIZER' }, { role: 'JUDGE' }, { role: 'HEAD_JUDGE' }, { role: 'JUDGE' }])).toBe(3);
  });

  it('the busiest categories first, five at most', () => {
    const by = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ id, name: id, count: [2, 9, 4, 1, 7, 3][i] }));
    expect(topCategories(by).map((k) => k.id)).toEqual(['b', 'e', 'c', 'f', 'a']);
  });

  it('the days without a registration are on the axis at 0', () => {
    expect(fillDays([{ day: '2026-10-19', count: 1 }, { day: '2026-10-22', count: 2 }])).toEqual([
      { day: '2026-10-19', count: 1 },
      { day: '2026-10-20', count: 0 },
      { day: '2026-10-21', count: 0 },
      { day: '2026-10-22', count: 2 },
    ]);
    expect(fillDays([])).toEqual([]);
    expect(fillDays([{ day: '2026-10-31', count: 1 }, { day: '2026-11-01', count: 1 }]).map((d) => d.day)).toEqual(['2026-10-31', '2026-11-01']);
  });
});

describe('finances', () => {
  const rows = [
    priced(regs[0], 40000, 0), // r1: to collect
    priced(regs[1], 40000, 5000), // r2: paid 35 000 after a code
    priced(regs[2], 40000, 40000), // r3: free with a 100 % code
    priced(regs[3], 35000, 0), // r4: to collect
    priced(regs[4], 40000, 0), // r5: cancelled, never paid: not a transaction
    { ...priced(regs[1], 30000, 0), id: 'r6', paymentStatus: 'REFUNDED', registrationStatus: 'REFUNDED', finalPrice: 30000, registeredAt: '2026-10-23T09:00:00.000Z' },
  ];

  it('gross − discounts = the amounts = collected + to collect + refunded', () => {
    const f = finance(rows);
    expect(f).toMatchObject({ gross: 185000, discounts: 45000, collected: 35000, toCollect: 75000, free: 1, refunded: 30000 });
    expect(f.rows.map((r) => r.id)).toEqual(['r6', 'r3', 'r1', 'r2', 'r4']);
    const amounts = f.rows.reduce((s, r) => s + r.finalPrice, 0);
    expect(amounts).toBe(f.gross - f.discounts);
    expect(amounts).toBe(f.collected + f.toCollect + f.refunded);
  });

  it('an answer without the price details counts the amount as the price', () => {
    expect(finance(regs)).toMatchObject({ gross: 110000, discounts: 0, collected: 35000, toCollect: 75000, free: 1, refunded: 0 });
  });

  it('search ignores accents; the payment filter keeps one status', () => {
    const f = finance(rows);
    expect(filterTransactions(f.rows, { q: 'kefi', payment: 'ALL' }).map((r) => r.id)).toEqual(['r3']);
    expect(filterTransactions(f.rows, { q: '', payment: 'PENDING' }).map((r) => r.id)).toEqual(['r1', 'r4']);
    expect(filterTransactions(f.rows, { q: '', payment: 'REFUNDED' }).map((r) => r.id)).toEqual(['r6']);
  });

  it('the transactions export, amounts in currency units', () => {
    expect(transactionsCsv([rows[1]]).split('\n')).toEqual([
      'registered_at,name,username,category,price,discount,amount,currency,payment',
      '2026-10-20T09:00:00.000Z,Amira Trabelsi,amira,RX Women,40.000,5.000,35.000,TND,PAID',
    ]);
  });
});

describe('mark paid in a batch', () => {
  it('one request at a time; one settled meanwhile (409) is « already settled » and the rest go on', async () => {
    const seen: string[] = [];
    const r = await markPaidBatch(['a', 'b', 'c'], async (id) => {
      seen.push(id);
      if (id === 'b') throw new ApiError('client', 409, 'CONFLICT');
    });
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(r).toEqual({ paid: ['a', 'c'], already: ['b'], error: null, left: [] });
  });

  it('any other error stops the batch and keeps the ones left, the failed one first', async () => {
    const down = new ApiError('server', 500);
    const r = await markPaidBatch(['a', 'b', 'c'], async (id) => {
      if (id === 'b') throw down;
    });
    expect(r).toEqual({ paid: ['a'], already: [], error: down, left: ['b', 'c'] });
  });

  it('waits for each answer before sending the next', async () => {
    let open = 0;
    let most = 0;
    await markPaidBatch(['a', 'b', 'c'], async () => {
      open++;
      most = Math.max(most, open);
      await Promise.resolve();
      open--;
    });
    expect(most).toBe(1);
  });
});

describe('heats of an athlete and the day schedule', () => {
  const heat = (id: string, startsAt: string | null, lanes: object[] = [], durationMin = 12) => ({ id, name: `Heat ${id}`, startsAt, durationMin, laneCount: 4, lanes });
  // Local times: the day rules use the device's time zone.
  const at = (d: number, h: number, m = 0) => new Date(2026, 11, d, h, m).toISOString();
  const t = (d: number, h: number, m = 0) => new Date(2026, 11, d, h, m).getTime();
  const day12 = [heat('a', at(12, 9)), heat('b', at(12, 10)), heat('c', at(12, 11))];
  const day13 = [heat('d', at(13, 9)), heat('e', at(13, 10))];

  it('the heats an athlete is in, with the lane, in running order', () => {
    const hs = [heat('b', at(12, 10), [{ lane: 3, registrationId: 'r2' }]), heat('n', null, [{ lane: 1, registrationId: 'r2' }]), heat('a', at(12, 9), [{ lane: 2, registrationId: 'r2' }, { lane: 1, registrationId: 'r1' }])];
    expect(athleteHeats(hs, 'r2').map((x) => [x.heat.id, x.lane])).toEqual([['a', 2], ['b', 3], ['n', 1]]);
    expect(athleteHeats(hs, 'r9')).toEqual([]);
  });

  it('opens on the day of the heat running now', () => {
    expect(scheduleDay([...day12, ...day13], t(12, 10, 5))).toBe('2026-12-12');
  });

  it('nothing running: the day « Delay » would move, even the evening before', () => {
    const all = [...day12, ...day13];
    expect(scheduleDay(all, t(11, 20))).toBe('2026-12-12');
    expect(scheduleDay(all, t(12, 20))).toBe('2026-12-13');
    expect(scheduleDay(all, t(12, 20))).toBe(localDay(delayTargets(all, t(12, 20))[0].startsAt));
  });

  it('a heat running past midnight keeps its day; after the last heat, the last day; no timed heat, no day', () => {
    expect(scheduleDay([heat('x', at(12, 23, 50), [], 30), ...day13], t(13, 0, 10))).toBe('2026-12-12');
    expect(scheduleDay(day12, t(14, 9))).toBe('2026-12-12');
    expect(scheduleDay([heat('n', null)], t(12, 9))).toBeNull();
  });

  it('the day in running order, each heat done, running or upcoming, and when the day ends', () => {
    const list = daySchedule([...day13, ...day12, heat('n', null)], '2026-12-12', t(12, 10, 5));
    expect(list.map((x) => [x.heat.id, x.state])).toEqual([['a', 'done'], ['b', 'running'], ['c', 'upcoming']]);
    expect(dayEnd(list.map((x) => x.heat))).toBe(new Date(t(12, 11, 12)).toISOString());
    expect(dayEnd([])).toBeNull();
  });
});

describe('computer-only pages', () => {
  it('Finances and the time table fall back to the nearest phone tab', () => {
    expect(phoneTab('finances')).toBe('dashboard');
    expect(phoneTab('timetable')).toBe('planning');
    expect(phoneTab('team')).toBe('team');
  });

  it('they use the wide column; every menu page has an icon', () => {
    expect(contentWidth('finances')).toBe(WIDE_WIDTH);
    expect(contentWidth('timetable')).toBe(WIDE_WIDTH);
    for (const tab of ORG_MENU.flatMap((s) => s.tabs)) expect(MENU_ICON[tab]).toBeTruthy();
    expect(MENU_ICON.finances).toBe('payments');
    expect(MENU_ICON.timetable).toBe('schedule');
  });
});
