import { describe, expect, it } from 'vitest';
import { parseMovements } from './Competitions';

describe('parseMovements', () => {
  it('reads one "name = points per rep" per line, comma decimals included', () => {
    expect(parseMovements('Burpees = 1\nWall balls = 0,5\n\n')).toEqual([
      { name: 'Burpees', pointsPerRep: 1 },
      { name: 'Wall balls', pointsPerRep: 0.5 },
    ]);
  });

  it('keeps a movement without points so the API refuses it explicitly', () => {
    expect(parseMovements('Rope climb')).toEqual([{ name: 'Rope climb', pointsPerRep: 0 }]);
  });
});
