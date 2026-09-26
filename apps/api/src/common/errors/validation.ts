import { ValidationError, ValidationPipe } from '@nestjs/common';
import { AppException, FieldError } from './app-exception';

/** Flattens nested class-validator errors into `exercises[0].sets[2].reps`-style paths. */
export function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((e) => {
    const isIndex = /^\d+$/.test(e.property);
    const path = parent ? (isIndex ? `${parent}[${e.property}]` : `${parent}.${e.property}`) : e.property;
    const own: FieldError[] = Object.keys(e.constraints ?? {}).map((constraint) => ({
      field: path,
      code: constraint === 'whitelistValidation' ? 'UNKNOWN_FIELD' : constraint.toUpperCase(),
    }));
    return [...own, ...flattenValidationErrors(e.children ?? [], path)];
  });
}

/**
 * Global pipe. `forbidNonWhitelisted` makes any field not declared in a DTO a 422 — this is how
 * client-sent points (`xp`, `lp`, `score`…) are refused (docs §5.1).
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => AppException.validation(flattenValidationErrors(errors)),
  });
}
