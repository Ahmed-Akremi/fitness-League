import { HttpStatus } from '@nestjs/common';

/** Stable machine codes. Clients translate them; the English `title` is only a developer hint. */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_REUSED: 'TOKEN_REUSED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  ACCOUNT_BANNED: 'ACCOUNT_BANNED',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  USERNAME_TAKEN: 'USERNAME_TAKEN',
  PHONE_TAKEN: 'PHONE_TAKEN',
  OAUTH_REGISTRATION_REQUIRED: 'OAUTH_REGISTRATION_REQUIRED',
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',
  EDIT_WINDOW_CLOSED: 'EDIT_WINDOW_CLOSED',
  TOTP_REQUIRED: 'TOTP_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  UNDER_AGE: 'UNDER_AGE',
  WORKOUT_REJECTED: 'WORKOUT_REJECTED',
  WOD_CLOSED: 'WOD_CLOSED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface FieldError {
  field: string;
  code: string;
  params?: Record<string, unknown>;
}

export class AppException extends Error {
  constructor(
    readonly status: HttpStatus,
    readonly code: ErrorCode,
    readonly title: string,
    readonly options: { detail?: string; errors?: FieldError[]; extra?: Record<string, unknown>; headers?: Record<string, string> } = {},
  ) {
    super(title);
  }

  static notFound(what = 'Resource'): AppException {
    return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, `${what} not found`);
  }

  static forbidden(detail?: string): AppException {
    return new AppException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'Forbidden', { detail });
  }

  static conflict(code: ErrorCode = ErrorCode.CONFLICT, detail?: string, extra?: Record<string, unknown>): AppException {
    return new AppException(HttpStatus.CONFLICT, code, 'Conflict', { detail, extra });
  }

  static unauthenticated(code: ErrorCode = ErrorCode.UNAUTHENTICATED, title = 'Authentication required'): AppException {
    return new AppException(HttpStatus.UNAUTHORIZED, code, title);
  }

  static validation(errors: FieldError[]): AppException {
    return new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.VALIDATION_FAILED, 'Validation failed', {
      detail: 'One or more fields are invalid.',
      errors,
    });
  }
}
