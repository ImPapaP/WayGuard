// Central configuration. Values come from environment variables, optionally
// loaded from the `.env` file in the project root (see .env.example).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '..', '..');
export const SERVER_DIR = path.resolve(here, '..');

const envFile = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envFile)) {
  // Built into Node.js >= 20.12; existing environment variables win.
  process.loadEnvFile(envFile);
}

const env = process.env;

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const nodeEnv = env.NODE_ENV || 'development';
const httpsKey = env.HTTPS_KEY_FILE || '';
const httpsCert = env.HTTPS_CERT_FILE || '';
const httpsEnabled = Boolean(httpsKey && httpsCert);

// Map provider:
//   vector  (default) Wayguard's own Waze-style road map drawn with MapLibre
//           from free OpenStreetMap vector tiles (OpenFreeMap, no key)
//   google  Google Maps; default when GOOGLE_MAPS_API_KEY is set
//   osm     classic OpenStreetMap raster tiles through Leaflet
// Whatever is chosen, maps fall back to `osm` if they cannot load.
const googleMapsKey = (env.GOOGLE_MAPS_API_KEY || '').trim();
const wantedProvider = (env.MAP_PROVIDER || (googleMapsKey ? 'google' : 'vector')).trim().toLowerCase();
function pickProvider() {
  if (wantedProvider === 'google') return googleMapsKey ? 'google' : 'vector';
  return ['vector', 'osm'].includes(wantedProvider) ? wantedProvider : 'vector';
}
const googleGeocodingKey = (env.GOOGLE_GEOCODING_API_KEY || '').trim();
const geocoderProvider = (env.GEOCODER_PROVIDER || 'nominatim').trim().toLowerCase();

function resolveFromRoot(p) {
  return path.isAbsolute(p) ? p : path.resolve(ROOT_DIR, p);
}

export const config = {
  env: nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  host: env.HOST || '0.0.0.0',
  port: int(env.PORT, 3000),
  // Render sets RENDER_EXTERNAL_URL automatically.
  publicBaseUrl: (env.PUBLIC_BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${int(env.PORT, 3000)}`).replace(/\/$/, ''),
  // Used to group statistics by local calendar month
  timezone: env.APP_TIMEZONE || 'Asia/Manila',
  databaseUrl: nodeEnv === 'test' ? env.TEST_DATABASE_URL || env.DATABASE_URL : env.DATABASE_URL,
  sessionTtlDays: int(env.SESSION_TTL_DAYS, 7),
  cookieSecure:
    env.COOKIE_SECURE === undefined || env.COOKIE_SECURE === '' || env.COOKIE_SECURE === 'auto'
      ? nodeEnv === 'production' || httpsEnabled
      : bool(env.COOKIE_SECURE, false),
  trustProxy: bool(env.TRUST_PROXY, false),
  uploadDir: resolveFromRoot(env.UPLOAD_DIR || './server/storage/uploads'),
  // 'disk' (default) or 'database' — store photos in PostgreSQL when the
  // server's disk is not permanent (free cloud hosting).
  photoStorage: (env.PHOTO_STORAGE || 'disk').trim().toLowerCase() === 'database' ? 'database' : 'disk',
  // One-time creation of the first administrator from the environment, for
  // hosting without a command line. Ignored once any administrator exists.
  initialAdmin: {
    email: (env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase(),
    name: (env.INITIAL_ADMIN_NAME || 'LGU Administrator').trim(),
    password: env.INITIAL_ADMIN_PASSWORD || '',
  },
  maxPhotoBytes: int(env.MAX_PHOTO_MB, 8) * 1024 * 1024,
  clientDist: path.join(ROOT_DIR, 'client', 'dist'),
  tiles: {
    url: env.TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      env.TILE_ATTRIBUTION ||
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: int(env.TILE_MAX_ZOOM, 19),
  },
  maps: {
    requested: wantedProvider,
    provider: pickProvider(),
    vector: {
      // TileJSON of an OpenMapTiles-schema vector tile service
      tilejson: (env.MAP_VECTOR_TILEJSON_URL || 'https://tiles.openfreemap.org/planet').trim(),
      glyphs: (env.MAP_GLYPHS_URL || 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf').trim(),
      attribution:
        env.MAP_VECTOR_ATTRIBUTION ||
        '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    },
    // Browser key for the Maps JavaScript API. It is sent to browsers by
    // design, so it must be restricted to your site in Google Cloud Console
    // (HTTP referrers + "Maps JavaScript API" only). See docs/08-deployment.md.
    googleApiKey: googleMapsKey,
    googleMapId: (env.GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID').trim(),
  },
  geocoder: {
    enabled: bool(env.GEOCODER_ENABLED, true),
    provider: geocoderProvider === 'google' ? 'google' : 'nominatim',
    // Server-side key for the Geocoding API; never sent to browsers.
    googleApiKey: googleGeocodingKey,
    googleUrl: (env.GOOGLE_GEOCODING_URL || 'https://maps.googleapis.com/maps/api/geocode/json').trim(),
    region: (env.GEOCODER_COUNTRY_CODES || 'ph').split(',')[0].trim(),
    url: (env.GEOCODER_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, ''),
    email: env.GEOCODER_EMAIL || '',
    countryCodes: env.GEOCODER_COUNTRY_CODES || 'ph',
    minIntervalMs: int(env.GEOCODER_MIN_INTERVAL_MS, 1100),
  },
  smtp: {
    host: env.SMTP_HOST || '',
    port: int(env.SMTP_PORT, 587),
    secure: bool(env.SMTP_SECURE, false),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'Wayguard <no-reply@example.com>',
  },
  https: { enabled: httpsEnabled, keyFile: httpsKey, certFile: httpsCert },
};

// Settings that are not fatal but would silently change behaviour.
export function configWarnings() {
  const out = [];
  if (config.maps.requested === 'google' && !config.maps.googleApiKey) {
    out.push('MAP_PROVIDER=google but GOOGLE_MAPS_API_KEY is empty; using the Wayguard road map instead.');
  }
  if (config.maps.provider === 'google' && config.maps.googleMapId === 'DEMO_MAP_ID' && config.isProduction) {
    out.push('GOOGLE_MAPS_MAP_ID is not set; using Google\'s DEMO_MAP_ID. Create a Map ID for production.');
  }
  if (config.geocoder.provider === 'google' && config.maps.provider !== 'google') {
    out.push('Google Geocoding results may only be shown with a Google map (Google Maps Platform terms); set GOOGLE_MAPS_API_KEY or use GEOCODER_PROVIDER=nominatim.');
  }
  if (config.geocoder.provider === 'google' && !config.geocoder.googleApiKey) {
    out.push('GEOCODER_PROVIDER=google but GOOGLE_GEOCODING_API_KEY is empty; address search will be unavailable.');
  }
  return out;
}

export function assertConfig() {
  if (!config.databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and set your PostgreSQL connection string.',
    );
  }
}
