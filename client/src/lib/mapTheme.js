// Day / night look of the maps, like a driving app. Night is the default;
// the choice is remembered in this browser only (a convenience, so storage
// errors are ignored).
import { useSyncExternalStore } from 'react';

const KEY = 'wg-map-theme';
const listeners = new Set();

function read() {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'day' || v === 'night' ? v : 'night';
  } catch {
    return 'night';
  }
}

let current = typeof window === 'undefined' ? 'night' : read();

export function setMapTheme(theme) {
  current = theme === 'day' ? 'day' : 'night';
  try {
    window.localStorage.setItem(KEY, current);
  } catch {
    // private mode or blocked storage: keep it for this page only
  }
  listeners.forEach((fn) => fn());
}

export function useMapTheme() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}
