import { create } from 'zustand';

export type AuthStatus = 'unknown' | 'signedOut' | 'signedIn';

/** Who is signed in. `unknown` while the stored refresh token is being tried at startup. */
export const useSession = create<{ status: AuthStatus }>(() => ({ status: 'unknown' }));

export const setAuthStatus = (status: AuthStatus) => useSession.setState({ status });
