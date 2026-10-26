import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, startServer, shutdown, Client, createUser, login, createTeam, getSql } from './helpers.js';

let server;
before(async () => {
  await resetDatabase();
  server = await startServer();
});
after(() => shutdown(server));

test('registration validates input and always creates a citizen', async () => {
  const c = new Client(server.base);
  const bad = await c.post('/api/auth/register', { full_name: 'A', email: 'not-an-email', password: 'short' });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error.code, 'validation_error');
  assert.ok(bad.data.error.fields.email);
  assert.ok(bad.data.error.fields.password);
  assert.ok(bad.data.error.fields.full_name);

  const ok = await c.post('/api/auth/register', {
    full_name: 'Juan Dela Cruz',
    email: 'Juan@Example.test',
    password: 'Lubak2026',
    role: 'admin', // must be ignored
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.user.role, 'citizen');
  assert.equal(ok.data.user.email, 'juan@example.test');
  assert.equal(ok.data.user.password_hash, undefined);

  const me = await c.get('/api/auth/me');
  assert.equal(me.data.user.email, 'juan@example.test');

  const [row] = await getSql()`SELECT password_hash FROM users WHERE email = 'juan@example.test'`;
  assert.match(row.password_hash, /^scrypt\$/);
  assert.ok(!row.password_hash.includes('Lubak2026'));

  const dup = await new Client(server.base).post('/api/auth/register', {
    full_name: 'Juan Again',
    email: 'JUAN@example.test',
    password: 'Lubak2026',
  });
  assert.equal(dup.status, 409);
});

test('login rejects wrong passwords and unknown accounts with the same message', async () => {
  const user = await createUser();
  const c = new Client(server.base);
  const wrong = await c.post('/api/auth/login', { email: user.email, password: 'WrongPass1' });
  const unknown = await c.post('/api/auth/login', { email: 'nobody@example.test', password: 'WrongPass1' });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.data.error.message, unknown.data.error.message);
  const ok = await c.post('/api/auth/login', { email: user.email.toUpperCase(), password: user.password });
  assert.equal(ok.status, 200);
  assert.ok([...c.cookies.keys()].some((k) => k.endsWith('wg_sid')));
});

test('session cookie is HttpOnly and SameSite=Lax; logout ends the session', async () => {
  const user = await createUser();
  const c = new Client(server.base);
  const res = await c.post('/api/auth/login', { email: user.email, password: user.password });
  const cookie = res.headers.getSetCookie().join(';');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const token = [...c.cookies.values()][0];
  const out = await c.post('/api/auth/logout', {});
  assert.equal(out.status, 200);
  const me = await c.get('/api/auth/me');
  assert.equal(me.data.user, null);
  // The old token no longer works even if replayed.
  const replay = new Client(server.base);
  replay.cookies.set('wg_sid', token);
  assert.equal((await replay.get('/api/notifications')).status, 401);
});

test('state-changing requests require the CSRF header and a same-origin Origin', async () => {
  const user = await createUser();
  const c = await login(server.base, user);
  const noHeader = await c.request('PATCH', '/api/auth/profile', { json: { full_name: 'Changed' }, csrf: false });
  assert.equal(noHeader.status, 403);
  assert.equal(noHeader.data.error.code, 'csrf');
  const crossSite = await c.request('PATCH', '/api/auth/profile', {
    json: { full_name: 'Changed' },
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(crossSite.status, 403);
  const ok = await c.patch('/api/auth/profile', { full_name: 'Changed Name', phone: '0917 123 4567' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.full_name, 'Changed Name');
  assert.equal(ok.data.user.phone, '0917 123 4567');
});

test('protected endpoints require sign-in and the correct role', async () => {
  const anon = new Client(server.base);
  assert.equal((await anon.get('/api/reports/mine')).status, 401);
  assert.equal((await anon.get('/api/admin/reports')).status, 401);
  const citizen = await login(server.base, await createUser());
  assert.equal((await citizen.get('/api/admin/reports')).status, 403);
  assert.equal((await citizen.get('/api/admin/users')).status, 403);
  assert.equal((await citizen.get('/api/maintenance/tasks')).status, 403);
  assert.equal((await citizen.get('/api/admin/exports/reports.csv')).status, 403);
  const team = await createTeam();
  const crew = await login(server.base, await createUser({ role: 'maintenance', teamId: team.id }));
  assert.equal((await crew.get('/api/admin/reports')).status, 403);
  assert.equal((await crew.post('/api/admin/reports/1/verify', {})).status, 403);
  const admin = await login(server.base, await createUser({ role: 'admin' }));
  assert.equal((await admin.get('/api/admin/reports')).status, 200);
});

test('changing password requires the current one and signs out other devices', async () => {
  const user = await createUser({ password: 'Original123' });
  const phone = await login(server.base, user);
  const laptop = await login(server.base, user);
  const wrong = await laptop.post('/api/auth/change-password', { current_password: 'Nope12345', new_password: 'NewPass456' });
  assert.equal(wrong.status, 400);
  const weak = await laptop.post('/api/auth/change-password', { current_password: 'Original123', new_password: 'abcdefgh' });
  assert.equal(weak.status, 400);
  const ok = await laptop.post('/api/auth/change-password', { current_password: 'Original123', new_password: 'NewPass456' });
  assert.equal(ok.status, 200);
  assert.equal((await laptop.get('/api/notifications')).status, 200);
  assert.equal((await phone.get('/api/notifications')).status, 401);
  const relog = new Client(server.base);
  assert.equal((await relog.post('/api/auth/login', { email: user.email, password: 'NewPass456' })).status, 200);
});

test('accounts with a temporary password must change it before using the app', async () => {
  const user = await createUser({ mustChange: true, password: 'TempPass123' });
  const c = await login(server.base, user);
  assert.equal(c.user.must_change_password, true);
  const blocked = await c.get('/api/reports/mine');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error.code, 'password_change_required');
  await c.post('/api/auth/change-password', { current_password: 'TempPass123', new_password: 'Permanent123' });
  assert.equal((await c.get('/api/reports/mine')).status, 200);
});

test('deactivated users cannot sign in and lose existing sessions', async () => {
  const user = await createUser();
  const c = await login(server.base, user);
  await getSql()`UPDATE users SET is_active = FALSE WHERE id = ${user.id}`;
  assert.equal((await c.get('/api/notifications')).status, 401);
  const again = await new Client(server.base).post('/api/auth/login', { email: user.email, password: user.password });
  assert.equal(again.status, 403);
});

test('unknown API routes return JSON 404 and malformed JSON returns 400', async () => {
  const c = new Client(server.base);
  const res = await c.get('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(res.data.error.code, 'not_found');
  const bad = await fetch(`${server.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wayguard-csrf': '1' },
    body: '{not json',
  });
  assert.equal(bad.status, 400);
});

test('forgotten password: same answer for any address, one-time link, signs out every device', async () => {
  const { createPasswordReset } = await import('../src/services/passwordReset.js');
  const user = await createUser({ role: 'citizen', password: 'OldPass123' });
  const device = await login(server.base, user);
  const anon = new Client(server.base);

  const unknown = await anon.post('/api/auth/forgot-password', { email: 'nobody-here@example.test' });
  const known = await anon.post('/api/auth/forgot-password', { email: user.email.toUpperCase() });
  assert.equal(unknown.status, 200);
  assert.equal(known.status, 200);
  assert.deepEqual(Object.keys(unknown.data).sort(), Object.keys(known.data).sort(), 'the reply does not reveal whether the account exists');
  const [{ n }] = await getSql()`SELECT count(*)::int AS n FROM password_reset_tokens WHERE user_id = ${user.id} AND used_at IS NULL`;
  assert.equal(n, 1, 'a reset link was created for the real account only');

  const token = await createPasswordReset(user.id);
  const [stored] = await getSql()`SELECT token_hash FROM password_reset_tokens WHERE user_id = ${user.id} AND used_at IS NULL`;
  assert.notEqual(stored.token_hash, token, 'only a hash of the token is stored');
  assert.equal((await anon.get('/api/auth/reset-password?token=' + token)).data.valid, true);

  const weak = await anon.post('/api/auth/reset-password', { token, new_password: 'short' });
  assert.equal(weak.status, 400);
  const ok = await anon.post('/api/auth/reset-password', { token, new_password: 'NewPass456' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await device.get('/api/auth/me')).data.user, null, 'existing sessions are signed out');
  assert.equal((await new Client(server.base).post('/api/auth/login', { email: user.email, password: 'NewPass456' })).status, 200);
  assert.equal((await new Client(server.base).post('/api/auth/login', { email: user.email, password: 'OldPass123' })).status, 401);

  const again = await anon.post('/api/auth/reset-password', { token, new_password: 'Another789' });
  assert.equal(again.status, 400, 'a link works only once');
  assert.equal((await anon.get('/api/auth/reset-password?token=' + token)).data.valid, false);

  const expired = await createPasswordReset(user.id);
  await getSql()`UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = ${user.id} AND used_at IS NULL`;
  assert.equal((await anon.post('/api/auth/reset-password', { token: expired, new_password: 'Another789' })).status, 400, 'expired links are refused');
});
