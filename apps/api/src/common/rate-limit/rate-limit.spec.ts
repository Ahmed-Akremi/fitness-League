import { RateLimitStore } from './rate-limit';

describe('RateLimitStore', () => {
  it('counts hits inside a window and resets after it', () => {
    const store = new RateLimitStore();
    expect(store.hit('k', 60, 0).count).toBe(1);
    expect(store.hit('k', 60, 59_999).count).toBe(2);
    expect(store.hit('k', 60, 60_000).count).toBe(1);
  });

  it('keeps keys independent', () => {
    const store = new RateLimitStore();
    store.hit('a', 60, 0);
    expect(store.hit('b', 60, 0).count).toBe(1);
  });
});
