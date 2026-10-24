// End-to-end test of the complete Wayguard workflow in a real browser:
//   citizen (phone) registers and reports a pothole with GPS and a photo
//   → administrator reviews, verifies and assigns it
//   → crew member (phone) changes temporary password, starts work, posts
//     before photos and submits the repair with after photos
//   → administrator approves the repair
//   → citizen sees the notification and rates the repair
//   → the pothole appears on the public map.
//
// Requirements: `npm run build`, TEST_DATABASE_URL in .env (its data is
// wiped), and Playwright with Chromium:
//   npm install --no-save playwright && npx playwright install chromium
// Run: npm run test:e2e
// Map tiles and the geocoder are answered locally, so the test never calls
// the OpenStreetMap servers. The default Waze-style vector map is drawn from
// a synthetic test town (tests/e2e/vector-fixture.mjs).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startVectorFixture } from './vector-fixture.mjs';

const vectorTiles = await startVectorFixture();
process.env.MAP_PROVIDER = 'vector';
process.env.GOOGLE_MAPS_API_KEY = '';
process.env.MAP_VECTOR_TILEJSON_URL = vectorTiles.tilejson;
process.env.MAP_GLYPHS_URL = vectorTiles.glyphs;

// Stand-in for Nominatim (address search and reverse geocoding).
const geocoder = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'application/json');
  if (u.pathname === '/search') {
    res.end(JSON.stringify([{ display_name: 'Paseo del Congreso, Catmon, Malolos, Bulacan', lat: '14.8436', lon: '120.8113', address: { road: 'Paseo del Congreso', quarter: 'Catmon', city: 'Malolos' } }]));
  } else {
    res.end(JSON.stringify({ display_name: 'Paseo del Congreso, Catmon, Malolos', address: { road: 'Paseo del Congreso', quarter: 'Catmon', city: 'Malolos' } }));
  }
});
await new Promise((r) => geocoder.listen(0, '127.0.0.1', r));
process.env.GEOCODER_ENABLED = 'true';
process.env.GEOCODER_URL = `http://127.0.0.1:${geocoder.address().port}`;
process.env.GEOCODER_MIN_INTERVAL_MS = '50';
process.env.WAYGUARD_DISABLE_RATE_LIMIT = '1';
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'output');
fs.mkdirSync(outDir, { recursive: true });

const helpers = await import('../../server/tests/helpers.js');
const { resetDatabase, startServer, shutdown, createUser, createTeam, createAgency, getSql, config, Client, submitReport } = helpers;
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

const sharp = (await import('sharp')).default;
const photo = async (name, color) => {
  const file = path.join(outDir, name);
  await sharp({ create: { width: 900, height: 600, channels: 3, background: color } }).jpeg().toFile(file);
  return file;
};
const tile = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#ebe8e1' } }).png().toBuffer();

const results = [];
const consoleErrors = [];
const openPages = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name} (${Date.now() - t} ms)`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ✗ ${name}\n      ${err.message.split('\n').slice(0, process.env.E2E_VERBOSE ? 20 : 1).join('\n      ')}`);
    // Save what each browser showed when the step failed.
    if (process.env.E2E_VERBOSE) {
      for (const p of openPages) {
        const anims = await p
          .evaluate(() => [...document.getAnimations()].filter((a) => a.playState === 'running').map((a) => `${a.animationName}@${String(a.effect?.target?.className?.baseVal ?? a.effect?.target?.className).slice(0, 40)}`))
          .catch((e) => [`(eval failed: ${e.message.slice(0, 60)})`]);
        console.log(`      page ${p.url()}: ${anims.length} running animations ${anims.slice(0, 12).join(', ')}`);
      }
    }
    for (const [i, p] of openPages.entries()) {
      await p.screenshot({ path: path.join(outDir, `failure-${i + 1}.png`), fullPage: true }).catch(() => {});
    }
    throw err;
  }
}

async function newPage(browser, { mobile = false, geo = null } = {}) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
    geolocation: geo || undefined,
    permissions: geo ? ['geolocation'] : [],
  });
  await context.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: tile }));
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(`${page.url()}: ${m.text()}`));
  page.on('pageerror', (e) => consoleErrors.push(`${page.url()}: ${e.message}`));
  page.setDefaultTimeout(10_000);
  openPages.push(page);
  return page;
}

async function signIn(page, base, email, password) {
  await page.goto(`${base}/login`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

await resetDatabase();
const server = await startServer();
const base = server.base;
// WebGL through SwiftShader, so the vector map renders in headless Chromium.
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let code;
let reportId;

try {
  const team = await createTeam('Road Crew Alpha');
  const agency = await createAgency('City Engineering Office', 'city_municipal');
  const admin = await createUser({ role: 'admin', name: 'Ana Reyes', password: 'AdminPass123' });
  const crew = await createUser({ role: 'maintenance', teamId: team.id, name: 'Ramon Cruz', password: 'TempCrew123', mustChange: true });
  const before = await photo('before.jpg', '#4d4f55');
  const after = await photo('after.jpg', '#2d2f33');
  const pothole = await photo('pothole.jpg', '#5c5e63');

  console.log('\nCitizen on a phone');
  const citizen = await newPage(browser, { mobile: true, geo: { latitude: 14.84405, longitude: 120.81215, accuracy: 9 } });
  await step('registers a citizen account', async () => {
    await citizen.goto(`${base}/register`);
    await citizen.getByLabel('Full name').fill('Maria Santos');
    await citizen.getByLabel('E-mail').fill('maria.e2e@example.test');
    await citizen.getByLabel('Password', { exact: true }).fill('Lubak2026');
    await citizen.getByLabel('Repeat password').fill('Lubak2026');
    await citizen.getByRole('button', { name: 'Create account' }).click();
    await citizen.waitForURL('**/app/report');
  });
  await step('shows validation errors for an empty report', async () => {
    await citizen.getByRole('button', { name: 'Send report' }).click();
    await citizen.getByText('Set the pothole location with GPS').waitFor();
    await citizen.getByText('Add at least one photo of the pothole.').waitFor();
    await citizen.getByText('Choose how severe the pothole is.').waitFor();
  });
  await step('finds a place by address and fills in the road details', async () => {
    await citizen.getByLabel('Search for an address or landmark').fill('Paseo del Congreso');
    await citizen.getByRole('button', { name: 'Search address' }).click();
    await citizen.getByRole('button', { name: /Paseo del Congreso, Catmon/ }).click();
    await citizen.getByText('from address search').waitFor();
    if ((await citizen.getByLabel('Road or street name').inputValue()) !== 'Paseo del Congreso') throw new Error('road not filled');
    if ((await citizen.getByLabel('Barangay').inputValue()) !== 'Catmon') throw new Error('barangay not filled');
  });
  await step('captures the location with GPS', async () => {
    await citizen.getByRole('button', { name: 'Use my current location' }).click();
    await citizen.getByText('14.84405, 120.81215').waitFor();
    await citizen.getByText('from GPS, accurate to about 9 m').waitFor();
  });
  await step('adds a photo and describes the pothole', async () => {
    await citizen.locator('input[type=file][multiple]').setInputFiles(pothole);
    await citizen.getByRole('img', { name: 'Selected photo 1' }).waitFor();
    await citizen.getByLabel('Road or street name').fill('Paseo del Congreso');
    await citizen.getByLabel('Barangay').fill('Catmon');
    await citizen.getByLabel('Nearest landmark').fill('In front of the cathedral gate');
    await citizen.getByLabel('Type of road').selectOption('city_municipal');
    await citizen.getByLabel('What does it look like?').fill('Deep pothole in the right lane, about a metre wide. Motorcycles swerve into traffic.');
    await citizen.getByText('Danger to motorcycles').click();
    await citizen.locator('label.choice--high').click();
    await citizen.screenshot({ path: path.join(outDir, '01-citizen-form.png'), fullPage: true, timeout: 45_000 });
  });
  await step('submits the report and gets a reference code', async () => {
    await citizen.getByRole('button', { name: 'Send report' }).click();
    await citizen.getByRole('heading', { name: 'Report sent' }).waitFor();
    code = (await citizen.locator('.success-card__code').textContent()).trim();
    if (!/^WG-\d{4}-\d{5}$/.test(code)) throw new Error(`unexpected code ${code}`);
    const [r] = await getSql()`SELECT id, latitude, longitude, location_source, severity FROM reports WHERE code = ${code}`;
    reportId = r.id;
    if (r.location_source !== 'gps' || Math.abs(r.latitude - 14.84405) > 1e-6) throw new Error('GPS location not stored');
  });
  await step('tracks the report on the "My reports" page', async () => {
    await citizen.getByRole('link', { name: 'Track this report' }).click();
    await citizen.getByRole('heading', { name: code }).waitFor();
    await citizen.getByText('Received and waiting for an LGU administrator.').waitFor();
  });

  await step('starts a report from the map: Report button, severity, form pre-filled', async () => {
    await citizen.goto(`${base}/app/map`);
    await citizen.locator('.maplibregl-canvas').waitFor();
    await citizen.locator('.report-fab').click();
    await citizen.getByRole('heading', { name: 'Report a pothole here' }).waitFor();
    await citizen.getByRole('radio', { name: /Map centre/ }).click();
    await citizen.getByRole('link', { name: /^High/ }).click();
    await citizen.waitForURL('**/app/report?**');
    await citizen.getByText('pinned on the map').waitFor();
    if (!(await citizen.locator('label.choice--high input').isChecked())) throw new Error('severity not pre-filled');
  });

  console.log('\nAdministrator on a desktop');
  const lgu = await newPage(browser);
  await step('signs in and sees the new report in the review queue', async () => {
    await signIn(lgu, base, admin.email, 'AdminPass123');
    await lgu.waitForURL('**/admin');
    await lgu.getByText('To review').waitFor();
    await lgu.goto(`${base}/admin/reports?status=submitted`);
    await lgu.getByRole('link', { name: code }).click();
    await lgu.getByRole('heading', { name: code }).waitFor();
  });
  await step('starts the review and verifies with the responsible agency', async () => {
    await lgu.getByRole('button', { name: 'Start review' }).click();
    await lgu.getByRole('button', { name: 'Verify report' }).waitFor();
    await lgu.getByLabel('Responsible agency').selectOption(String(agency.id));
    await lgu.getByRole('button', { name: 'Verify report' }).click();
    await lgu.getByText('Report verified.').waitFor();
  });
  await step('assigns the repair to a maintenance team with a due date', async () => {
    await lgu.getByLabel('Maintenance team').selectOption(String(team.id));
    const due = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await lgu.getByLabel('Due date').fill(due);
    await lgu.getByLabel('Instructions for the crew').fill('Cold patch today, full repair this week.');
    await lgu.getByRole('button', { name: 'Assign repair' }).click();
    await lgu.getByText('Assigned to Road Crew Alpha.', { exact: true }).first().waitFor();
    await lgu.screenshot({ path: path.join(outDir, '02-admin-assigned.png'), fullPage: true, timeout: 45_000 });
  });

  console.log('\nMaintenance crew on a phone');
  const field = await newPage(browser, { mobile: true });
  await step('must replace the temporary password on first sign-in', async () => {
    await signIn(field, base, crew.email, 'TempCrew123');
    await field.getByRole('heading', { name: 'Choose your own password' }).waitFor();
    await field.getByLabel('Current password').fill('TempCrew123');
    await field.getByLabel('New password', { exact: true }).fill('CrewPass456');
    await field.getByLabel('Repeat new password').fill('CrewPass456');
    await field.getByRole('button', { name: 'Save and continue' }).click();
    await field.getByRole('heading', { name: 'Repair tasks' }).waitFor();
  });
  await step('opens the assigned task with directions and instructions', async () => {
    await field.getByRole('link', { name: new RegExp(code) }).click();
    await field.getByText('Cold patch today, full repair this week.').waitFor();
    const href = await field.getByRole('link', { name: 'Directions' }).getAttribute('href');
    if (!href.includes('openstreetmap.org/directions')) throw new Error('no directions link');
  });
  await step('starts work and posts a progress update with a before photo', async () => {
    await field.getByRole('button', { name: 'Start work' }).click();
    await field.getByText('Work started.').waitFor();
    await field.locator('input[type=file][multiple]').setInputFiles(before);
    await field.getByRole('img', { name: 'Selected photo 1' }).waitFor();
    await field.getByLabel('Update').fill('Site inspected and cordoned off with cones.');
    await field.getByRole('button', { name: 'Post update' }).click();
    await field.getByText('Update posted.').waitFor();
  });
  await step('submits the finished repair with an after photo', async () => {
    await field.getByRole('tab', { name: 'Repair finished' }).click();
    await field.getByRole('button', { name: 'Submit repair for verification' }).click();
    await field.getByText('Add at least one photo of the finished repair.').waitFor();
    await field.locator('input[type=file][multiple]').setInputFiles(after);
    await field.getByLabel('Repair notes').fill('Filled with hot asphalt and compacted, 1.0 m x 0.8 m.');
    await field.getByRole('button', { name: 'Submit repair for verification' }).click();
    await field.getByText('Waiting for LGU verification').waitFor();
    await field.screenshot({ path: path.join(outDir, '03-crew-submitted.png'), fullPage: true, timeout: 45_000 });
  });

  console.log('\nAdministrator verifies the repair');
  await step('approves the completed repair and closes the report', async () => {
    await lgu.goto(`${base}/admin/reports?awaiting_completion=true`);
    await lgu.getByRole('link', { name: code }).click();
    await lgu.getByText('Filled with hot asphalt and compacted').first().waitFor();
    await lgu.getByRole('button', { name: 'Approve and close report' }).click();
    await lgu.getByText('Resolved reports are final.').waitFor();
  });

  console.log('\nCitizen follows up');
  await step('receives the status notifications', async () => {
    await citizen.goto(`${base}/app/notifications`);
    for (const label of ['Under Review', 'Verified', 'Assigned', 'In Progress', 'Resolved']) {
      await citizen.getByText(`${code}: ${label}`).waitFor();
    }
  });
  await step('sees the after photo and rates the repair', async () => {
    await citizen.getByText(`${code}: Resolved`).click();
    await citizen.getByRole('heading', { name: 'How was the repair?' }).waitFor();
    await citizen.getByRole('button', { name: /\(After\)/ }).first().waitFor();
    await citizen.getByRole('radio', { name: '5 stars' }).click();
    await citizen.getByLabel('Comment').fill('Fixed within a week, thank you!');
    await citizen.getByRole('button', { name: 'Send feedback' }).click();
    await citizen.getByRole('heading', { name: 'Your feedback' }).waitFor();
    await citizen.screenshot({ path: path.join(outDir, '04-citizen-resolved.png'), fullPage: true, timeout: 45_000 });
  });

  console.log('\nPublic visitor');
  await step('finds the repaired pothole on the public map, without personal data', async () => {
    const visitor = await newPage(browser);
    await visitor.goto(`${base}/map`);
    await visitor.locator('.maplibregl-canvas').waitFor();
    if (await visitor.locator('.leaflet-container').count()) throw new Error('fell back to the raster map');
    if (vectorTiles.hits.tiles === 0) throw new Error('no vector tiles requested');
    await visitor.getByRole('button', { name: new RegExp(code) }).click();
    await visitor.locator('.mapsheet').getByRole('heading', { name: code }).waitFor();
    await visitor.getByText('Repaired', { exact: false }).first().waitFor();
    const text = await visitor.locator('body').innerText();
    if (text.includes('Maria Santos') || text.includes('maria.e2e@example.test')) throw new Error('personal data shown publicly');
  });

  await step('history records every step of the workflow', async () => {
    const events = await getSql()`
      SELECT to_status FROM report_events WHERE report_id = ${reportId} AND event_type = 'status_changed' ORDER BY id`;
    const got = events.map((e) => e.to_status).join(' > ');
    const want = 'under_review > verified > assigned > in_progress > resolved';
    if (got !== want) throw new Error(`got ${got}`);
  });

  console.log('\nAdministrator tools');
  await step('flags a nearby report as a duplicate from the review screen', async () => {
    const a = new Client(base);
    await a.post('/api/auth/register', { full_name: 'Juan Dela Cruz', email: 'juan.e2e@example.test', password: 'Lubak2026' });
    const b = new Client(base);
    await b.post('/api/auth/register', { full_name: 'Liza Mendoza', email: 'liza.e2e@example.test', password: 'Lubak2026' });
    const first = await submitReport(a, { latitude: '14.85200', longitude: '120.82000', road_name: 'MacArthur Highway', barangay: 'Longos' });
    const second = await submitReport(b, { latitude: '14.85210', longitude: '120.82008', road_name: 'MacArthur Hwy', barangay: 'Longos' });
    if (second.data.possible_duplicates !== 1) throw new Error('duplicate not detected');
    await lgu.goto(`${base}/admin/reports?has_duplicates=true`);
    await lgu.getByRole('link', { name: second.data.report.code }).click();
    await lgu.getByRole('heading', { name: 'Possible duplicates' }).waitFor();
    await lgu.getByText('high match').waitFor();
    await lgu.getByRole('button', { name: 'Mark as duplicate' }).click();
    await lgu.getByRole('dialog').getByText(first.data.report.code).click();
    await lgu.getByRole('dialog').getByRole('button', { name: 'Mark as duplicate' }).click();
    await lgu.getByText('Tracked under', { exact: false }).first().waitFor();
    const [row] = await getSql()`SELECT status, duplicate_of_id FROM reports WHERE id = ${second.data.report.id}`;
    if (row.status !== 'duplicate' || row.duplicate_of_id !== first.data.report.id) throw new Error('not linked');
    // Keep the first one for the rejection step
    globalThis.firstExtra = first.data.report;
  });
  await step('rejects a report with a reason shown to the reporter', async () => {
    await lgu.goto(`${base}/admin/reports/${globalThis.firstExtra.id}`);
    await lgu.getByRole('button', { name: 'Reject' }).click();
    await lgu.getByRole('dialog').getByRole('button', { name: 'Reject report' }).click();
    await lgu.getByText('Write at least 5 characters.').waitFor();
    await lgu.getByLabel('Reason shown to the reporter').fill('Outside LGU jurisdiction: national highway, forwarded to DPWH.');
    await lgu.getByRole('dialog').getByRole('button', { name: 'Reject report' }).click();
    await lgu.getByRole('button', { name: 'Reopen for review' }).waitFor();
  });
  await step('creates a staff account with a temporary password', async () => {
    await lgu.goto(`${base}/admin/users`);
    await lgu.getByRole('button', { name: 'Add staff account' }).click();
    const dlg = lgu.getByRole('dialog');
    await dlg.getByLabel('Full name').fill('Lito Garcia');
    await dlg.getByLabel('E-mail').fill('lito.e2e@example.test');
    await dlg.getByLabel('Team').selectOption(String(team.id));
    await dlg.getByRole('button', { name: 'Create account' }).click();
    await lgu.getByText('Account created for Lito Garcia.').waitFor();
    await lgu.getByRole('cell', { name: /Lito Garcia/ }).getByText('Temporary password').waitFor();
  });
  await step('creates a maintenance team and a responsible agency', async () => {
    await lgu.goto(`${base}/admin/teams`);
    await lgu.getByRole('button', { name: 'New team' }).click();
    await lgu.getByRole('dialog').getByLabel('Team name').fill('Road Crew Bravo');
    await lgu.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await lgu.getByText('Team created.').waitFor();
    await lgu.getByRole('button', { name: 'New agency' }).click();
    await lgu.getByRole('dialog').getByLabel('Agency or office name').fill('DPWH District Engineering Office');
    await lgu.getByRole('dialog').getByLabel('Jurisdiction').selectOption('national');
    await lgu.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await lgu.getByText('Agency added.').waitFor();
  });
  await step('changes system settings and sees them on the public site', async () => {
    await lgu.goto(`${base}/admin/settings`);
    await lgu.getByLabel('LGU name').fill('City of Malolos');
    await lgu.getByLabel('Radius in metres').fill('45');
    await lgu.getByRole('button', { name: 'Save settings' }).click();
    await lgu.getByText('Settings saved.').waitFor();
    const visitor = await newPage(browser);
    await visitor.goto(`${base}/`);
    await visitor.getByText('Send a photo and the exact location to City of Malolos.').waitFor();
  });
  await step('downloads CSV, PDF and summary exports', async () => {
    await lgu.goto(`${base}/admin/exports`);
    const [csv] = await Promise.all([lgu.waitForEvent('download'), lgu.getByRole('link', { name: 'Download CSV' }).click()]);
    const csvText = fs.readFileSync(await csv.path(), 'utf8');
    if (!csvText.includes(code) || csvText.includes('maria.e2e@example.test')) throw new Error('CSV content wrong');
    const [pdf] = await Promise.all([lgu.waitForEvent('download'), lgu.getByRole('link', { name: 'Download PDF' }).click()]);
    if (fs.readFileSync(await pdf.path()).subarray(0, 5).toString() !== '%PDF-') throw new Error('PDF invalid');
    const [sum] = await Promise.all([lgu.waitForEvent('download'), lgu.getByRole('link', { name: 'Download summary PDF' }).click()]);
    if (!(await sum.suggestedFilename()).startsWith('wayguard-summary-')) throw new Error('summary missing');
    await lgu.goto(`${base}/admin`);
    await lgu.getByRole('heading', { name: 'Reported and resolved per month' }).waitFor();
    await lgu.screenshot({ path: path.join(outDir, '05-admin-dashboard.png'), fullPage: true, timeout: 45_000 });
  });
  await step('citizen cannot open the admin workspace', async () => {
    await citizen.goto(`${base}/admin`);
    await citizen.waitForURL('**/app');
    const res = await citizen.request.get(`${base}/api/admin/reports`);
    if (res.status() !== 403) throw new Error(`expected 403, got ${res.status()}`);
  });

  await step('no browser console errors', async () => {
    if (consoleErrors.length) throw new Error(consoleErrors.join('\n'));
  });
} catch {
  // reported below
} finally {
  await browser.close();
  await shutdown(server);
  geocoder.close();
  await vectorTiles.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed. Screenshots: tests/e2e/output/`);
process.exit(failed.length ? 1 : 0);
