import { uuidv7 } from './uuid';

describe('uuidv7', () => {
  it('produces RFC 9562 v7 UUIDs', () => {
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is ordered by creation time', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a < b).toBe(true);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(1)));
    expect(ids.size).toBe(1000);
  });
});
