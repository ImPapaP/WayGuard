// Minimal web framework built on Node's `http` module.
// It provides what the Wayguard API needs and nothing more:
//   * a router with `:param` path segments and per-route middleware
//   * Koa-style `async (ctx, next)` middleware
//   * size-limited JSON and multipart body parsing
//   * consistent JSON error responses
// Keeping this small and dependency-free makes the security-relevant parts
// (body limits, error output) easy to read and audit.
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message, details = undefined, code = undefined) {
    super(message);
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details, 'bad_request');
export const unauthorized = (msg = 'Please sign in to continue.') => new HttpError(401, msg, undefined, 'unauthorized');
export const forbidden = (msg = 'You do not have permission to do that.') => new HttpError(403, msg, undefined, 'forbidden');
export const notFound = (msg = 'Not found.') => new HttpError(404, msg, undefined, 'not_found');
export const conflict = (msg, details) => new HttpError(409, msg, details, 'conflict');

function compilePath(pattern) {
  const keys = [];
  const source = pattern
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${source}/?$`), keys };
}

export class Router {
  constructor(prefix = '') {
    this.prefix = prefix.replace(/\/$/, '');
    this.routes = [];
  }

  add(method, pattern, ...handlers) {
    const full = this.prefix + (pattern === '/' ? '' : pattern) || '/';
    this.routes.push({ method, pattern: full, ...compilePath(full), handlers });
    return this;
  }

  get(p, ...h) { return this.add('GET', p, ...h); }
  post(p, ...h) { return this.add('POST', p, ...h); }
  put(p, ...h) { return this.add('PUT', p, ...h); }
  patch(p, ...h) { return this.add('PATCH', p, ...h); }
  delete(p, ...h) { return this.add('DELETE', p, ...h); }

  // Merge another router's routes (used to assemble route modules).
  include(router) {
    this.routes.push(...router.routes);
    return this;
  }

  match(method, path) {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.regex.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method && !(method === 'HEAD' && route.method === 'GET')) continue;
      const params = {};
      route.keys.forEach((key, i) => {
        try {
          params[key] = decodeURIComponent(m[i + 1]);
        } catch {
          params[key] = m[i + 1];
        }
      });
      return { route, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

export function compose(middleware) {
  return function run(ctx, finalNext) {
    let index = -1;
    function dispatch(i) {
      if (i <= index) return Promise.reject(new Error('next() called multiple times'));
      index = i;
      const fn = i === middleware.length ? finalNext : middleware[i];
      if (!fn) return Promise.resolve();
      try {
        return Promise.resolve(fn(ctx, () => dispatch(i + 1)));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return dispatch(0);
  };
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key || key in out) continue;
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

export function serializeCookie(name, value, opts = {}) {
  let str = `${name}=${encodeURIComponent(value)}`;
  if (opts.maxAge !== undefined) str += `; Max-Age=${Math.floor(opts.maxAge)}`;
  str += `; Path=${opts.path || '/'}`;
  if (opts.httpOnly) str += '; HttpOnly';
  if (opts.secure) str += '; Secure';
  if (opts.sameSite) str += `; SameSite=${opts.sameSite}`;
  return str;
}

export function createContext(req, res, { trustProxy = false } = {}) {
  const url = new URL(req.url, 'http://localhost');
  const query = {};
  for (const [k, v] of url.searchParams) query[k] = v;
  let ip = req.socket.remoteAddress || '';
  if (trustProxy && req.headers['x-forwarded-for']) {
    ip = String(req.headers['x-forwarded-for']).split(',')[0].trim();
  }
  let cookies;
  const ctx = {
    req,
    res,
    method: req.method.toUpperCase(),
    path: url.pathname,
    url,
    query,
    params: {},
    ip,
    state: {},
    user: null,
    session: null,
    get cookies() {
      if (!cookies) cookies = parseCookies(req.headers.cookie);
      return cookies;
    },
    setHeader(name, value) {
      if (!res.headersSent) res.setHeader(name, value);
    },
    appendCookie(cookie) {
      const prev = res.getHeader('Set-Cookie');
      const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
      res.setHeader('Set-Cookie', [...list, cookie]);
    },
    json(status, body) {
      if (res.headersSent) return;
      const payload = JSON.stringify(body ?? null);
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Length', Buffer.byteLength(payload));
      res.end(ctx.method === 'HEAD' ? undefined : payload);
    },
    send(status, body, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
      if (res.headersSent) return;
      res.statusCode = status;
      res.setHeader('Content-Type', contentType);
      for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
      const buf = typeof body === 'string' ? Buffer.from(body) : body;
      res.setHeader('Content-Length', buf ? buf.length : 0);
      res.end(ctx.method === 'HEAD' ? undefined : buf);
    },
    get responded() {
      return res.headersSent || res.writableEnded;
    },
  };
  return ctx;
}

// Reads the raw request body, refusing anything larger than `limit` bytes.
export function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new HttpError(413, 'The request is too large.', undefined, 'too_large'));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(new HttpError(413, 'The request is too large.', undefined, 'too_large'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      if (!failed) reject(err);
    });
  });
}

// Parses a JSON body and validates it with an optional zod schema.
export async function readJson(ctx, schema, { limit = 64 * 1024 } = {}) {
  const type = String(ctx.req.headers['content-type'] || '');
  if (!type.includes('application/json')) {
    throw new HttpError(415, 'Send the request body as JSON.', undefined, 'unsupported_media_type');
  }
  const raw = await readRawBody(ctx.req, limit);
  let data;
  try {
    data = raw.length ? JSON.parse(raw.toString('utf8')) : {};
  } catch {
    throw badRequest('The request body is not valid JSON.');
  }
  return schema ? schema.parse(data) : data;
}

// Parses a multipart/form-data body using the WHATWG Request implementation
// that ships with Node. Returns { fields, files } where files are Blob/File
// objects. The total size is capped by `limit`.
export async function readMultipart(ctx, { limit }) {
  const type = String(ctx.req.headers['content-type'] || '');
  if (!type.startsWith('multipart/form-data')) {
    throw new HttpError(415, 'Send the form as multipart/form-data.', undefined, 'unsupported_media_type');
  }
  const raw = await readRawBody(ctx.req, limit);
  let form;
  try {
    form = await new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': type },
      body: raw,
    }).formData();
  } catch {
    throw badRequest('The uploaded form could not be read.');
  }
  const fields = {};
  const files = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') {
      fields[key] = value;
    } else {
      (files[key] ||= []).push(value);
    }
  }
  return { fields, files };
}

// Converts any thrown error into a safe JSON response.
export function sendError(ctx, err, log = console.error) {
  if (err instanceof ZodError) {
    const fieldErrors = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_';
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    ctx.json(400, {
      error: { code: 'validation_error', message: 'Please check the highlighted fields.', fields: fieldErrors },
    });
    return;
  }
  if (err instanceof HttpError) {
    ctx.json(err.status, {
      error: { code: err.code || 'error', message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
    return;
  }
  // Database constraint violations caused by bad input
  if (err && err.code === '23505') {
    ctx.json(409, { error: { code: 'conflict', message: 'That record already exists.' } });
    return;
  }
  if (err && (err.code === '23514' || err.code === '23503' || err.code === '22P02')) {
    ctx.json(400, { error: { code: 'bad_request', message: 'The submitted data is not valid.' } });
    return;
  }
  log('[error]', ctx.method, ctx.path, err);
  ctx.json(500, { error: { code: 'server_error', message: 'Something went wrong on our side. Please try again.' } });
}
