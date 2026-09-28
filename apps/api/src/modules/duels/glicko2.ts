/**
 * Glicko-2 (Glickman 2012, "Example of the Glicko-2 system"), rating period = one week (docs §6.1).
 * Pure functions: the service loads/stores ratings, this file only does the maths.
 */

export interface Rating {
  rating: number;
  rd: number;
  volatility: number;
}

export interface GameResult {
  opponent: Rating;
  /** 1 win, 0.5 draw, 0 loss. */
  score: number;
}

export const NEW_PLAYER: Rating = { rating: 1500, rd: 350, volatility: 0.06 };

const SCALE = 173.7178;
const EPSILON = 0.000001;

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expected = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/** Probability that `a` beats `b` (docs §6.1 worked example: 1600 vs 1500/RD 200 → 0.619). */
export function expectedScore(a: Rating, b: Rating): number {
  return expected((a.rating - 1500) / SCALE, (b.rating - 1500) / SCALE, b.rd / SCALE);
}

/** RD grows while a player does not play (step 6 with no games), capped at the new-player RD. */
export function decay(r: Rating, periods = 1): Rating {
  let phi = r.rd / SCALE;
  for (let i = 0; i < periods; i++) phi = Math.sqrt(phi * phi + r.volatility * r.volatility);
  return { ...r, rd: Math.min(phi * SCALE, NEW_PLAYER.rd) };
}

/** One rating period for `player` given the games played in it. No games → `decay`. */
export function ratePeriod(player: Rating, games: GameResult[], tau = 0.5): Rating {
  if (games.length === 0) return decay(player);
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.volatility;

  const opp = games.map((gm) => {
    const muJ = (gm.opponent.rating - 1500) / SCALE;
    const phiJ = gm.opponent.rd / SCALE;
    return { gJ: g(phiJ), e: expected(mu, muJ, phiJ), s: gm.score };
  });
  const v = 1 / opp.reduce((acc, o) => acc + o.gJ * o.gJ * o.e * (1 - o.e), 0);
  const delta = v * opp.reduce((acc, o) => acc + o.gJ * (o.s - o.e), 0);

  // Step 5: new volatility (Illinois algorithm).
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (tau * tau);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  const newSigma = Math.exp(A / 2);

  // Steps 6–8.
  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * opp.reduce((acc, o) => acc + o.gJ * (o.s - o.e), 0);
  return { rating: newMu * SCALE + 1500, rd: newPhi * SCALE, volatility: newSigma };
}
