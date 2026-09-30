import { battleCollusion, farming, scoreSpike } from './behaviour';

describe('behavioural anti-cheat (docs §7.3)', () => {
  it('flags a weekly total far above the athlete history', () => {
    expect(scoreSpike([40, 45, 42, 38, 44], 95)).toMatchObject({ mean: 41.8 });
    expect(scoreSpike([40, 45, 42, 38, 44], 49)).toBeNull(); // below the minimum score worth a review
    expect(scoreSpike([20, 60, 35, 80, 50], 90)).toBeNull(); // wide history: within 3 σ
    expect(scoreSpike([40, 45, 42], 95)).toBeNull(); // not enough history
    expect(scoreSpike([30, 30, 30, 30], 70)).toMatchObject({ z: 99 }); // flat history, big jump
    expect(scoreSpike([60, 60, 60, 60], 70)).toBeNull();
  });

  it('flags workouts farmed at the minimum duration', () => {
    const min = 20 * 60;
    expect(farming([1210, 1250, 1300, 1220, 1260, 1240], min)).toEqual({ count: 6, nearMinimum: 6 });
    expect(farming([1210, 3600, 4000, 1220, 3900, 1240], min)).toBeNull();
    expect(farming([1210, 1220], min)).toBeNull();
  });

  it('flags friends trading wins', () => {
    expect(battleCollusion(['WIN', 'LOSS', 'WIN', 'LOSS'])).toEqual({ battles: 4 });
    expect(battleCollusion(['WIN', 'WIN', 'LOSS', 'LOSS'])).toBeNull();
    expect(battleCollusion(['WIN', 'LOSS', 'DRAW', 'WIN'])).toBeNull();
    expect(battleCollusion(['WIN', 'LOSS', 'WIN'])).toBeNull();
  });
});
