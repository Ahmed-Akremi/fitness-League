/** Problem+json error from the API (docs §4.3). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(code);
  }

  get fieldErrors(): { field: string; code: string; params?: Record<string, unknown> }[] {
    return (this.body.errors as { field: string; code: string }[] | undefined) ?? [];
  }
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

const REFRESH_KEY = 'fl_admin_refresh';

/**
 * Admin API client. Access token in memory only; refresh token in sessionStorage (dies with the tab).
 * Refresh tokens are single use server-side, so concurrent 401s share one refresh.
 */
export class AdminApi {
  private access: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  onSessionLost: () => void = () => {};

  constructor(
    private readonly base = import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = sessionStorage,
  ) {}

  get signedIn(): boolean {
    return this.access !== null;
  }

  setSession(s: Session): void {
    this.access = s.accessToken;
    this.storage.setItem(REFRESH_KEY, s.refreshToken);
  }

  clear(): void {
    this.access = null;
    this.storage.removeItem(REFRESH_KEY);
  }

  /** Restores a session after a page reload. */
  restore(): Promise<boolean> {
    return this.refresh();
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }
  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }
  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }
  delete<T = void>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  async logout(): Promise<void> {
    const refreshToken = this.storage.getItem(REFRESH_KEY);
    try {
      if (refreshToken && this.access) await this.post('/admin/auth/logout', { refreshToken });
    } finally {
      this.clear();
    }
  }

  private async request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
    const res = await this.fetchFn(this.base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(this.access && { authorization: `Bearer ${this.access}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data as T;
    const code = (data as { code?: string }).code ?? 'INTERNAL';
    if (res.status === 401 && !retried && (code === 'TOKEN_EXPIRED' || code === 'TOKEN_INVALID') && !path.startsWith('/admin/auth/')) {
      if (await this.refresh()) return this.request<T>(method, path, body, true);
      this.onSessionLost();
    }
    throw new ApiError(res.status, code, data as Record<string, unknown>);
  }

  private refresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    const refreshToken = this.storage.getItem(REFRESH_KEY);
    if (!refreshToken) return false;
    const res = await this.fetchFn(this.base + '/admin/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
    if (!res.ok) {
      this.clear();
      return false;
    }
    this.setSession((await res.json()) as Session);
    return true;
  }
}

/** Human-readable message for an error code (the panel is staff-only, French by default). */
export function errorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Erreur réseau : vérifiez la connexion à l’API.';
  const messages: Record<string, string> = {
    INVALID_CREDENTIALS: 'Email, mot de passe ou code incorrect.',
    TOTP_REQUIRED: 'Code de l’application d’authentification requis.',
    ACCOUNT_LOCKED: 'Compte temporairement verrouillé (trop de tentatives).',
    FORBIDDEN: 'Action non autorisée pour votre rôle.',
    VALIDATION_FAILED: 'Données invalides.',
    CONFLICT: String(e.body.detail ?? 'Conflit.'),
    RATE_LIMITED: 'Trop de requêtes, réessayez dans un instant.',
    NOT_FOUND: 'Introuvable.',
  };
  return messages[e.code] ?? `Erreur (${e.code}).`;
}

export const api = new AdminApi();
