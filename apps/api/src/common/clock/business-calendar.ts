/**
 * Business calendar in a fixed-offset timezone. Tunisia (Africa/Tunis) is UTC+1 all year (no DST since 2009),
 * so a fixed offset is exact and avoids pulling a timezone library. A country with DST will need a tz database.
 */
export class BusinessCalendar {
  constructor(private readonly utcOffsetMinutes: number) {}

  private toLocal(d: Date): Date {
    return new Date(d.getTime() + this.utcOffsetMinutes * 60_000);
  }

  private fromLocalParts(year: number, month: number, day: number): Date {
    return new Date(Date.UTC(year, month, day) - this.utcOffsetMinutes * 60_000);
  }

  /** Monday 00:00 local time of the week containing `d`, as a UTC instant. */
  weekStart(d: Date): Date {
    const local = this.toLocal(d);
    const daysSinceMonday = (local.getUTCDay() + 6) % 7;
    return this.fromLocalParts(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysSinceMonday);
  }

  /** Local calendar date (YYYY-MM-DD) of `d`. */
  localDate(d: Date): string {
    return this.toLocal(d).toISOString().slice(0, 10);
  }

  /** First instant of the calendar quarter containing `d` and of the next one (default season = a quarter). */
  quarterBounds(d: Date): { start: Date; end: Date } {
    const local = this.toLocal(d);
    const q = Math.floor(local.getUTCMonth() / 3);
    return {
      start: this.fromLocalParts(local.getUTCFullYear(), q * 3, 1),
      end: this.fromLocalParts(local.getUTCFullYear(), q * 3 + 3, 1),
    };
  }
}

export const TUNIS_UTC_OFFSET_MINUTES = 60;
