import { ANNOUNCEMENT_BODY_MAX, excerpt, normalizeBody } from './announcement-rules';

describe('announcement rules', () => {
  it('trims the text and treats blank text as no text', () => {
    expect(normalizeBody('  Final on Saturday  ')).toBe('Final on Saturday');
    expect(normalizeBody('   \n ')).toBeNull();
    expect(normalizeBody(undefined)).toBeNull();
    expect(normalizeBody(null)).toBeNull();
  });

  it('keeps the limit at 2000 characters after trimming', () => {
    expect(ANNOUNCEMENT_BODY_MAX).toBe(2000);
    expect(normalizeBody(` ${'x'.repeat(2000)} `)).toHaveLength(2000);
  });

  it('cuts the notification excerpt at 80 characters on a single line', () => {
    expect(excerpt('Short news')).toBe('Short news');
    expect(excerpt('line one\nline two')).toBe('line one line two');
    const long = excerpt('a'.repeat(100));
    expect(long).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
    expect(excerpt(null)).toBe('');
  });
});
