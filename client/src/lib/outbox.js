// Offline report outbox. When a citizen has no signal, the report (form
// fields and photo files) is kept in this phone's IndexedDB and sent
// automatically when the connection comes back. Nothing leaves the device
// until it is sent to Wayguard over the normal, signed-in connection.
import { upload } from './api.js';

const DB = 'wayguard';
const STORE = 'outbox';
const listeners = new Set();

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser cannot store reports offline.'));
      return;
    }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open offline storage.'));
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    t.oncomplete = () => { db.close(); resolve(result); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  });
}

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function emit() {
  listeners.forEach((fn) => fn());
}

export function onOutboxChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function saveToOutbox(userId, fields, photos) {
  const item = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    user_id: userId,
    saved_at: new Date().toISOString(),
    fields,
    photos: photos.map((p, i) => ({ blob: p.file, name: p.file.name || `photo-${i + 1}.jpg`, type: p.file.type || 'image/jpeg' })),
    attempts: 0,
    error: null,
  };
  await tx('readwrite', (s) => req(s.put(item)));
  emit();
  return item;
}

export async function listOutbox(userId) {
  try {
    const all = await tx('readonly', (s) => req(s.getAll()));
    return all.filter((i) => i.user_id === userId).sort((a, b) => a.saved_at.localeCompare(b.saved_at));
  } catch {
    return [];
  }
}

export async function removeFromOutbox(id) {
  await tx('readwrite', (s) => req(s.delete(id)));
  emit();
}

let flushing = null;

// Sends every waiting report. Stops at the first network failure (still
// offline); a report the server refuses (e.g. invalid) is kept with the
// reason so the citizen can see it and discard it.
export function flushOutbox(userId, { onSent } = {}) {
  if (flushing) return flushing;
  flushing = (async () => {
    const items = await listOutbox(userId);
    let sent = 0;
    for (const item of items) {
      if (item.error) continue;
      const fd = new FormData();
      for (const [k, v] of Object.entries(item.fields)) fd.append(k, v);
      item.photos.forEach((p) => fd.append('photos', p.blob, p.name));
      try {
        const res = await upload('/api/reports', fd);
        await removeFromOutbox(item.id);
        sent += 1;
        onSent?.(res, item);
      } catch (err) {
        if (err.code === 'network') break;
        if (err.status === 401) break; // signed out: try again after sign-in
        await tx('readwrite', (s) => req(s.put({ ...item, attempts: item.attempts + 1, error: err.message })));
        emit();
      }
    }
    return sent;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
