// Browser test of the Google Maps integration: `npm run test:e2e:google`.
// The real Google servers are not contacted: requests for the Maps
// JavaScript API are answered with tests/e2e/google-maps-stub.js, so this
// checks that Wayguard loads the API correctly and drives it (markers,
// pin picking, dragging, GPS circle, directions links) and that it falls
// back to OpenStreetMap when Google rejects the key or cannot be reached.
// It does not prove that a particular Google API key works; see
// docs/08-deployment.md for that check.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.GOOGLE_MAPS_API_KEY = 'e2e-browser-key';
process.env.GOOGLE_MAPS_MAP_ID = 'e2e-map-id';
process.env.GEOCODER_ENABLED = 'false';

const here = path.dirname(fileURLToPath(import.meta.url));
const stub = fs.readFileSync(path.join(here, 'google-maps-stub.js'), 'utf8');
const { resetDatabase, startServer, shutdown, createUser, createTeam, login, submitReport, config } = await import(
  '../../server/tests/helpers.js'
);
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm install --no-save playwright && npx playwright install chromium');
  process.exit(1);
}
if (!fs.existsSync(config.clientDist)) {
  console.error('The web client is not built. Run `npm run build` first.');
  process.exit(1);
}

// 1x1 PNG answered for OpenStreetMap tile requests (no internet needed).
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const results = [];
const consoleErrors = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push(false);
    console.log(`  ✗ ${name}\n      ${err.message.split('\n')[0]}`);
  }
}

await resetDatabase();
const server = await startServer();
const base = server.base;
const browser = await chromium.launch();

async function newPage({ mode = 'ok', mobile = false, geo = null } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 },
    geolocation: geo || undefined,
    permissions: geo ? ['geolocation'] : [],
  });
  if (mode === 'auth-failure') await context.addInitScript(() => (window.__gmMode = 'auth-failure'));
  await context.route(/^https:\/\/maps\.googleapis\.com\/maps\/api\/js/, (route) =>
    mode === 'blocked' ? route.abort() : route.fulfill({ status: 200, contentType: 'text/javascript', body: stub }),
  );
  await context.route(/tile\.openstreetmap\.org/, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(`${mode}: ${m.text()}`));
  page.on('pageerror', (e) => consoleErrors.push(`${mode}: ${e.message}`));
  page.setDefaultTimeout(8000);
  return page;
}

try {
  // A verified report so the public map has something to show.
  const admin = await login(base, await createUser({ role: 'admin', password: 'AdminPass123' }));
  const citizenUser = await createUser({ name: 'Maria Santos', password: 'CitizenPass1' });
  const reporter = await login(base, citizenUser);
  const team = await createTeam('Road Crew Alpha');
  const crewUser = await createUser({ role: 'maintenance', teamId: team.id, password: 'CrewPass123' });
  const { data } = await submitReport(reporter, { latitude: '14.84405', longitude: '120.81215', road_name: 'Paseo del Congreso' });
  const report = data.report;
  await admin.post(`/api/admin/reports/${report.id}/review`, {});
  await admin.post(`/api/admin/reports/${report.id}/verify`, {});
  await admin.post(`/api/admin/reports/${report.id}/assign`, { team_id: team.id });

  console.log('\nGoogle Maps');
  const page = await newPage();
  await step('public map loads the Maps JavaScript API with the browser key and Map ID', async () => {
    await page.goto(`${base}/map`);
    await page.locator('.gm-stub .wg-bubble').first().waitFor();
    const gm = await page.evaluate(() => ({ url: window.__gm.url, mapId: window.__gm.maps[0].opts.mapId }));
    const url = new URL(gm.url);
    if (url.searchParams.get('key') !== 'e2e-browser-key') throw new Error(`key ${url.searchParams.get('key')}`);
    for (const [k, v] of [['libraries', 'marker'], ['loading', 'async'], ['v', 'weekly']]) {
      if (url.searchParams.get(k) !== v) throw new Error(`${k}=${url.searchParams.get(k)}`);
    }
    if (gm.mapId !== 'e2e-map-id') throw new Error(`mapId ${gm.mapId}`);
    if (await page.locator('.leaflet-container').count()) throw new Error('Leaflet map also shown');
  });
  await step('report markers use the Wayguard pin and are clickable', async () => {
    const marker = page.locator('.gm-stub-marker[role=button]').first();
    const title = await marker.getAttribute('title');
    if (!title.startsWith(report.code)) throw new Error(`title ${title}`);
    await marker.click();
    await page.locator('.gm-stub .wg-bubble--selected').waitFor();
  });
  await step('footer credits Google instead of OpenStreetMap', async () => {
    await page.goto(`${base}/`);
    await page.getByText('Maps © Google.').waitFor();
  });

  const citizen = await newPage({ mobile: true, geo: { latitude: 14.8501, longitude: 120.8222, accuracy: 9 } });
  await step('citizen places the pin by clicking the map and drags it', async () => {
    await citizen.goto(`${base}/login`);
    await citizen.getByLabel('E-mail').fill(citizenUser.email);
    await citizen.getByLabel('Password', { exact: true }).fill('CitizenPass1');
    await citizen.getByRole('button', { name: 'Sign in' }).click();
    await citizen.waitForURL('**/app');
    await citizen.goto(`${base}/app/report`);
    await citizen.locator('.gm-stub').first().waitFor();
    await citizen.evaluate(() => window.__gm.maps.at(-1).layer.click());
    await citizen.getByText('pinned on the map').waitFor();
    await citizen.locator('.gm-stub .wg-gpick').waitFor();
    await citizen.evaluate(() => window.__gm.markers.find((m) => m.gmpDraggable).__drag(14.8412, 120.8104));
    await citizen.getByText('14.84120, 120.81040').waitFor();
  });
  await step('GPS location draws the accuracy circle', async () => {
    await citizen.getByRole('button', { name: 'Use my current location' }).click();
    await citizen.getByText('from GPS, accurate to about 9 m').waitFor();
    const r = await citizen.evaluate(() => window.__gm.circles.filter((c) => c.o.map).map((c) => c.o.radius));
    if (!r.includes(9)) throw new Error(`circles ${JSON.stringify(r)}`);
  });

  const crew = await newPage({ mobile: true });
  await step('crew task links open directions in Google Maps', async () => {
    await crew.goto(`${base}/login`);
    await crew.getByLabel('E-mail').fill(crewUser.email);
    await crew.getByLabel('Password', { exact: true }).fill('CrewPass123');
    await crew.getByRole('button', { name: 'Sign in' }).click();
    await crew.waitForURL('**/crew');
    await crew.goto(`${base}/crew/tasks/${report.id}`);
    const dir = await crew.getByRole('link', { name: 'Directions' }).getAttribute('href');
    if (dir !== 'https://www.google.com/maps/dir/?api=1&destination=14.84405,120.81215&travelmode=driving') throw new Error(dir);
    await crew.getByRole('link', { name: 'Google Maps' }).waitFor();
  });

  console.log('\nFallback to OpenStreetMap');
  for (const mode of ['auth-failure', 'blocked']) {
    const p = await newPage({ mode });
    await step(`${mode === 'blocked' ? 'blocked Google script' : 'rejected API key'} switches maps to OpenStreetMap with a notice`, async () => {
      await p.goto(`${base}/map`);
      await p.locator('.leaflet-container').waitFor();
      await p.getByText('Google Maps could not load, so OpenStreetMap is shown instead.').waitFor();
      await p.locator('.leaflet-marker-icon.wg-bubble').first().waitFor();
    });
  }

  await step('no unexpected browser console errors', async () => {
    // A blocked script is reported by the browser itself; that one is expected.
    const unexpected = consoleErrors.filter((e) => !(e.startsWith('blocked:') && /ERR_FAILED|net::/.test(e)));
    if (unexpected.length) throw new Error(unexpected.join(' | '));
  });
} finally {
  await browser.close();
  await shutdown(server);
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed} passed, ${results.length - passed} failed.`);
process.exit(passed === results.length ? 0 : 1);
