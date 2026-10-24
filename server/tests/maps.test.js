// Google Maps configuration: the browser key and Map ID reach the web
// client, the Content Security Policy allows Google's map hosts, and address
// search can use the Google Geocoding API with a separate server-side key
// (tested against a local fake, so Google is never contacted).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const hits = [];
let mode = 'ok';
const fakeGoogle = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  hits.push(u);
  res.setHeader('content-type', 'application/json');
  if (mode === 'denied') {
    res.end(JSON.stringify({ status: 'REQUEST_DENIED', error_message: 'The provided API key is invalid.', results: [] }));
    return;
  }
  const result = {
    formatted_address: 'Paseo del Congreso, Catmon, Malolos, Bulacan, Philippines',
    geometry: { location: { lat: 14.8445, lng: 120.8102 } },
    address_components: [
      { long_name: 'Paseo del Congreso', short_name: 'Paseo del Congreso', types: ['route'] },
      { long_name: 'Catmon', short_name: 'Catmon', types: ['sublocality_level_1', 'sublocality', 'political'] },
      { long_name: 'Malolos', short_name: 'Malolos', types: ['locality', 'political'] },
      { long_name: 'Bulacan', short_name: 'Bulacan', types: ['administrative_area_level_2', 'political'] },
    ],
  };
  res.end(JSON.stringify({ status: 'OK', results: [result] }));
});
await new Promise((r) => fakeGoogle.listen(0, '127.0.0.1', r));

process.env.GOOGLE_MAPS_API_KEY = 'test-browser-key';
process.env.GOOGLE_MAPS_MAP_ID = 'test-map-id';
process.env.GEOCODER_PROVIDER = 'google';
process.env.GOOGLE_GEOCODING_API_KEY = 'test-server-key';
process.env.GOOGLE_GEOCODING_URL = `http://127.0.0.1:${fakeGoogle.address().port}/maps/api/geocode/json`;

const { resetDatabase, startServer, shutdown, createUser, login } = await import('./helpers.js');

let server;
let citizen;
before(async () => {
  await resetDatabase();
  server = await startServer();
  citizen = await login(server.base, await createUser({ name: 'Maria Santos' }));
});
after(async () => {
  await shutdown(server);
  fakeGoogle.close();
});

test('public config tells the web client to use Google Maps, without the server key', async () => {
  const res = await fetch(`${server.base}/api/public/config`);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.map.provider, 'google');
  assert.equal(body.map.google_api_key, 'test-browser-key');
  assert.equal(body.map.google_map_id, 'test-map-id');
  assert.ok(body.tiles.url, 'OpenStreetMap tiles stay configured as the fallback');
  assert.ok(!text.includes('test-server-key'), 'geocoding key is never sent to browsers');
});

test('Content-Security-Policy allows the Google Maps hosts', async () => {
  const res = await fetch(`${server.base}/api/public/config`);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self' https:\/\/\*\.googleapis\.com https:\/\/\*\.gstatic\.com/);
  assert.match(csp, /img-src [^;]*https:\/\/\*\.googleapis\.com/);
  assert.match(csp, /img-src [^;]*tile\.openstreetmap\.org/);
  assert.match(csp, /connect-src 'self' https:\/\/\*\.googleapis\.com/);
  assert.match(csp, /frame-src \*\.google\.com/);
  assert.match(csp, /frame-ancestors 'none'/);
});

test('address search uses Google Geocoding with the server-side key', async () => {
  const res = await citizen.get('/api/geo/search?q=Paseo%20del%20Congreso');
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const [item] = res.data.items;
  assert.deepEqual(item, {
    label: 'Paseo del Congreso, Catmon, Malolos, Bulacan, Philippines',
    latitude: 14.8445,
    longitude: 120.8102,
    road_name: 'Paseo del Congreso',
    barangay: 'Catmon',
    city: 'Malolos',
  });
  const call = hits.at(-1);
  assert.equal(call.searchParams.get('key'), 'test-server-key');
  assert.equal(call.searchParams.get('address'), 'Paseo del Congreso');
  assert.equal(call.searchParams.get('components'), 'country:PH');
  assert.ok(!JSON.stringify(res.data).includes('test-server-key'));
  const n = hits.length;
  await citizen.get('/api/geo/search?q=paseo%20del%20congreso');
  assert.equal(hits.length, n, 'repeat search served from cache');
});

test('reverse geocoding uses Google too', async () => {
  const res = await citizen.get('/api/geo/reverse?lat=14.8445&lng=120.8102');
  assert.equal(res.status, 200);
  assert.equal(res.data.result.road_name, 'Paseo del Congreso');
  assert.equal(hits.at(-1).searchParams.get('latlng'), '14.8445,120.8102');
});

test('a rejected Google key gives a generic 503 without Google’s error text', async () => {
  mode = 'denied';
  const res = await citizen.get('/api/geo/search?q=Some%20other%20place');
  assert.equal(res.status, 503);
  assert.match(res.data.error.message, /Pin the location on the map/);
  assert.ok(!JSON.stringify(res.data).includes('API key'));
  mode = 'ok';
});
