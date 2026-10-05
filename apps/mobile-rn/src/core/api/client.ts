import type { TokenStorage } from '../auth/token-storage';
import { ApiError } from './errors';

/** Session tokens returned by /auth/login, /auth/register, /auth/refresh. */
export interface Session {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
/** Loosely typed API payload, for screens that only display fields (the Flutter app used maps). */
export type Json = Record<string, any>;
/** A local file to upload (React Native FormData form). */
export interface UploadFile {
  uri: string;
  name: string;
  type: string;
}
export type Query = Record<string, string | number | boolean | null | undefined>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
}

const TIMEOUT_MS = 20_000;

/**
 * HTTP client for the Fitness League API.
 *
 * Refresh tokens are single use on the server (rotation + reuse detection), so concurrent 401s must share ONE
 * refresh call; otherwise the second refresh would look like a stolen token and log the user out everywhere.
 */
export class ApiClient {
  private access: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  language = 'fr';

  constructor(
    readonly baseUrl: string,
    readonly tokens: TokenStorage,
    private readonly onSessionExpired: () => void,
    private readonly fetchImpl: Fetch = (url, init) => fetch(url, init),
  ) {}

  get accessToken(): string | null {
    return this.access;
  }

  async setSession(s: Session): Promise<void> {
    this.access = s.accessToken;
    await this.tokens.writeRefreshToken(s.refreshToken);
  }

  async clearSession(): Promise<void> {
    this.access = null;
    await this.tokens.writeRefreshToken(null);
  }

  /** Restores a session at startup from the stored refresh token. */
  restore(): Promise<boolean> {
    return this.refresh();
  }

  get<T>(path: string, query?: Query) {
    return this.call<T>('GET', path, { query });
  }
  post<T>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.call<T>('POST', path, { body, headers });
  }
  patch<T>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.call<T>('PATCH', path, { body, headers });
  }
  put<T>(path: string, body?: unknown) {
    return this.call<T>('PUT', path, { body });
  }
  delete<T>(path: string, body?: unknown) {
    return this.call<T>('DELETE', path, { body });
  }

  /** Multipart upload (field "file" by default); PUT unless `post`. */
  upload<T>(path: string, file: UploadFile, opts: { field?: string; post?: boolean; query?: Query } = {}) {
    const form = new FormData();
    form.append(opts.field ?? 'file', file as unknown as Blob);
    return this.call<T>(opts.post ? 'POST' : 'PUT', path, { body: form, query: opts.query });
  }

  private async call<T>(method: string, path: string, opts: RequestOptions, retried = false): Promise<T> {
    try {
      return (await this.send(method, path, opts, true)) as T;
    } catch (e) {
      const retriable =
        e instanceof ApiError &&
        e.status === 401 &&
        (e.code === 'TOKEN_EXPIRED' || e.code === 'TOKEN_INVALID') &&
        !retried &&
        !path.startsWith('/auth/');
      if (!retriable) throw e;
      if (!(await this.refresh())) {
        this.onSessionExpired();
        throw e;
      }
      return this.call<T>(method, path, opts, true);
    }
  }

  private async send(method: string, path: string, opts: RequestOptions, auth: boolean): Promise<unknown> {
    const url = new URL(this.baseUrl.replace(/\/$/, '') + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v != null) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': this.language, ...opts.headers };
    if (auth && this.access) headers.Authorization = `Bearer ${this.access}`;
    const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
    if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method,
        headers,
        body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
        signal: abort.signal,
      });
    } catch (e) {
      throw new ApiError(abort.signal.aborted || (e as Error)?.name === 'AbortError' ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) throw ApiError.fromResponse(res.status, data);
    return data;
  }

  private refresh(): Promise<boolean> {
    return (this.refreshing ??= this.doRefresh().finally(() => (this.refreshing = null)));
  }

  private async doRefresh(): Promise<boolean> {
    const refresh = await this.tokens.readRefreshToken();
    if (refresh == null) return false;
    try {
      await this.setSession((await this.send('POST', '/auth/refresh', { body: { refreshToken: refresh } }, false)) as Session);
      return true;
    } catch (e) {
      // Network failure: keep the stored token so the next attempt can succeed.
      if (e instanceof ApiError && e.isConnectivity) return false;
      await this.clearSession();
      return false;
    }
  }
}
