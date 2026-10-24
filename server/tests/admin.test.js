import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetDatabase,
  startServer,
  shutdown,
  Client,
  createUser,
  login,
  createTeam,
  submitReport,
  getSql,
} from './helpers.js';

let server;
let admin;
let adminUser;
let citizen;
let team;

before(async () => {
  await resetDatabase();
  server = await startServer();
  adminUser = await createUser({ role: 'admin' });
  admin = await login(server.base, adminUser);
  citizen = await login(server.base, await createUser());
  team = await createTeam('Road Crew Alpha');
});
after(() => shutdown(server));

test('admins create staff accounts with a temporary password', async () => {
  const noTeam = await admin.post('/api/admin/users', {
    full_name: 'Pedro Crew',
    email: 'pedro@example.test',
    role: 'maintenance',
    temporary_password: 'TempCrew123',
  });
  assert.equal(noTeam.status, 400, 'maintenance needs a team');
  const res = await admin.post('/api/admin/users', {
    full_name: 'Pedro Crew',
    email: 'Pedro@example.test',
    role: 'maintenance',
    team_id: team.id,
    temporary_password: 'TempCrew123',
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.user.team_name, 'Road Crew Alpha');
  assert.equal(res.data.user.must_change_password, true);
  const crew = new Client(server.base);
  const loginRes = await crew.post('/api/auth/login', { email: 'pedro@example.test', password: 'TempCrew123' });
  assert.equal(loginRes.data.user.must_change_password, true);
  const dup = await admin.post('/api/admin/users', {
    full_name: 'Other',
    email: 'pedro@example.test',
    role: 'citizen',
    temporary_password: 'TempCrew123',
  });
  assert.equal(dup.status, 409);
});

test('user list supports search, role filter and pagination', async () => {
  const res = await admin.get('/api/admin/users?role=maintenance&q=pedro');
  assert.equal(res.status, 200);
  assert.equal(res.data.total, 1);
  assert.equal(res.data.items[0].email, 'pedro@example.test');
  assert.equal(res.data.items[0].password_hash, undefined);
  const page = await admin.get('/api/admin/users?pageSize=1&page=2');
  assert.equal(page.data.items.length, 1);
  assert.ok(page.data.total >= 3);
});

test('role changes and deactivation take effect immediately', async () => {
  const target = await createUser();
  const session = await login(server.base, target);
  const res = await admin.patch(`/api/admin/users/${target.id}`, { role: 'maintenance', team_id: team.id });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.user.role, 'maintenance');
  assert.equal((await session.get('/api/notifications')).status, 401, 'old session revoked');
  const off = await admin.patch(`/api/admin/users/${target.id}`, { is_active: false });
  assert.equal(off.data.user.is_active, false);
  const [log] = await getSql()`SELECT * FROM audit_logs WHERE action = 'user.update' AND target_id = ${String(target.id)} ORDER BY id LIMIT 1`;
  assert.deepEqual(log.details.role, { from: 'citizen', to: 'maintenance' });
});

test('admins cannot lock themselves out or remove the last administrator', async () => {
  const self = await admin.patch(`/api/admin/users/${adminUser.id}`, { role: 'citizen' });
  assert.equal(self.status, 409);
  const selfOff = await admin.patch(`/api/admin/users/${adminUser.id}`, { is_active: false });
  assert.equal(selfOff.status, 409);
  const second = await createUser({ role: 'admin' });
  const demote = await admin.patch(`/api/admin/users/${second.id}`, { role: 'citizen' });
  assert.equal(demote.status, 200);
});

test('password reset forces a change and signs the user out', async () => {
  const target = await createUser();
  const session = await login(server.base, target);
  const res = await admin.post(`/api/admin/users/${target.id}/reset-password`, { temporary_password: 'ResetPass99' });
  assert.equal(res.status, 200);
  assert.equal((await session.get('/api/notifications')).status, 401);
  const relog = await new Client(server.base).post('/api/auth/login', { email: target.email, password: 'ResetPass99' });
  assert.equal(relog.data.user.must_change_password, true);
});

test('teams and agencies can be managed', async () => {
  const a = await admin.post('/api/admin/agencies', { name: 'DPWH District Office', jurisdiction: 'national', contact_email: '' });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  const t = await admin.post('/api/admin/teams', { name: 'Road Crew Charlie', agency_id: a.data.id, description: 'Night shift' });
  assert.equal(t.status, 201);
  const dupe = await admin.post('/api/admin/teams', { name: 'road crew charlie' });
  assert.equal(dupe.status, 409);
  const list = await admin.get('/api/admin/teams');
  assert.ok(list.data.items.some((x) => x.name === 'Road Crew Charlie' && x.agency_name === 'DPWH District Office'));
  const upd = await admin.patch(`/api/admin/agencies/${a.data.id}`, { contact_phone: '(044) 123 4567' });
  assert.equal(upd.status, 200);
});

test('settings are validated before saving', async () => {
  const bad = await admin.put('/api/admin/settings', { duplicate_radius_m: 1, max_photos_per_report: 50 });
  assert.equal(bad.status, 400);
  const badAgency = await admin.put('/api/admin/settings', { road_type_agency: { national: 99999 } });
  assert.equal(badAgency.status, 400);
  const ok = await admin.put('/api/admin/settings', { lgu_name: 'City of Malolos', duplicate_radius_m: 40 });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.settings.lgu_name, 'City of Malolos');
  const pub = await new Client(server.base).get('/api/public/config');
  assert.equal(pub.data.lgu_name, 'City of Malolos');
  assert.equal(pub.data.duplicate_radius_m, 40);
});

test('dashboard statistics match the database', async () => {
  await submitReport(citizen, { severity: 'high', barangay: 'Mojon', latitude: '14.85', longitude: '120.81' });
  await submitReport(citizen, { severity: 'low', barangay: 'Mojon', latitude: '14.86', longitude: '120.82' });
  const third = await submitReport(citizen, { severity: 'medium', barangay: 'Longos', latitude: '14.87', longitude: '120.83' });
  await admin.post(`/api/admin/reports/${third.data.report.id}/reject`, { reason: 'Not a pothole (speed bump).' });
  const res = await admin.get('/api/admin/stats');
  assert.equal(res.status, 200);
  const s = res.data;
  assert.equal(s.totals.total, 3);
  assert.equal(s.totals.pending_review, 2);
  assert.equal(s.totals.closed_invalid, 1);
  assert.equal(s.by_status.rejected, 1);
  assert.equal(s.by_severity.high.open, 1);
  assert.equal(s.monthly.length, 6);
  assert.equal(s.monthly.at(-1).reported, 3);
  assert.equal(s.top_barangays[0].barangay, 'Mojon');
  assert.equal(s.top_barangays[0].open, 2);
  const ranged = await admin.get('/api/admin/stats?from=2000-01-01&to=2000-12-31');
  assert.equal(ranged.data.totals.total, 0);
});

test('reports table filters, searches and sorts', async () => {
  const res = await admin.get('/api/admin/reports?status=submitted&severity=high');
  assert.equal(res.data.total, 1);
  const search = await admin.get('/api/admin/reports?q=Longos');
  assert.equal(search.data.total, 1);
  const injection = await admin.get(`/api/admin/reports?q=${encodeURIComponent("%' OR 1=1 --")}`);
  assert.equal(injection.status, 200);
  assert.equal(injection.data.total, 0);
  const brgy = await admin.get('/api/admin/reports?barangay=mojon&sort=severity');
  assert.equal(brgy.data.total, 2);
  assert.equal(brgy.data.items[0].severity, 'high');
  const map = await admin.get('/api/admin/map?status=submitted');
  assert.equal(map.data.items.length, 2);
});

test('CSV export is complete, excludes personal data and neutralises formulas', async () => {
  await submitReport(citizen, {
    road_name: '=HYPERLINK("http://evil")',
    landmark: 'Beside "Aling Nena\'s" store, Santo Niño',
    latitude: '14.88',
    longitude: '120.84',
  });
  const res = await admin.get('/api/admin/exports/reports.csv');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="wayguard-reports-/);
  const csv = res.data;
  // fetch's text() strips the byte-order mark, so check the raw bytes for it.
  const raw = Buffer.from(
    await (await fetch(`${server.base}/api/admin/exports/reports.csv`, { headers: { cookie: admin.cookieHeader() } })).arrayBuffer(),
  );
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM for Excel');
  assert.ok(csv.startsWith('Report code,Status,Severity'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 5);
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"")"`), 'formula is prefixed and quoted');
  assert.ok(csv.includes('Santo Niño'));
  assert.ok(!csv.includes('@example.test'), 'no reporter e-mail in exports');
  const filtered = await admin.get('/api/admin/exports/reports.csv?status=rejected');
  assert.equal(filtered.data.trim().split('\r\n').length, 2);
});

test('PDF exports are produced and audited', async () => {
  const list = await admin.get('/api/admin/exports/reports.pdf?severity=high');
  assert.equal(list.status, 200);
  assert.equal(list.headers.get('content-type'), 'application/pdf');
  assert.equal(list.data.subarray(0, 5).toString(), '%PDF-');
  const summary = await admin.get('/api/admin/exports/summary.pdf');
  assert.equal(summary.status, 200);
  assert.ok(summary.data.length > 2000);
  const audit = await admin.get('/api/admin/audit');
  const actions = audit.data.items.map((i) => i.action);
  assert.ok(actions.includes('export.csv'));
  assert.ok(actions.includes('export.pdf'));
  assert.ok(actions.includes('export.summary_pdf'));
  assert.equal((await citizen.get('/api/admin/exports/summary.pdf')).status, 403);
});
