import { ValidationError } from '@nestjs/common';
import { flattenValidationErrors } from './validation';

describe('flattenValidationErrors', () => {
  it('builds nested paths with array indexes', () => {
    const set = ({ property: 'reps', constraints: { max: 'too big' }, children: [] } as ValidationError);
    const setIndex = ({ property: '2', children: [set] } as ValidationError);
    const sets = ({ property: 'sets', children: [setIndex] } as ValidationError);
    const exIndex = ({ property: '0', children: [sets] } as ValidationError);
    const exercises = ({ property: 'exercises', children: [exIndex] } as ValidationError);

    expect(flattenValidationErrors([exercises])).toEqual([{ field: 'exercises[0].sets[2].reps', code: 'MAX' }]);
  });

  it('maps unknown fields to UNKNOWN_FIELD', () => {
    const err = ({ property: 'xp', constraints: { whitelistValidation: 'x' }, children: [] } as ValidationError);
    expect(flattenValidationErrors([err])).toEqual([{ field: 'xp', code: 'UNKNOWN_FIELD' }]);
  });
});
