import { AppException } from '../errors/app-exception';
import { CursorCodec } from './cursor';
import { toPage } from './page';

describe('CursorCodec', () => {
  const codec = new CursorCodec('s'.repeat(32));

  it('round-trips a keyset position', () => {
    const cursor = codec.encode({ k: '2026-09-25T10:00:00.000Z', id: 'abc' });
    expect(codec.decode(cursor)).toEqual({ k: '2026-09-25T10:00:00.000Z', id: 'abc' });
  });

  it('rejects tampered cursors', () => {
    const cursor = codec.encode({ id: 'abc' });
    const [, sig] = cursor.split('.');
    const forged = `${Buffer.from(JSON.stringify({ id: 'zzz' })).toString('base64url')}.${sig}`;
    expect(() => codec.decode(forged)).toThrow(AppException);
  });

  it('rejects cursors signed with another secret', () => {
    const other = new CursorCodec('o'.repeat(32)).encode({ id: 'abc' });
    expect(() => codec.decode(other)).toThrow(AppException);
  });

  it('rejects garbage', () => {
    expect(() => codec.decode('not-a-cursor')).toThrow(AppException);
  });
});

describe('toPage', () => {
  const encode = (k: Record<string, unknown>) => JSON.stringify(k);

  it('detects more rows using the extra fetched row', () => {
    const page = toPage([1, 2, 3], 2, (n) => ({ n }), encode);
    expect(page).toEqual({ data: [1, 2], page: { nextCursor: '{"n":2}', hasMore: true } });
  });

  it('returns no cursor on the last page', () => {
    expect(toPage([1, 2], 2, (n) => ({ n }), encode).page).toEqual({ nextCursor: null, hasMore: false });
  });
});
