/**
 * Typed view of the API's problem+json errors (docs §4.3). The UI maps `code` to translated text;
 * stack traces and raw server messages are never shown.
 */
export type ApiErrorKind = 'network' | 'timeout' | 'unauthenticated' | 'client' | 'server';

export interface FieldError {
  field: string;
  code: string;
}

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly status?: number,
    readonly code?: string,
    readonly fieldErrors: FieldError[] = [],
    readonly extra: Record<string, unknown> = {},
  ) {
    super(`ApiError(${kind}, ${status}, ${code})`);
    this.name = 'ApiError';
  }

  static fromResponse(status: number, body: unknown): ApiError {
    const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const errors = Array.isArray(b.errors)
      ? b.errors.filter((e) => e && typeof e === 'object').map((e) => ({ field: String(e.field), code: String(e.code) }))
      : [];
    const kind: ApiErrorKind = status === 401 ? 'unauthenticated' : status >= 500 ? 'server' : 'client';
    return new ApiError(kind, status, typeof b.code === 'string' ? b.code : undefined, errors, b);
  }

  fieldCode(field: string): string | undefined {
    return this.fieldErrors.find((e) => e.field === field)?.code;
  }

  /** The request never got an answer: worth queueing / retrying later. */
  get isConnectivity(): boolean {
    return this.kind === 'network' || this.kind === 'timeout';
  }
}
