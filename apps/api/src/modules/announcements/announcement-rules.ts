/** Announcement text and photo limits (spec 2026-10-06 home news). */
export const ANNOUNCEMENT_BODY_MAX = 2000;
export const ANNOUNCEMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Photos are scaled down to this width at most, never enlarged. */
export const ANNOUNCEMENT_IMAGE_MAX_WIDTH = 1440;
const EXCERPT_LENGTH = 80;

/** Trimmed text, or null when there is none (blank text counts as none). */
export function normalizeBody(raw: unknown): string | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  return text === '' ? null : text;
}

/** One-line preview for the notification bell. */
export function excerpt(body: string | null): string {
  const line = (body ?? '').replace(/\s+/g, ' ').trim();
  return line.length <= EXCERPT_LENGTH ? line : `${line.slice(0, EXCERPT_LENGTH - 1)}…`;
}
