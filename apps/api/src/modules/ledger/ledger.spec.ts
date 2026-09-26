import { divisionFor } from './ledger.service';

describe('divisionFor', () => {
  const t = { BRONZE: 0, SILVER: 400, GOLD: 900, PLATINUM: 1400, DIAMOND: 2000, ELITE: 2600 };
  it('maps LP to the live division', () => {
    expect([0, 399, 400, 1240, 2599, 5000].map((lp) => divisionFor(lp, t))).toEqual(['BRONZE', 'BRONZE', 'SILVER', 'GOLD', 'DIAMOND', 'ELITE']);
  });
});
