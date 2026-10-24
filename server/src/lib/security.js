// Password hashing, tokens, rate limiting and HTTP security headers.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './http.js';
import { config } from '../config.js';

const scrypt = promisify(crypto.scrypt);

// scrypt parameters follow the OWASP Password Storage Cheat Sheet
// (N=2^15, r=8, p=3). Tests use a cheaper setting to keep the suite fast;
// the parameters are stored inside each hash, so verification always works.
const SCRYPT = config.isTest ? { N: 2 ** 12, r: 8, p: 1 } : { N: 2 ** 15, r: 8, p: 3 };
const KEYLEN = 64;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const { N, r, p } = SCRYPT;
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r, p, maxmem: 256 * N * r });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [algo, n, r, p, saltB64, keyB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const N = Number(n);
    const R = Number(r);
    const P = Number(p);
    const expected = Buffer.from(keyB64, 'base64');
    const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
      N,
      r: R,
      p: P,
      maxmem: 256 * N * R,
    });
    return key.length === expected.length && crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// A real hash of a random value, used so that logins for unknown e-mail
// addresses take the same time as logins with a wrong password.
let dummyHashPromise = null;
export function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHashPromise;
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Simple fixed-window rate limiter kept in memory. Suitable for a single
// server process; use a shared store (e.g. Redis) if you run several.
export class RateLimiter {
  constructor({ windowMs, max, name = 'requests' }) {
    this.windowMs = windowMs;
    this.max = max;
    this.name = name;
    this.hits = new Map();
    const timer = setInterval(() => this.sweep(), Math.min(windowMs, 60_000));
    timer.unref();
  }

  sweep() {
    const now = Date.now();
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }

  hit(key) {
    const now = Date.now();
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    return { allowed: entry.count <= this.max, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  reset(key) {
    this.hits.delete(key);
  }

  // Throws HTTP 429 when the key is over its limit.
  consume(key, ctx) {
    if (config.isTest && process.env.WAYGUARD_DISABLE_RATE_LIMIT === '1') return;
    const { allowed, retryAfter } = this.hit(key);
    if (!allowed) {
      if (ctx) ctx.setHeader('Retry-After', String(retryAfter));
      throw new HttpError(
        429,
        `Too many ${this.name}. Please wait ${retryAfter} seconds and try again.`,
        { retryAfter },
        'rate_limited',
      );
    }
  }
}

function tileOrigins(tileUrl) {
  try {
    const u = new URL(tileUrl.replace(/\{[a-z]\}/gi, (m) => (m === '{s}' ? 'a' : '0')));
    if (tileUrl.includes('{s}')) {
      const parts = u.host.split('.');
      parts[0] = '*';
      return [`${u.protocol}//${parts.join('.')}`];
    }
    return [`${u.protocol}//${u.host}`];
  } catch {
    return [];
  }
}

// Sources the Google Maps JavaScript API needs, from Google's CSP guide
// (https://developers.google.com/maps/documentation/javascript/content-security-policy).
const GOOGLE_MAPS_CSP = {
  script: ['https://*.googleapis.com', 'https://*.gstatic.com', '*.google.com', 'https://*.ggpht.com', '*.googleusercontent.com', 'blob:'],
  img: ['https://*.googleapis.com', 'https://*.gstatic.com', '*.google.com', '*.googleusercontent.com'],
  connect: ['https://*.googleapis.com', '*.google.com', 'https://*.gstatic.com', 'data:', 'blob:'],
  font: ['https://fonts.gstatic.com'],
  style: ['https://fonts.googleapis.com'],
  frame: ['*.google.com'],
  worker: ['blob:'],
};

function vectorOrigins() {
  if (config.maps.provider !== 'vector') return [];
  const out = new Set();
  for (const u of [config.maps.vector.tilejson, config.maps.vector.glyphs]) {
    try {
      const url = new URL(u.replace(/\{[a-z]+\}/gi, '0'));
      out.add(`${url.protocol}//${url.host}`);
    } catch {
      // ignore malformed URLs; the map then falls back to raster tiles
    }
  }
  return [...out];
}

export function buildCsp({ google = config.maps.provider === 'google' } = {}) {
  // OpenStreetMap tiles stay allowed: they are the fallback when Google
  // Maps is not configured or fails to load.
  const tiles = tileOrigins(config.tiles.url).join(' ');
  const g = (k) => (google ? ` ${GOOGLE_MAPS_CSP[k].join(' ')}` : '');
  // Vector map: TileJSON, tiles and label glyphs are fetched by MapLibre.
  const vector = vectorOrigins();
  const v = vector.length ? ` ${vector.join(' ')}` : '';
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self'${g('script')}`,
    // Google Maps injects <style> elements; Leaflet only uses style attributes.
    google ? `style-src 'self' 'unsafe-inline'${g('style')}` : "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' data: blob: ${tiles}${v}${g('img')}`.replace(/\s+/g, ' ').trim(),
    `font-src 'self'${g('font')}`,
    `connect-src 'self'${v}${g('connect')}`,
    ...(google ? [`frame-src${g('frame')}`] : []),
    `worker-src 'self'${g('worker')}`,
    "manifest-src 'self'",
  ].join('; ');
}

export function securityHeaders() {
  const csp = buildCsp();
  return async function setSecurityHeaders(ctx, next) {
    const res = ctx.res;
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    // The OSM tile policy requires a valid Referer; this sends only the origin.
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (config.cookieSecure) {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    await next();
  };
}

// CSRF protection for the JSON API. State-changing requests must carry the
// custom `X-Wayguard-CSRF` header, which browsers will not let another site
// add without a CORS pre-flight (and CORS is not enabled). The Origin header,
// when present, must match the Host header as a second check.
export function csrfProtection() {
  return async function checkCsrf(ctx, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(ctx.method)) return next();
    if (ctx.req.headers['x-wayguard-csrf'] !== '1') {
      throw new HttpError(403, 'Request blocked by CSRF protection. Reload the page and try again.', undefined, 'csrf');
    }
    const origin = ctx.req.headers.origin;
    if (origin) {
      let originHost;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      const host = ctx.req.headers['x-forwarded-host'] && config.trustProxy
        ? String(ctx.req.headers['x-forwarded-host'])
        : ctx.req.headers.host;
      if (!originHost || originHost !== host) {
        throw new HttpError(403, 'Cross-site request blocked.', undefined, 'csrf');
      }
    }
    return next();
  };
}
