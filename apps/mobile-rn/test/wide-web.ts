import { useSyncExternalStore } from 'react';

/**
 * Screen tests of the organizer space on a computer. A test file mocks `useWideWeb` with `useWide`:
 *   jest.mock('../../src/features/competitions/organizer/web', () => ({ ...jest.requireActual('../../src/features/competitions/organizer/web'), useWideWeb: () => require('../wide-web').useWide() }));
 * `setWide(false)` then re-renders every screen that asked, like a window crossing 1024 px.
 */
let wide = true;
const listeners = new Set<() => void>();

export function setWide(v: boolean) {
  wide = v;
  listeners.forEach((l) => l());
}

export function useWide(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => wide,
  );
}
