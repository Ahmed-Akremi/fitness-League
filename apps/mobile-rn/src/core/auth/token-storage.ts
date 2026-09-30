import * as SecureStore from 'expo-secure-store';

/** Only the refresh token is persisted; the access token lives in memory (ApiClient). */
export interface TokenStorage {
  readRefreshToken(): Promise<string | null>;
  writeRefreshToken(token: string | null): Promise<void>;
}

const KEY = 'refreshToken';

export class SecureTokenStorage implements TokenStorage {
  readRefreshToken() {
    return SecureStore.getItemAsync(KEY);
  }

  async writeRefreshToken(token: string | null) {
    if (token == null) await SecureStore.deleteItemAsync(KEY);
    else await SecureStore.setItemAsync(KEY, token);
  }
}

export class MemoryTokenStorage implements TokenStorage {
  constructor(private token: string | null = null) {}

  async readRefreshToken() {
    return this.token;
  }

  async writeRefreshToken(token: string | null) {
    this.token = token;
  }
}
