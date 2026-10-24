import { defaultDay, heatsOfDay, heatState, lanesWithEmpty, matchingLanes } from '../../src/features/competitions/logic-heats-day';

const heats = [
  { id: 'h2', number: 2, name: 'RX · Heat 2', startsAt: '2026-12-12T10:00:00', durationMin: 12, laneCount: 3, category: { name: 'RX Men' }, lanes: [{ lane: 2, mine: true, athlete: { fullName: 'Hédi Kéfi' } }] },
  { id: 'h1', number: 1, name: 'RX · Heat 1', startsAt: '2026-12-12T09:00:00', durationMin: 12, laneCount: 4, workout: { name: 'Fran' }, lanes: [{ lane: 1, athlete: { fullName: 'Sami Ben Ali', username: 'sami_rx' } }] },
  { id: 'h3', number: 3, name: 'Final', startsAt: '2026-12-13T15:00:00', durationMin: 10, laneCount: 2, lanes: [] },
];

describe('heats of the day', () => {
  it('one day in running order, only mine, or a search by heat, workout or athlete', () => {
    expect(heatsOfDay(heats, { day: '2026-12-12', mineOnly: false, q: '' }).map((h) => h.id)).toEqual(['h1', 'h2']);
    expect(heatsOfDay(heats, { day: null, mineOnly: true, q: '' }).map((h) => h.id)).toEqual(['h2']);
    expect(heatsOfDay(heats, { day: null, mineOnly: false, q: 'hedi' }).map((h) => h.id)).toEqual(['h2']);
    expect(heatsOfDay(heats, { day: null, mineOnly: false, q: 'fran' }).map((h) => h.id)).toEqual(['h1']);
    expect(matchingLanes(heats[1], 'SAMI_rx')).toEqual([1]);
    expect(matchingLanes(heats[1], '')).toEqual([]);
  });

  it('live while on the floor, done after, upcoming before', () => {
    const at = (iso: string) => Date.parse(iso);
    expect(heatState(heats[1], at('2026-12-12T08:59:00'))).toBe('UPCOMING');
    expect(heatState(heats[1], at('2026-12-12T09:05:00'))).toBe('LIVE');
    expect(heatState(heats[1], at('2026-12-12T09:13:00'))).toBe('DONE');
    expect(heatState({ ...heats[1], startedAt: 'x' }, at('2026-12-12T08:00:00'))).toBe('LIVE');
  });

  it('opens on today or the next day with heats, and lists empty lanes', () => {
    expect(defaultDay(['2026-12-12', '2026-12-13'], Date.parse('2026-12-13T08:00:00'))).toBe('2026-12-13');
    expect(defaultDay(['2026-12-12', '2026-12-13'], Date.parse('2026-11-01T08:00:00'))).toBe('2026-12-12');
    expect(defaultDay(['2026-12-12'], Date.parse('2027-01-01T08:00:00'))).toBe('2026-12-12');
    expect(defaultDay([], 0)).toBeNull();
    expect(lanesWithEmpty(heats[0]).map((l) => [l.lane, l.entry ? 'x' : null])).toEqual([[1, null], [2, 'x'], [3, null]]);
  });
});
