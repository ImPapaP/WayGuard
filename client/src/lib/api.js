// Thin wrapper around fetch for the Wayguard API. Adds the CSRF header to
// every state-changing request and turns error responses into ApiError.
export class ApiError extends Error {
  constructor(message, { status = 0, code = 'error', fields = null, details = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.details = details;
  }
}

const listeners = new Set();
// Lets the auth layer react when a session expires mid-use.
export function onAuthError(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function parseError(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    // not JSON
  }
  const e = body?.error || {};
  const message =
    e.message ||
    (res.status === 413 ? 'The upload is too large.' : `Request failed (${res.status}). Please try again.`);
  const err = new ApiError(message, { status: res.status, code: e.code, fields: e.fields, details: e.details });
  if (res.status === 401 || e.code === 'password_change_required') listeners.forEach((fn) => fn(err));
  return err;
}

export async function api(path, { method = 'GET', body, signal, headers = {} } = {}) {
  const init = { method, signal, headers: { Accept: 'application/json', ...headers }, credentials: 'same-origin' };
  if (method !== 'GET' && method !== 'HEAD') init.headers['X-Wayguard-CSRF'] = '1';
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(
      navigator.onLine === false
        ? 'You are offline. Reconnect to the internet and try again.'
        : 'Cannot reach the Wayguard server. Check your connection and try again.',
      { code: 'network' },
    );
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return null;
  return res.json();
}

api.get = (path, opts) => api(path, { ...opts, method: 'GET' });
api.post = (path, body, opts) => api(path, { ...opts, method: 'POST', body: body ?? {} });
api.patch = (path, body, opts) => api(path, { ...opts, method: 'PATCH', body });
api.put = (path, body, opts) => api(path, { ...opts, method: 'PUT', body });

// Multipart upload with progress (fetch cannot report upload progress).
export function upload(path, formData, { onProgress } = {}) {
  // The browser preview answers API calls in-page through fetch.
  if (__WG_PREVIEW__) {
    onProgress?.(100);
    return api(path, { method: 'POST', body: formData });
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.setRequestHeader('X-Wayguard-CSRF', '1');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () =>
      reject(new ApiError('The upload failed. Check your connection and try again.', { code: 'network' }));
    xhr.onload = async () => {
      const res = new Response(xhr.responseText, {
        status: xhr.status,
        headers: { 'Content-Type': xhr.getResponseHeader('Content-Type') || 'application/json' },
      });
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText ? JSON.parse(xhr.responseText) : null);
      else reject(await parseError(res));
    };
    xhr.send(formData);
  });
}

// Builds a query string from an object, skipping empty values.
export function qs(params) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') s.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const str = s.toString();
  return str ? `?${str}` : '';
}
