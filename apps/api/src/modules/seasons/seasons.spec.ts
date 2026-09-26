import { divisionFloor, softReset } from './seasons.service';

const config = {
  division_thresholds: { BRONZE: 0, SILVER: 400, GOLD: 900, PLATINUM: 1400, DIAMOND: 2000, ELITE: 2600 },
  season_soft_reset_ratio: 0.5,
};

describe('season soft reset (docs §5.10.4)', () => {
  it('compresses LP toward the division floor, never below it', () => {
    expect(softReset(1240, config)).toBe(1070); // Gold: 900 + 340 × 0.5
    expect(softReset(900, config)).toBe(900);
    expect(softReset(86, config)).toBe(43);
    expect(softReset(0, config)).toBe(0);
    expect(divisionFloor(3000, config)).toBe(2600);
  });
});
