// Loads the Google Maps JavaScript API once, with the browser key from
// /api/public/config, and tracks whether it failed (network error, blocked
// script, or an invalid / unrestricted-elsewhere key reported through
// window.gm_authFailure). After a failure every map falls back to
// OpenStreetMap for the rest of the session.
import { isMapFailed, markMapFailed, useMapFailed } from './mapStatus.js';

let loading = null;
const setFailed = (reason) => markMapFailed('google', reason);
export const useGoogleMapsFailed = () => useMapFailed('google');

export function loadGoogleMaps(apiKey) {
  if (isMapFailed('google')) return Promise.reject(new Error('Google Maps unavailable'));
  if (window.google?.maps?.marker?.AdvancedMarkerElement) return Promise.resolve(window.google.maps);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const callback = '__wayguardGoogleMapsReady';
    const timer = setTimeout(() => {
      setFailed('timed out');
      reject(new Error('Google Maps timed out'));
    }, 20_000);
    window[callback] = () => {
      clearTimeout(timer);
      delete window[callback];
      if (window.google?.maps?.marker?.AdvancedMarkerElement) resolve(window.google.maps);
      else {
        setFailed('marker library missing');
        reject(new Error('Google Maps marker library missing'));
      }
    };
    // Google calls this when the key is invalid, billing is off or this
    // site's address is not allowed for the key.
    window.gm_authFailure = () => setFailed('the API key was rejected');
    const params = new URLSearchParams({
      key: apiKey,
      v: 'weekly',
      loading: 'async',
      libraries: 'marker',
      callback,
      language: 'en',
      region: 'PH',
    });
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      setFailed('script could not be loaded');
      reject(new Error('Google Maps script failed to load'));
    };
    document.head.appendChild(script);
  });
  return loading;
}
