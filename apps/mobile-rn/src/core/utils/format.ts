export const formatNumber = (n: number, locale: string) => new Intl.NumberFormat(locale).format(n);

/** 1500 s → "25:00", 3725 s → "1:02:05". */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const two = (v: number) => String(v).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** Displays a metric value in its unit. */
export function formatMetric(value: number, unit: string, locale: string): string {
  switch (unit) {
    case 's':
      return formatDuration(Math.round(value));
    case 's_per_km':
      return `${formatDuration(Math.round(value))}/km`;
    case 'm':
      return `${formatNumber(Math.round((value / 1000) * 100) / 100, locale)} km`;
    case 'kg':
      return `${formatNumber(value, locale)} kg`;
    default:
      return formatNumber(value, locale);
  }
}

/** Localised name from the API's {fr, en, ar} objects. */
export function localized(i18n: unknown, locale: string): string {
  if (i18n && typeof i18n === 'object') {
    const m = i18n as Record<string, unknown>;
    return String(m[locale] ?? m.fr ?? m.en ?? '');
  }
  return i18n == null ? '' : String(i18n);
}

/** "4:58" → 298, "1:28:00" → 5280. Null when empty, malformed, minutes/seconds ≥ 60 or zero. */
export function parseDuration(input: string): number | null {
  const parts = input.trim().split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const n = parts.map(Number);
  if (n.slice(1).some((v) => v >= 60)) return null;
  const total = n.length === 3 ? n[0] * 3600 + n[1] * 60 + n[2] : n[0] * 60 + n[1];
  return total > 0 ? total : null;
}

/** yyyy-mm-dd in local time. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDate(d: Date | string, locale: string, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  return new Intl.DateTimeFormat(locale, opts).format(typeof d === 'string' ? new Date(d) : d);
}

/** "2 hours ago", "il y a 2 heures", "قبل ساعتين" — the largest unit that fits, "now" under a minute. */
export function timeAgo(d: Date | string, locale: string, now: number = Date.now()): string {
  const seconds = Math.round(((typeof d === 'string' ? new Date(d) : d).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60]];
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  return rtf.format(0, 'second');
}
