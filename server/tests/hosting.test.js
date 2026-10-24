// Settings for free cloud hosting (e.g. Render + Neon): photos stored in the
// database instead of on a disk that is wiped on restart, the first
// administrator created once from environment variables, and hosted
// PostgreSQL connection strings.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.PHOTO_STORAGE = 'database';
process.env.INITIAL_ADMIN_EMAIL = 'First.Admin@Example.test';
process.env.INITIAL_ADMIN_NAME = 'Ana Reyes';
process.env.INITIAL_ADMIN_PASSWORD = 'Strong-Start-2026';

const { resetDatabase, startServer, shutdown, createUser, login, submitReport, getSql, config, Client } = await import('./helpers.js');
const { ensureInitialAdmin } = await import('../src/services/bootstrap.js');
const { connectionOptions } = await import('../src/db/index.js');
const quiet = { log() {}, error() {} };

let server;
before(async () => {
  await resetDatabase();
  server = await startServer();
});
after(() => shutdown(server));

test('photos are stored in the database, served with access control, and no files are written', async () => {
  const citizen = await login(server.base, await createUser());
  const res = await submitReport(citizen, {});
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const sql = getSql();
  const [photo] = await sql`SELECT id, storage_key FROM report_photos WHERE report_id = ${res.data.report.id}`;
  const files = await sql`SELECT file_key, length(data) AS n FROM photo_files WHERE file_key LIKE ${photo.storage_key + '%'} ORDER BY file_key`;
  assert.deepEqual(files.map((f) => f.file_key), [`${photo.storage_key}.jpg`, `${photo.storage_key}_thumb.jpg`]);
  assert.ok(files.every((f) => f.n > 100));
  const img = await citizen.get(`/api/photos/${photo.id}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  const bytes = img.data;
  assert.equal(bytes[0], 0xff);
  assert.ok(!bytes.includes(Buffer.from('Exif')), 'metadata stripped');
  const thumb = await citizen.get(`/api/photos/${photo.id}?size=thumb`);
  assert.equal(thumb.status, 200);
  const other = await login(server.base, await createUser());
  assert.equal((await other.get(`/api/photos/${photo.id}`)).status, 404, 'other citizens cannot see it');
  const onDisk = fs.existsSync(config.uploadDir) ? fs.readdirSync(config.uploadDir, { recursive: true }).filter((f) => f.endsWith('.jpg')) : [];
  assert.deepEqual(onDisk, []);
});

test('the first administrator is created once from INITIAL_ADMIN_* and must change the password', async () => {
  const r1 = await ensureInitialAdmin({ log: quiet });
  assert.equal(r1.created, true);
  const [u] = await getSql()`SELECT email, full_name, role, must_change_password, password_hash FROM users WHERE email = 'first.admin@example.test'`;
  assert.equal(u.role, 'admin');
  assert.equal(u.full_name, 'Ana Reyes');
  assert.equal(u.must_change_password, true);
  assert.ok(!u.password_hash.includes('Strong-Start-2026'));
  const c = new Client(server.base);
  const signIn = await c.post('/api/auth/login', { email: 'first.admin@example.test', password: 'Strong-Start-2026' });
  assert.equal(signIn.status, 200);
  assert.equal(signIn.data.user.must_change_password, true);
  assert.equal((await c.get('/api/admin/stats')).status, 403, 'blocked until the password is changed');
  const r2 = await ensureInitialAdmin({ log: quiet });
  assert.equal(r2.created, false);
  const [{ n }] = await getSql()`SELECT count(*)::int AS n FROM users WHERE role = 'admin'`;
  assert.equal(n, 1);
});

test('a weak INITIAL_ADMIN_PASSWORD is refused', async () => {
  await getSql()`DELETE FROM users WHERE role = 'admin'`;
  const saved = config.initialAdmin.password;
  config.initialAdmin.password = 'short';
  const r = await ensureInitialAdmin({ log: quiet });
  config.initialAdmin.password = saved;
  assert.equal(r.created, false);
  assert.equal(r.reason, 'invalid');
});

test('hosted PostgreSQL URLs: Neon extras removed, pooled endpoints without prepared statements', () => {
  const direct = connectionOptions('postgresql://u:p@ep-cool-1.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require');
  assert.equal(direct.url, 'postgresql://u:p@ep-cool-1.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');
  assert.equal(direct.prepare, true);
  const pooled = connectionOptions('postgresql://u:p@ep-cool-1-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');
  assert.equal(pooled.prepare, false);
  assert.equal(connectionOptions('postgres://wayguard:pw@localhost:5432/wayguard').prepare, true);
});
