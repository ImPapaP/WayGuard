import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  resetDatabase,
  startServer,
  shutdown,
  Client,
  createUser,
  login,
  createAgency,
  submitReport,
  reportForm,
  jpeg,
  getSql,
  config,
} from './helpers.js';

let server;
let alice;
let bob;
let admin;
before(async () => {
  await resetDatabase();
  server = await startServer();
  alice = await login(server.base, await createUser({ name: 'Alice Reporter' }));
  bob = await login(server.base, await createUser({ name: 'Bob Reporter' }));
  admin = await login(server.base, await createUser({ role: 'admin' }));
});
after(() => shutdown(server));

test('a report needs a description, road, severity, valid coordinates and a photo', async () => {
  const missing = await alice.postForm(
    '/api/reports',
    await reportForm({ description: 'short', road_name: '', severity: 'extreme', latitude: '95', location_source: 'gps' }),
  );
  assert.equal(missing.status, 400);
  const f = missing.data.error.fields;
  assert.ok(f.description && f.road_name && f.severity && f.latitude, JSON.stringify(f));

  const noPhoto = await alice.postForm('/api/reports', await reportForm({}, { photos: 0 }));
  assert.equal(noPhoto.status, 400);
  assert.match(noPhoto.data.error.message, /at least one photo/);

  const tooMany = await alice.postForm('/api/reports', await reportForm({}, { photos: 6 }));
  assert.equal(tooMany.status, 400);

  const badHazard = await alice.postForm('/api/reports', await reportForm({ hazards: 'lava' }));
  assert.equal(badHazard.status, 400);
});

test('non-image files are rejected even when named .jpg', async () => {
  const fake = Buffer.from('<script>alert(1)</script> not an image');
  const res = await alice.postForm('/api/reports', await reportForm({}, { photoBuffers: [fake] }));
  assert.equal(res.status, 400);
  assert.match(res.data.error.message, /not a supported image/);
  // A truncated JPEG header followed by junk passes the sniff but fails decoding.
  const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
  const res2 = await alice.postForm('/api/reports', await reportForm({}, { photoBuffers: [corrupt] }));
  assert.equal(res2.status, 400);
  const [{ n }] = await getSql()`SELECT count(*)::int AS n FROM reports`;
  assert.equal(n, 0);
});

test('a valid report is stored with coordinates, photos (metadata stripped) and history', async () => {
  const agency = await createAgency('City Engineering Office');
  await admin.put('/api/admin/settings', { road_type_agency: { city_municipal: agency.id } });
  const res = await submitReport(alice, { location_source: 'gps', location_accuracy_m: '8.5' });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.match(res.data.report.code, /^WG-\d{4}-\d{5}$/);
  assert.equal(res.data.report.status, 'submitted');

  const [r] = await getSql()`SELECT * FROM reports WHERE id = ${res.data.report.id}`;
  assert.equal(r.latitude, 14.8433);
  assert.equal(r.longitude, 120.8114);
  assert.equal(r.location_source, 'gps');
  assert.equal(r.location_accuracy_m, 8.5);
  assert.deepEqual(r.hazards, ['deep', 'water_filled']);
  assert.equal(r.agency_id, agency.id, 'agency suggested from road type mapping');

  const [photo] = await getSql()`SELECT * FROM report_photos WHERE report_id = ${r.id}`;
  assert.match(photo.storage_key, /^\d{4}\/\d{2}\/[0-9a-f-]{36}$/);
  const file = path.join(config.uploadDir, `${photo.storage_key}.jpg`);
  const meta = await sharp(await fs.readFile(file)).metadata();
  assert.equal(meta.exif, undefined, 'EXIF (including GPS) must be removed');

  const detail = await alice.get(`/api/reports/${r.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.report.events[0].event_type, 'created');
  assert.equal(detail.data.report.photos.length, 1);
  assert.equal(detail.data.report.reporter, undefined, 'citizens do not get the reporter block');

  const [notif] = await getSql()`
    SELECT n.* FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.role = 'admin' AND n.report_id = ${r.id}`;
  assert.ok(notif, 'administrators are notified of new reports');
});

test('the same person cannot report the same spot twice in a day', async () => {
  const res = await submitReport(alice, { latitude: '14.84335', longitude: '120.81142' });
  assert.equal(res.status, 409);
  assert.match(res.data.error.message, /already reported/);
});

test('another citizen reporting nearby is flagged as a possible duplicate', async () => {
  const near = await submitReport(bob, { latitude: '14.84345', longitude: '120.81145', road_name: 'Paseo del Congreso St.' });
  assert.equal(near.status, 201);
  assert.equal(near.data.possible_duplicates, 1);
  const detail = await admin.get(`/api/reports/${near.data.report.id}`);
  assert.equal(detail.data.report.duplicate_candidates.length, 1);
  const cand = detail.data.report.duplicate_candidates[0];
  assert.ok(cand.distance_m < 30);
  assert.equal(cand.likelihood, 'high');
  const list = await admin.get('/api/admin/reports?has_duplicates=true');
  assert.equal(list.data.total, 2);

  const far = await submitReport(bob, { latitude: '14.8600', longitude: '120.8300', road_name: 'MacArthur Highway' });
  assert.equal(far.status, 201);
  assert.equal(far.data.possible_duplicates, 0);
});

test('the nearby endpoint warns about existing reports without personal data', async () => {
  const res = await alice.get('/api/reports/nearby?lat=14.8434&lng=120.8114');
  assert.equal(res.status, 200);
  assert.ok(res.data.items.length >= 2);
  for (const item of res.data.items) {
    assert.equal(item.reporter_id, undefined);
    assert.equal(item.description, undefined);
    assert.ok(item.code && item.distance_m >= 0);
  }
  assert.equal((await alice.get('/api/reports/nearby?lat=abc&lng=1')).status, 400);
});

test('citizens only see their own reports and photos', async () => {
  const mine = await alice.get('/api/reports/mine');
  assert.equal(mine.status, 200);
  assert.equal(mine.data.total, 1);
  const bobs = await bob.get('/api/reports/mine');
  assert.equal(bobs.data.total, 2);

  const aliceReportId = mine.data.items[0].id;
  assert.equal((await bob.get(`/api/reports/${aliceReportId}`)).status, 404);
  const photoUrl = mine.data.items[0].photo.url;
  assert.equal((await alice.get(photoUrl)).status, 200);
  assert.equal((await alice.get(`${photoUrl}?size=thumb`)).headers.get('content-type'), 'image/jpeg');
  assert.equal((await bob.get(photoUrl)).status, 404);
  assert.equal((await new Client(server.base).get(photoUrl)).status, 401);
  assert.equal((await admin.get(photoUrl)).status, 200);
  assert.equal((await alice.get('/api/reports/abc')).status, 400);
});

test('the public map only shows verified reports and no personal data', async () => {
  const anon = new Client(server.base);
  let res = await anon.get('/api/public/reports');
  assert.equal(res.status, 200);
  assert.equal(res.data.items.length, 0, 'unverified reports are not public');

  const id = (await alice.get('/api/reports/mine')).data.items[0].id;
  assert.equal((await admin.post(`/api/admin/reports/${id}/review`, {})).status, 200);
  assert.equal((await admin.post(`/api/admin/reports/${id}/verify`, {})).status, 200);
  res = await anon.get('/api/public/reports');
  assert.equal(res.data.items.length, 1);
  const item = res.data.items[0];
  assert.equal(item.code.startsWith('WG-'), true);
  for (const key of ['reporter_id', 'photos', 'rejection_reason', 'agency_id', 'location_accuracy_m']) {
    assert.equal(item[key], undefined, `${key} must not be public`);
  }
  const bbox = await anon.get('/api/public/reports?bbox=121,15,122,16');
  assert.equal(bbox.data.items.length, 0);
  const stats = await anon.get('/api/public/stats');
  assert.equal(stats.data.total_reports, 3);
});

test('feedback is only accepted from the reporter after resolution', async () => {
  const id = (await alice.get('/api/reports/mine')).data.items[0].id;
  const early = await alice.post(`/api/reports/${id}/feedback`, { rating: 5 });
  assert.equal(early.status, 409);
  const other = await bob.post(`/api/reports/${id}/feedback`, { rating: 1 });
  assert.equal(other.status, 404);
});

test('oversized uploads are refused', async () => {
  const big = await sharp({ create: { width: 4000, height: 4000, channels: 3, background: '#888' } })
    .jpeg({ quality: 100 })
    .toBuffer();
  // Pad beyond the configured maximum to simulate a huge camera file.
  const huge = Buffer.concat([big, Buffer.alloc(config.maxPhotoBytes)]);
  const res = await alice.postForm('/api/reports', await reportForm({ latitude: '14.9' }, { photoBuffers: [huge] }));
  assert.ok([400, 413].includes(res.status), `expected 400/413, got ${res.status}`);
});

test('large camera photos are resized and still accepted', async () => {
  const photo = await jpeg({ width: 3200, height: 2400 });
  const res = await alice.postForm(
    '/api/reports',
    await reportForm({ latitude: '14.8700', longitude: '120.8000' }, { photoBuffers: [photo] }),
  );
  assert.equal(res.status, 201);
  const [p] = await getSql()`SELECT width, height FROM report_photos WHERE report_id = ${res.data.report.id}`;
  assert.equal(Math.max(p.width, p.height), 1600);
});
