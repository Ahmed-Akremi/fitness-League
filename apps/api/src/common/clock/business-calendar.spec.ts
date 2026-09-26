import { BusinessCalendar, TUNIS_UTC_OFFSET_MINUTES } from './business-calendar';

describe('BusinessCalendar (Africa/Tunis, UTC+1)', () => {
  const cal = new BusinessCalendar(TUNIS_UTC_OFFSET_MINUTES);

  it('starts the week on Monday 00:00 local time', () => {
    // Thursday 2026-09-24 12:00 UTC → Monday 2026-09-21 00:00 Tunis = Sunday 23:00 UTC
    expect(cal.weekStart(new Date('2026-09-24T12:00:00Z')).toISOString()).toBe('2026-09-20T23:00:00.000Z');
  });

  it('treats Sunday 23:30 UTC as the next local Monday', () => {
    // 2026-09-27T23:30Z = Monday 00:30 in Tunis → week starts that Monday
    expect(cal.weekStart(new Date('2026-09-27T23:30:00Z')).toISOString()).toBe('2026-09-27T23:00:00.000Z');
  });

  it('computes the local date', () => {
    expect(cal.localDate(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
  });

  it('computes quarter bounds in local time', () => {
    const { start, end } = cal.quarterBounds(new Date('2026-09-25T10:00:00Z'));
    expect(start.toISOString()).toBe('2026-06-30T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-30T23:00:00.000Z');
  });

  it('rolls quarters over the year boundary', () => {
    const { start, end } = cal.quarterBounds(new Date('2026-11-15T10:00:00Z'));
    expect(start.toISOString()).toBe('2026-09-30T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-12-31T23:00:00.000Z');
  });
});
