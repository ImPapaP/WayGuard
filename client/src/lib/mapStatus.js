// Remembers, for this browser session, which map providers failed to load
// (bad key, blocked network, no WebGL...), so every map can fall back to
// OpenStreetMap raster tiles instead of showing a broken map.
import { useSyncExternalStore } from 'react';

const failed = new Set();
const listeners = new Set();

export function markMapFailed(provider, reason) {
  if (failed.has(provider)) return;
  failed.add(provider);
  console.warn(`[maps] ${provider} map unavailable (${reason}); using OpenStreetMap tiles instead.`);
  listeners.forEach((fn) => fn());
}

export function isMapFailed(provider) {
  return failed.has(provider);
}

export function useMapFailed(provider) {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => failed.has(provider),
  );
}
