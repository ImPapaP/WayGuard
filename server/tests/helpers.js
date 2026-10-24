// Shared test utilities. Tests run against TEST_DATABASE_URL, whose schema is
// wiped and rebuilt for every test file — never point it at real data.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wayguard-test-uploads-'));
process.env.WAYGUARD_DISABLE_RATE_LIMIT = process.env.WAYGUARD_DISABLE_RATE_LIMIT ?? '1';

const { config } = await import('../src/config.js');
const { getSql, closeSql } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/lib/security.js');
const { invalidateSettingsCache } = await import('../src/services/settings.js');
const sharp = (await import('sharp')).default;
const http = await import('node:http');

export { config, getSql };

export async function resetDatabase() {
  if (!config.databaseUrl) throw new Error('Set TEST_DATABASE_URL in .env to run the tests.');
  const dbName = new URL(config.databaseUrl).pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to wipe "${dbName}": the test database name must end with "_test".`);
  }
  const sql = getSql();
  await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await migrate({ log: () => {} });
  invalidateSettingsCache();
}

export async function startServer() {
  const server = http.createServer(createApp({ logRequests: false }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      server.closeAllConnections?.();
    },
  };
}

export async function shutdown(server) {
  if (server) await server.close();
  await closeSql();
  fs.rmSync(config.uploadDir, { recursive: true, force: true });
}

// Minimal HTTP client with a cookie jar, mimicking the browser front end.
export class Client {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(method, url, { json, form, headers = {}, csrf = true } = {}) {
    const h = { ...headers };
    if (this.cookies.size) h.cookie = this.cookieHeader();
    if (csrf && method !== 'GET') h['x-wayguard-csrf'] = '1';
    let body;
    if (json !== undefined) {
      h['content-type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) {
      body = form;
    }
    const res = await fetch(this.base + url, { method, headers: h, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
      if (expired || !value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const type = res.headers.get('content-type') || '';
    let data;
    if (type.includes('application/json')) data = await res.json();
    else if (type.startsWith('text/')) data = await res.text();
    else data = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, data };
  }

  get(url, opts) { return this.request('GET', url, opts); }
  post(url, json, opts = {}) { return this.request('POST', url, { ...opts, json }); }
  patch(url, json, opts = {}) { return this.request('PATCH', url, { ...opts, json }); }
  put(url, json, opts = {}) { return this.request('PUT', url, { ...opts, json }); }
  postForm(url, form, opts = {}) { return this.request('POST', url, { ...opts, form }); }
}

let userCounter = 0;
export async function createUser({ role = 'citizen', teamId = null, password = 'Password123', mustChange = false, name } = {}) {
  userCounter += 1;
  const email = `${role}${userCounter}-${Date.now()}@example.test`;
  const hash = await hashPassword(password);
  const [u] = await getSql()`
    INSERT INTO users (email, password_hash, full_name, role, team_id, must_change_password)
    VALUES (${email}, ${hash}, ${name || `Test ${role} ${userCounter}`}, ${role}, ${teamId}, ${mustChange})
    RETURNING id, email, role, team_id`;
  return { ...u, password };
}

export async function login(base, user) {
  const client = new Client(base);
  const res = await client.post('/api/auth/login', { email: user.email, password: user.password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.data)}`);
  client.user = res.data.user;
  return client;
}

export async function createTeam(name = `Crew ${Date.now()}-${Math.random().toString(16).slice(2, 6)}`) {
  const [t] = await getSql()`INSERT INTO maintenance_teams (name) VALUES (${name}) RETURNING id, name`;
  return t;
}

export async function createAgency(name = `Agency ${Date.now()}`, jurisdiction = 'city_municipal') {
  const [a] = await getSql()`INSERT INTO agencies (name, jurisdiction) VALUES (${name}, ${jurisdiction}) RETURNING id, name`;
  return a;
}

// A real JPEG with EXIF metadata (including GPS) so tests can confirm it is stripped.
export async function jpeg({ width = 64, height = 48, color = '#556677' } = {}) {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg()
    .withExif({ IFD0: { Make: 'TestCam', Model: 'Wayguard' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '14/1 50/1 0/1' } })
    .toBuffer();
}

export async function reportForm(fields = {}, { photos = 1, photoBuffers } = {}) {
  const form = new FormData();
  const defaults = {
    description: 'Deep pothole on the right lane near the corner.',
    road_name: 'Paseo del Congreso',
    barangay: 'Catmon',
    city: 'Malolos',
    landmark: 'Near the church',
    severity: 'high',
    road_type: 'city_municipal',
    hazards: 'deep,water_filled',
    latitude: '14.8433',
    longitude: '120.8114',
    location_source: 'map',
  };
  for (const [k, v] of Object.entries({ ...defaults, ...fields })) {
    if (v !== undefined && v !== null) form.append(k, String(v));
  }
  const buffers = photoBuffers || (await Promise.all(Array.from({ length: photos }, () => jpeg())));
  buffers.forEach((buf, i) => form.append('photos', new Blob([buf], { type: 'image/jpeg' }), `photo${i}.jpg`));
  return form;
}

export async function submitReport(client, fields = {}, opts = {}) {
  const res = await client.postForm('/api/reports', await reportForm(fields, opts));
  return res;
}
