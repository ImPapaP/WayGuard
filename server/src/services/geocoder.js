// Address search and reverse geocoding, through a Nominatim-compatible API
// (default) or the Google Geocoding API (GEOCODER_PROVIDER=google).
// Requests are made by the server (not the browser) so usage policies can
// be followed centrally and the Google key stays secret: an identifying
// User-Agent, spaced requests and cached results (30 days, which is also the
// longest Google allows for coordinates). Users' personal data is never sent.
import { sql } from '../db/index.js';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';
import { sha256 } from '../lib/security.js';

const CACHE_DAYS = 30;
let lastRequestAt = 0;
let queue = Promise.resolve();

function unavailable(message = 'Address search is unavailable right now. Pin the location on the map instead.') {
  return new HttpError(503, message, undefined, 'geocoder_unavailable');
}

// Serialises outgoing requests so they are spaced by minIntervalMs.
function throttled(fn) {
  const run = queue.then(async () => {
    const wait = lastRequestAt + config.geocoder.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

async function cached(key, fetcher) {
  const hashed = sha256(key);
  const [hit] = await sql`
    SELECT response FROM geocode_cache
    WHERE query_key = ${hashed} AND created_at > now() - make_interval(days => ${CACHE_DAYS})`;
  if (hit) return hit.response;
  const response = await fetcher();
  await sql`
    INSERT INTO geocode_cache (query_key, response) VALUES (${hashed}, ${sql.json(response)})
    ON CONFLICT (query_key) DO UPDATE SET response = EXCLUDED.response, created_at = now()`;
  return response;
}

async function callNominatim(path, params) {
  if (!config.geocoder.enabled) throw unavailable('Address search is turned off. Pin the location on the map instead.');
  const url = new URL(config.geocoder.url + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  if (config.geocoder.email) url.searchParams.set('email', config.geocoder.email);
  return throttled(async () => {
    let res;
    try {
      res = await fetch(url, {
        headers: {
          'User-Agent': `Wayguard/1.0 (LGU pothole reporting; ${config.geocoder.email || 'contact not configured'})`,
          'Accept-Language': 'en',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw unavailable();
    }
    if (res.status === 429) throw unavailable('Address search is busy. Wait a moment or pin the location on the map.');
    if (!res.ok) throw unavailable();
    try {
      return await res.json();
    } catch {
      throw unavailable();
    }
  });
}

// ---- Google Geocoding API
function googleUnavailable(status, message) {
  if (status === 'OVER_QUERY_LIMIT' || status === 'OVER_DAILY_LIMIT') {
    return unavailable('Address search is busy. Wait a moment or pin the location on the map.');
  }
  if (status === 'REQUEST_DENIED') {
    // Usually a missing/invalid key or the Geocoding API not enabled; keep
    // the detail in the server log, not in the response.
    console.error(`[geocoder] Google Geocoding request denied: ${message || 'no details'}`);
  }
  return unavailable();
}

async function callGoogle(params) {
  if (!config.geocoder.enabled) throw unavailable('Address search is turned off. Pin the location on the map instead.');
  if (!config.geocoder.googleApiKey) throw unavailable();
  const url = new URL(config.geocoder.googleUrl);
  for (const [k, v] of Object.entries({ ...params, language: 'en', key: config.geocoder.googleApiKey })) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  } catch {
    throw unavailable();
  }
  let body;
  try {
    body = await res.json();
  } catch {
    throw unavailable();
  }
  if (!res.ok || !['OK', 'ZERO_RESULTS'].includes(body?.status)) throw googleUnavailable(body?.status, body?.error_message);
  return body.results || [];
}

function component(result, ...types) {
  for (const t of types) {
    const c = (result.address_components || []).find((x) => x.types?.includes(t));
    if (c) return c.long_name;
  }
  return null;
}

function fromGoogle(r) {
  return {
    label: r.formatted_address,
    latitude: Number(r.geometry?.location?.lat),
    longitude: Number(r.geometry?.location?.lng),
    road_name: component(r, 'route'),
    barangay: component(r, 'sublocality_level_1', 'sublocality', 'neighborhood', 'administrative_area_level_5'),
    city: component(r, 'locality', 'administrative_area_level_3'),
  };
}

// Nominatim viewbox "minLng,minLat,maxLng,maxLat" -> Google bounds "s,w|n,e".
function googleBounds(viewbox) {
  const v = String(viewbox || '').split(',').map(Number);
  if (v.length !== 4 || v.some((n) => !Number.isFinite(n))) return undefined;
  return `${Math.min(v[1], v[3])},${Math.min(v[0], v[2])}|${Math.max(v[1], v[3])},${Math.max(v[0], v[2])}`;
}

const useGoogle = () => config.geocoder.provider === 'google';

// ---- Nominatim address parts
function pickRoad(addr = {}) {
  return addr.road || addr.pedestrian || addr.residential || addr.footway || addr.path || null;
}

function pickBarangay(addr = {}) {
  return addr.quarter || addr.neighbourhood || addr.suburb || addr.village || addr.hamlet || null;
}

function pickCity(addr = {}) {
  return addr.city || addr.town || addr.municipality || addr.county || null;
}

export async function searchAddress(q, { viewbox } = {}) {
  const query = q.trim().replace(/\s+/g, ' ').slice(0, 200);
  if (useGoogle()) {
    const region = config.geocoder.region;
    const results = await cached(`g-search|${region}|${viewbox || ''}|${query.toLowerCase()}`, () =>
      callGoogle({ address: query, region, components: region ? `country:${region.toUpperCase()}` : undefined, bounds: googleBounds(viewbox) }),
    );
    return results.slice(0, 6).map(fromGoogle);
  }
  const key = `search|${config.geocoder.countryCodes}|${viewbox || ''}|${query.toLowerCase()}`;
  const raw = await cached(key, () =>
    callNominatim('/search', {
      q: query,
      format: 'jsonv2',
      addressdetails: 1,
      limit: 6,
      countrycodes: config.geocoder.countryCodes,
      viewbox,
    }),
  );
  return (Array.isArray(raw) ? raw : []).map((r) => ({
    label: r.display_name,
    latitude: Number(r.lat),
    longitude: Number(r.lon),
    road_name: pickRoad(r.address),
    barangay: pickBarangay(r.address),
    city: pickCity(r.address),
  }));
}

export async function reverseGeocode(lat, lng) {
  // Round to ~11 m so nearby taps share a cache entry.
  const rlat = Math.round(lat * 10000) / 10000;
  const rlng = Math.round(lng * 10000) / 10000;
  if (useGoogle()) {
    const results = await cached(`g-reverse|${rlat}|${rlng}`, () => callGoogle({ latlng: `${rlat},${rlng}` }));
    if (!results.length) return null;
    const { label, road_name, barangay, city } = fromGoogle(results[0]);
    return { label, road_name, barangay, city };
  }
  const raw = await cached(`reverse|${rlat}|${rlng}`, () =>
    callNominatim('/reverse', { lat: rlat, lon: rlng, format: 'jsonv2', addressdetails: 1, zoom: 18 }),
  );
  if (!raw || raw.error) return null;
  return {
    label: raw.display_name,
    road_name: pickRoad(raw.address),
    barangay: pickBarangay(raw.address),
    city: pickCity(raw.address),
  };
}
