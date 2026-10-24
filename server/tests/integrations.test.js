// Geocoder proxy and e-mail delivery, tested against local fake services so
// no real third-party server is contacted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';

let nominatimHits = [];
let nominatimMode = 'ok';
const nominatim = http.createServer((req, res) => {
  nominatimHits.push({ url: req.url, ua: req.headers['user-agent'] });
  if (nominatimMode === 'fail') {
    res.writeHead(500).end('boom');
    return;
  }
  const u = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'application/json');
  if (u.pathname === '/search') {
    res.end(
      JSON.stringify([
        {
          display_name: 'Paseo del Congreso, Catmon, Malolos, Bulacan, Philippines',
          lat: '14.8445',
          lon: '120.8102',
          address: { road: 'Paseo del Congreso', quarter: 'Catmon', city: 'Malolos' },
        },
      ]),
    );
  } else {
    res.end(JSON.stringify({ display_name: 'MacArthur Highway, Mojon', address: { road: 'MacArthur Highway', village: 'Mojon', city: 'Malolos' } }));
  }
});

// Fake SMTP server that records one message.
const mails = [];
const smtp = net.createServer((socket) => {
  socket.setEncoding('utf8');
  let data = false;
  let buf = '';
  let current = { rcpt: [], body: '' };
  socket.write('220 fake.smtp ESMTP\r\n');
  socket.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (data) {
        if (line === '.') {
          data = false;
          mails.push(current);
          current = { rcpt: [], body: '' };
          socket.write('250 queued\r\n');
        } else current.body += `${line}\n`;
        continue;
      }
      if (/^EHLO/i.test(line)) socket.write('250-fake.smtp\r\n250 AUTH PLAIN\r\n');
      else if (/^AUTH PLAIN/i.test(line)) {
        current.auth = Buffer.from(line.split(' ')[2], 'base64').toString();
        socket.write('235 ok\r\n');
      } else if (/^MAIL FROM/i.test(line)) socket.write('250 ok\r\n');
      else if (/^RCPT TO/i.test(line)) {
        current.rcpt.push(line);
        socket.write('250 ok\r\n');
      } else if (/^DATA/i.test(line)) {
        data = true;
        socket.write('354 go\r\n');
      } else if (/^QUIT/i.test(line)) {
        socket.write('221 bye\r\n');
        socket.end();
      } else socket.write('500 ?\r\n');
    }
  });
});

await new Promise((r) => nominatim.listen(0, '127.0.0.1', r));
await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
process.env.GEOCODER_URL = `http://127.0.0.1:${nominatim.address().port}`;
process.env.GEOCODER_EMAIL = 'team@example.test';
process.env.GEOCODER_MIN_INTERVAL_MS = '200';
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = String(smtp.address().port);
process.env.SMTP_USER = 'mailer';
process.env.SMTP_PASS = 'secret';
process.env.MAIL_FROM = 'Wayguard <no-reply@example.test>';

const { resetDatabase, startServer, shutdown, createUser, login, submitReport, getSql } = await import('./helpers.js');
const { deliverPendingEmails } = await import('../src/services/mailer.js');

let server;
let citizen;
let admin;
before(async () => {
  await resetDatabase();
  server = await startServer();
  citizen = await login(server.base, await createUser({ name: 'Maria Santos' }));
  admin = await login(server.base, await createUser({ role: 'admin' }));
});
after(async () => {
  await shutdown(server);
  nominatim.close();
  smtp.close();
});

test('address search goes through the server, identifies itself and is cached', async () => {
  const res = await citizen.get('/api/geo/search?q=Paseo%20del%20Congreso');
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.items[0].road_name, 'Paseo del Congreso');
  assert.equal(res.data.items[0].barangay, 'Catmon');
  assert.equal(res.data.items[0].latitude, 14.8445);
  assert.equal(nominatimHits.length, 1);
  assert.match(nominatimHits[0].ua, /^Wayguard\/1\.0/);
  assert.match(nominatimHits[0].url, /countrycodes=ph/);
  assert.match(nominatimHits[0].url, /email=team%40example\.test/);
  const again = await citizen.get('/api/geo/search?q=paseo%20del%20congreso');
  assert.equal(again.status, 200);
  assert.equal(nominatimHits.length, 1, 'second identical search served from cache');
});

test('reverse geocoding fills road and barangay; requests are spaced out', async () => {
  const t0 = Date.now();
  const a = await citizen.get('/api/geo/reverse?lat=14.85&lng=120.81');
  const b = await citizen.get('/api/geo/reverse?lat=14.86&lng=120.82');
  assert.equal(a.data.result.road_name, 'MacArthur Highway');
  assert.equal(a.data.result.barangay, 'Mojon');
  assert.equal(b.status, 200);
  assert.ok(Date.now() - t0 >= 200, 'throttle enforced between upstream calls');
});

test('geocoder failures degrade gracefully with a clear message', async () => {
  nominatimMode = 'fail';
  const res = await citizen.get('/api/geo/search?q=Some%20new%20place');
  assert.equal(res.status, 503);
  assert.match(res.data.error.message, /Pin the location on the map/);
  assert.equal((await citizen.get('/api/geo/search?q=ab')).status, 400);
  assert.equal((await citizen.get('/api/geo/reverse?lat=999&lng=1')).status, 400);
  nominatimMode = 'ok';
});

test('status notifications are e-mailed through SMTP when configured', async () => {
  const res = await submitReport(citizen);
  const id = res.data.report.id;
  await admin.post(`/api/admin/reports/${id}/review`, {});
  const [pending] = await getSql()`
    SELECT count(*)::int AS n FROM notifications WHERE email_status = 'pending'`;
  assert.ok(pending.n >= 2, 'admin new-report and citizen status notifications queued');
  const result = await deliverPendingEmails();
  assert.equal(result.failed, 0);
  assert.equal(result.sent, pending.n);
  const toCitizen = mails.find((m) => m.rcpt.some((r) => r.includes(citizen.user.email)));
  assert.ok(toCitizen, 'citizen received an e-mail');
  assert.equal(toCitizen.auth, '\0mailer\0secret');
  assert.match(toCitizen.body, /Subject: \[Wayguard\] WG-\d{4}-\d{5}: Under Review/);
  const text = Buffer.from(toCitizen.body.split('\n\n').slice(1).join('').replace(/\s/g, ''), 'base64').toString();
  assert.match(text, /Hello Maria Santos/);
  assert.match(text, new RegExp(`/r/${id}`));
  const [left] = await getSql()`SELECT count(*)::int AS n FROM notifications WHERE email_status = 'pending'`;
  assert.equal(left.n, 0);
});

test('users who opt out of e-mail still get in-app notifications', async () => {
  await citizen.patch('/api/auth/profile', { email_notifications: false });
  const id = (await submitReport(citizen, { latitude: '14.9', longitude: '120.9' })).data.report.id;
  await admin.post(`/api/admin/reports/${id}/review`, {});
  const [row] = await getSql()`
    SELECT email_status FROM notifications WHERE report_id = ${id} AND user_id = ${citizen.user.id}`;
  assert.equal(row.email_status, 'skipped');
});

test('without a Google key the app uses the vector road map (OpenFreeMap) and the CSP allows only that', async () => {
  const res = await fetch(`${server.base}/api/public/config`);
  const body = await res.json();
  assert.equal(body.map.provider, 'vector');
  assert.equal(body.map.vector.tilejson, 'https://tiles.openfreemap.org/planet');
  assert.match(body.map.vector.glyphs, /^https:\/\/tiles\.openfreemap\.org\/fonts\/\{fontstack\}\/\{range\}\.pbf$/);
  assert.match(body.map.vector.attribution, /OpenStreetMap/);
  assert.equal(body.map.google_api_key, undefined);
  assert.ok(body.tiles.url, 'raster tiles stay configured as the fallback');
  const csp = res.headers.get('content-security-policy');
  assert.ok(!csp.includes('googleapis'), csp);
  assert.match(csp, /connect-src 'self' https:\/\/tiles\.openfreemap\.org;/);
  assert.match(csp, /worker-src 'self';/);
  assert.match(csp, /style-src 'self';/);
});
