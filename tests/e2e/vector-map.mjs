// Browser test of the Waze-style map screen: `npm run test:e2e:map`.
// Uses the default vector road map against a local synthetic tile service
// (tests/e2e/vector-fixture.mjs), so no internet is needed.
import fs from 'node:fs';
import { startVectorFixture } from './vector-fixture.mjs';

const tiles = await startVectorFixture();
process.env.MAP_PROVIDER = 'vector';
process.env.GOOGLE_MAPS_API_KEY = '';
process.env.MAP_VECTOR_TILEJSON_URL = tiles.tilejson;
process.env.MAP_GLYPHS_URL = tiles.glyphs;
process.env.GEOCODER_ENABLED = 'false';

const { resetDatabase, startServer, shutdown, createUser, login, submitReport, config } = await import('../../server/tests/helpers.js');
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
const WEBGL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: WEBGL });

async function newPage({ mobile = true, geo = null, blockTiles = false } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 860 },
    isMobile: mobile,
    hasTouch: mobile,
    geolocation: geo || undefined,
    permissions: geo ? ['geolocation'] : [],
  });
  if (blockTiles) await context.route(`${tiles.base}/**`, (r) => r.abort());
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await context.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: png }));
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(`${blockTiles ? 'blocked' : 'ok'}: ${m.text()}`));
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.setDefaultTimeout(10_000);
  return page;
}

try {
  const admin = await login(base, await createUser({ role: 'admin' }));
  const citizen = await login(base, await createUser({ name: 'Maria Santos' }));
  const codes = [];
  for (const [lat, lng, road, sev] of [
    ['14.85090', '120.81520', 'Test Avenue', 'high'],
    ['14.85210', '120.81620', 'Congress Road', 'low'],
  ]) {
    const { data } = await submitReport(citizen, { latitude: lat, longitude: lng, road_name: road, severity: sev });
    await admin.post(`/api/admin/reports/${data.report.id}/review`, {});
    await admin.post(`/api/admin/reports/${data.report.id}/verify`, {});
    codes.push(data.report.code);
  }

  console.log('\nWaze-style map screen (phone)');
  const page = await newPage({ geo: { latitude: 14.8503, longitude: 120.8149, accuracy: 12 } });
  await step('opens full screen on the vector road map with report bubbles', async () => {
    await page.goto(`${base}/map`);
    await page.locator('.mapscreen .maplibregl-canvas').waitFor();
    await page.locator('.wg-bubble[role=button]').first().waitFor();
    const n = await page.locator('.wg-bubble[role=button]').count();
    if (n !== 2) throw new Error(`${n} bubbles`);
    const box = await page.locator('.mapscreen').boundingBox();
    if (box.height < 600) throw new Error(`map only ${box.height}px tall`);
    for (let i = 0; i < 40 && (tiles.hits.tiles === 0 || tiles.hits.glyphs === 0); i += 1) await page.waitForTimeout(250);
    if (tiles.hits.tiles === 0 || tiles.hits.glyphs === 0) throw new Error(`fixture hits ${JSON.stringify(tiles.hits)}`);
  });
  await step('every bubble sits exactly on its map position (no stacking offset)', async () => {
    const off = await page.evaluate(() =>
      [...document.querySelectorAll('.maplibregl-marker.wg-bubble')].map((el) => {
        const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform);
        const box = el.closest('.maplibregl-map').getBoundingClientRect();
        const r = el.getBoundingClientRect();
        return Math.max(Math.abs(r.left + r.width / 2 - box.left - Number(m[1])), Math.abs(r.bottom - box.top - Number(m[2])));
      }),
    );
    if (!off.length || Math.max(...off) > 2) throw new Error(`offsets ${off.map((o) => o.toFixed(1)).join(', ')}`);
  });
  await step('tapping a bubble slides up its details', async () => {
    await page.getByRole('button', { name: new RegExp(`^${codes[0]}`) }).click();
    await page.locator('.mapsheet').getByRole('heading', { name: codes[0] }).waitFor();
    await page.locator('.wg-bubble--selected').waitFor();
    await page.getByRole('button', { name: 'Close details' }).click();
    await page.locator('.mapsheet').getByText('2 reports on the map').waitFor();
  });
  await step('search finds a report by road name', async () => {
    await page.getByRole('searchbox', { name: 'Search' }).fill('congress');
    await page.getByRole('option', { name: new RegExp(codes[1]) }).click();
    await page.locator('.mapsheet').getByRole('heading', { name: codes[1] }).waitFor();
    await page.keyboard.press('Escape');
  });
  await step('the list sheet is the text alternative to the map', async () => {
    await page.getByRole('button', { name: /reports on the map/ }).click();
    for (const c of codes) await page.locator('.mapsheet .map-list').getByText(c).waitFor();
    await page.locator('.mapsheet .map-legend').waitFor();
  });
  await step('"Show my location" puts the you-are-here puck on the map and distances in the list', async () => {
    await page.getByRole('button', { name: 'Show my location' }).click();
    await page.locator('.wg-me').waitFor();
    await page.locator('.mapsheet .map-list').getByText(/\d+ m$/).first().waitFor();
  });
  await step('3D button tilts the map and back', async () => {
    await page.getByRole('button', { name: '3D' }).click();
    await page.getByRole('button', { name: '2D' }).waitFor();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: '2D' }).click();
    await page.getByRole('button', { name: '3D' }).waitFor();
  });
  await step('Report button asks for severity and sends visitors to sign up first', async () => {
    await page.locator('.report-fab').click();
    await page.getByRole('heading', { name: 'Report a pothole here' }).waitFor();
    if ((await page.getByRole('radio', { name: /Where I am/ }).getAttribute('aria-checked')) !== 'true') throw new Error('GPS not preselected');
    const href = await page.getByRole('link', { name: /^Medium/ }).getAttribute('href');
    const next = decodeURIComponent(new URL(href, base).searchParams.get('next'));
    if (!href.startsWith('/register?next=') || !next.includes('severity=medium') || !next.includes('src=gps')) throw new Error(href);
    await page.keyboard.press('Escape');
    await page.locator('.report-fab').waitFor();
  });

  console.log('\nDay / night and drive mode');
  await step('night map by default; the sun button switches to day and is remembered', async () => {
    await page.locator('.mapscreen--night').waitFor();
    const toggle = page.getByRole('button', { name: /reports on the map/ });
    if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
    await page.getByRole('button', { name: 'Switch to day map' }).click();
    await page.locator('.mapscreen--day').waitFor();
    await page.reload();
    await page.locator('.mapscreen--day .maplibregl-canvas').waitFor();
    await page.getByRole('button', { name: 'Switch to night map' }).click();
    await page.locator('.mapscreen--night').waitFor();
  });
  const driver = await newPage({ geo: { latitude: 14.847, longitude: 120.8152, accuracy: 8 } });
  await step('drive mode: heading arrow, speed and a "Pothole ahead" alert', async () => {
    await driver.goto(`${base}/map`);
    await driver.locator('.maplibregl-canvas').waitFor();
    await driver.getByRole('button', { name: 'Start drive mode' }).click();
    await driver.locator('.mapscreen--drive').waitFor();
    if (await driver.locator('.mapscreen__top').isVisible()) throw new Error('search still shown while driving');
    for (let i = 1; i <= 5; i += 1) {
      await driver.context().setGeolocation({ latitude: 14.847 + i * 0.0006, longitude: 120.8152, accuracy: 8 });
      await driver.waitForTimeout(700);
    }
    await driver.locator('.drive-alert', { hasText: 'Pothole ahead' }).waitFor();
    await driver.locator('.drive-alert', { hasText: 'High severity' }).waitFor();
    const kmh = Number(await driver.locator('.speed-bubble__value').textContent());
    if (!(kmh > 0)) throw new Error(`speed ${kmh}`);
    const me = await driver.locator('.wg-me.wg-me--drive').boundingBox();
    const map = await driver.locator('.mapscreen').boundingBox();
    if (!me || me.y < map.y || me.y > map.y + map.height) throw new Error('arrow not on screen');
  });
  await step('dragging the map stops following; Recenter brings it back; Stop ends drive mode', async () => {
    const box = await driver.locator('.mapscreen__canvas').boundingBox();
    await driver.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await driver.mouse.down();
    await driver.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 8 });
    await driver.mouse.up();
    await driver.getByRole('button', { name: 'Recenter on my position' }).click();
    await driver.getByRole('button', { name: 'Recenter on my position' }).waitFor({ state: 'detached' });
    await driver.locator('.mapsheet').getByRole('button', { name: 'Stop' }).click();
    await driver.locator('.mapscreen--drive').waitFor({ state: 'detached' });
    await driver.locator('.mapscreen__top').waitFor();
  });

  console.log('\nFallback');
  const blocked = await newPage({ mobile: false, blockTiles: true });
  await step('when vector tiles cannot load, the map switches to OpenStreetMap raster tiles with a notice', async () => {
    await blocked.goto(`${base}/map`);
    await blocked.locator('.leaflet-container').waitFor();
    await blocked.getByText('The road map could not load, so the basic OpenStreetMap map is shown instead.').waitFor();
    await blocked.locator('.leaflet-marker-icon.wg-bubble').first().waitFor();
    const off = await blocked.evaluate(() =>
      [...document.querySelectorAll('.leaflet-marker-icon.wg-bubble')].map((el) => {
        const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(el.style.transform);
        const pane = el.parentElement.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        return Math.max(Math.abs(r.left - pane.left - Number(m[1]) - parseFloat(el.style.marginLeft)), Math.abs(r.top - pane.top - Number(m[2]) - parseFloat(el.style.marginTop)));
      }),
    );
    if (Math.max(...off) > 2) throw new Error(`Leaflet bubble offsets ${off.join(', ')}`);
    await blocked.locator('.report-fab').waitFor();
  });

  await step('no unexpected browser console errors', async () => {
    const unexpected = consoleErrors.filter((e) => !(e.startsWith('blocked:') && /ERR_FAILED|net::/.test(e)));
    if (unexpected.length) throw new Error(unexpected.join(' | '));
  });
} finally {
  await browser.close();
  await shutdown(server);
  await tiles.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed} passed, ${results.length - passed} failed.`);
process.exit(passed === results.length ? 0 : 1);
