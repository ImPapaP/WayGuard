// Loads clearly-labelled DEMONSTRATION data for presenting Wayguard:
// agencies, 4 road crews, 15 demo accounts and ~116 reports in every
// workflow stage across Malolos.
//
//   npm run db:seed            add demo data (skips if already present)
//   npm run db:seed -- --fresh remove previous demo data first, then add it
//   npm run db:seed:auto       used at start-up on hosting (Render): does
//                              nothing unless DEMO_DATA=on; DEMO_DATA=remove
//                              deletes the demo data again. Never stops the
//                              app from starting.
//
// Every demo account uses the password from SEED_DEMO_PASSWORD (nothing is
// hard-coded). Demo accounts use @demo.wayguard.test addresses, demo reports
// are flagged is_demo = TRUE and shown with a "Demo" tag in the app, and their
// photos are generated illustrations labelled "DEMO PHOTO".
// With NODE_ENV=production it only runs when DEMO_DATA=on is set explicitly.
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { config } from '../src/config.js';
import { getSql, closeSql } from '../src/db/index.js';
import { hashPassword } from '../src/lib/security.js';
import { storePhoto, removePhotoFiles } from '../src/services/photos.js';
import { STATUS_LABELS } from '../src/services/notifications.js';

const DEMO_DOMAIN = 'demo.wayguard.test';
const DAY = 86_400_000;

// Deterministic pseudo-random numbers so every seed run looks the same.
let seed = 20261012;
function rand() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}

async function demoPhoto(kind, label) {
  const w = 1200;
  const h = 800;
  const specks = Array.from({ length: 420 }, () => {
    const x = Math.round(rand() * w);
    const y = Math.round(rand() * h);
    const r = (rand() * 2.6 + 0.6).toFixed(1);
    const g = Math.round(70 + rand() * 60);
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="rgb(${g},${g},${g + 4})"/>`;
  }).join('');
  const cx = 520 + Math.round(rand() * 160);
  const cy = 430 + Math.round(rand() * 80);
  const hole =
    kind === 'after'
      ? `<rect x="${cx - 230}" y="${cy - 120}" width="460" height="240" rx="18" fill="#2a2d33" stroke="#1d1f24" stroke-width="6"/>`
      : `<ellipse cx="${cx}" cy="${cy}" rx="${170 + Math.round(rand() * 70)}" ry="${80 + Math.round(rand() * 40)}" fill="#24221f"/>
         <ellipse cx="${cx + 10}" cy="${cy + 8}" rx="120" ry="52" fill="#3b4a55" opacity="${kind === 'report' ? 0.6 : 0.3}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="#5b5e63"/>
    ${specks}
    <rect x="0" y="${h - 140}" width="${w}" height="10" fill="#d9d4c3" opacity="0.8"/>
    <rect x="80" y="370" width="160" height="16" fill="#f2c94c" opacity="0.85"/>
    <rect x="980" y="370" width="160" height="16" fill="#f2c94c" opacity="0.85"/>
    ${hole}
    <rect x="0" y="0" width="${w}" height="92" fill="#061429" opacity="0.88"/>
    <text x="40" y="60" font-family="Helvetica, Arial, sans-serif" font-size="40" font-weight="700" fill="#FAAE0B">DEMO PHOTO</text>
    <text x="330" y="60" font-family="Helvetica, Arial, sans-serif" font-size="30" fill="#F5F7FA">${label}</text>
  </svg>`;
  const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
  return storePhoto(new Blob([buf], { type: 'image/jpeg' }));
}

const AGENCIES = [
  ['City Engineering Office (Demo)', 'city_municipal', 'engineering@demo.wayguard.test', '(044) 000 0001'],
  ['DPWH District Engineering Office (Demo)', 'national', 'dpwh@demo.wayguard.test', '(044) 000 0002'],
  ['Provincial Engineering Office (Demo)', 'provincial', null, '(044) 000 0003'],
  ['Barangay Road Maintenance (Demo)', 'barangay', null, null],
];

const USERS = [
  ['admin', 'Ana Reyes', 'admin', null],
  ['admin2', 'Carlo Bautista', 'admin', null],
  ['crew.alpha', 'Ramon Cruz', 'maintenance', 'Road Crew Alpha'],
  ['crew.bravo', 'Lito Garcia', 'maintenance', 'Road Crew Bravo'],
  ['crew.charlie', 'Edwin Castillo', 'maintenance', 'Road Crew Charlie'],
  ['crew.delta', 'Noel Aguilar', 'maintenance', 'Road Crew Delta'],
  ['maria', 'Maria Santos', 'citizen', null],
  ['juan', 'Juan Dela Cruz', 'citizen', null],
  ['liza', 'Liza Mendoza', 'citizen', null],
  ['ben', 'Benjie Villanueva', 'citizen', null],
  ['grace', 'Grace Aquino', 'citizen', null],
  ['mark', 'Mark Soriano', 'citizen', null],
  ['joy', 'Joy Pascual', 'citizen', null],
  ['paolo', 'Paolo Ramos', 'citizen', null],
  ['rose', 'Rosalie Torres', 'citizen', null],
];
const TEAMS = [...new Set(USERS.map((u) => u[3]).filter(Boolean))];
const TEAM_CREW = Object.fromEntries(USERS.filter((u) => u[3]).map((u) => [u[3], u[0]]));

// [reporter, status, days ago, severity, road, barangay, landmark, lat, lng, road type, hazards, extra]
const REPORTS = [
  ['maria', 'submitted', 0.2, 'high', 'Paseo del Congreso', 'Catmon', 'In front of the cathedral gate', 14.84352, 120.81152, 'city_municipal', ['deep', 'motorcycle_risk']],
  ['juan', 'submitted', 0.6, 'high', 'Paseo del Congreso', 'Catmon', 'Across the cathedral', 14.84361, 120.81160, 'city_municipal', ['deep']],
  ['liza', 'submitted', 1.1, 'medium', 'MacArthur Highway', 'Longos', 'Near the jeepney terminal', 14.85305, 120.81972, 'national', ['wide', 'causes_swerving']],
  ['maria', 'submitted', 1.8, 'low', 'Mabini Street', 'Santo Niño', 'Beside the sari-sari store', 14.84187, 120.80945, 'barangay', []],
  ['juan', 'submitted', 2.4, 'medium', 'Gov. F. Halili Avenue', 'Mojon', 'Corner of the gas station', 14.86240, 120.81655, 'provincial', ['water_filled']],
  ['liza', 'under_review', 3.0, 'high', 'Bulihan Road', 'Bulihan', 'Near the elementary school', 14.86975, 120.82410, 'city_municipal', ['near_school_or_crossing', 'deep']],
  ['maria', 'under_review', 3.5, 'medium', 'Sumapang Matanda Road', 'Sumapang Matanda', 'Beside the covered court', 14.85640, 120.81020, 'barangay', ['poor_lighting']],
  ['juan', 'under_review', 4.2, 'low', 'Santo Rosario Street', 'Santo Rosario', 'Near the plaza', 14.84630, 120.80860, 'city_municipal', []],
  ['liza', 'verified', 5.0, 'high', 'MacArthur Highway', 'Tikay', 'Southbound lane by the overpass', 14.85960, 120.82815, 'national', ['deep', 'damaged_vehicles']],
  ['maria', 'verified', 6.5, 'medium', 'Pinagbakahan Road', 'Pinagbakahan', 'Near the barangay hall', 14.86630, 120.80520, 'barangay', ['water_filled']],
  ['juan', 'verified', 7.0, 'low', 'Caingin Road', 'Caingin', 'Before the bridge', 14.83620, 120.81800, 'city_municipal', []],
  ['maria', 'assigned', 8.0, 'high', 'Paseo del Congreso', 'San Gabriel', 'Barasoain Church side street', 14.84660, 120.81255, 'city_municipal', ['deep', 'motorcycle_risk'], { team: 'Road Crew Alpha', due: 5 }],
  ['liza', 'assigned', 9.0, 'medium', 'Guinhawa Road', 'Guinhawa', 'Near the rice mill', 14.85180, 120.80310, 'city_municipal', ['wide'], { team: 'Road Crew Bravo', due: 7 }],
  ['juan', 'assigned', 10.0, 'medium', 'Dakila Road', 'Dakila', 'Beside the chapel', 14.85875, 120.79905, 'barangay', [], { team: 'Road Crew Alpha', due: 10 }],
  ['maria', 'in_progress', 12.0, 'high', 'MacArthur Highway', 'Mojon', 'Near the mall entrance', 14.86415, 120.82155, 'national', ['deep', 'causes_swerving'], { team: 'Road Crew Alpha', due: 2, progress: true }],
  ['juan', 'in_progress', 13.0, 'medium', 'Atlag Road', 'Atlag', 'Beside the health center', 14.83150, 120.81320, 'city_municipal', ['water_filled'], { team: 'Road Crew Bravo', due: 3, progress: true }],
  ['liza', 'in_progress', 15.0, 'medium', 'Look 1st Road', 'Look 1st', 'Near the basketball court', 14.84050, 120.82480, 'barangay', [], { team: 'Road Crew Alpha', due: -1, progress: true, completed: true }],
  ['maria', 'resolved', 25.0, 'high', 'Paseo del Congreso', 'Catmon', 'Near the municipal hall', 14.84380, 120.81090, 'city_municipal', ['deep'], { team: 'Road Crew Alpha', resolvedAfter: 9, rating: 5, comment: 'Fixed within two weeks. Thank you!' }],
  ['juan', 'resolved', 40.0, 'medium', 'Bulihan Road', 'Bulihan', 'Front of the subdivision gate', 14.86880, 120.82110, 'city_municipal', ['wide'], { team: 'Road Crew Bravo', resolvedAfter: 12, rating: 4, comment: 'Good patch but the edges are a bit rough.' }],
  ['liza', 'resolved', 55.0, 'low', 'Mabini Street', 'Santo Niño', 'Near the bakery', 14.84120, 120.81030, 'barangay', [], { team: 'Road Crew Alpha', resolvedAfter: 20, rating: 3 }],
  ['maria', 'resolved', 75.0, 'high', 'MacArthur Highway', 'Longos', 'Northbound lane near the school', 14.85190, 120.81910, 'national', ['near_school_or_crossing'], { team: 'Road Crew Bravo', resolvedAfter: 6, rating: 5, comment: 'Very fast response.' }],
  ['juan', 'resolved', 100.0, 'medium', 'Gov. F. Halili Avenue', 'Mojon', 'Beside the church', 14.86110, 120.81530, 'provincial', [], { team: 'Road Crew Alpha', resolvedAfter: 15 }],
  ['liza', 'resolved', 130.0, 'medium', 'Santo Rosario Street', 'Santo Rosario', 'Corner of the pharmacy', 14.84560, 120.80790, 'city_municipal', ['water_filled'], { team: 'Road Crew Bravo', resolvedAfter: 18 }],
  ['juan', 'rejected', 20.0, 'low', 'Private Subdivision Road', 'Bulihan', 'Inside the gated village', 14.87210, 120.82690, 'private', [], { reason: 'Private subdivision road — outside LGU jurisdiction. Please contact your homeowners association.' }],
  ['maria', 'rejected', 30.0, 'medium', 'Tikay Road', 'Tikay', 'Near the poultry farm', 14.86470, 120.83400, 'barangay', [], { reason: 'Photo shows a speed bump, not road damage.' }],
  ['liza', 'duplicate', 7.5, 'high', 'Paseo del Congreso', 'San Gabriel', 'Barasoain Church side', 14.84668, 120.81262, 'city_municipal', ['deep'], { duplicateOfIndex: 11 }],
];

// More reports, generated deterministically around real Malolos roads.
const ANCHORS = REPORTS.filter((r) => r[9] !== 'private').map((r) => [r[4], r[5], r[7], r[8], r[9]]);
const LANDMARKS = [
  'Near the tricycle terminal', 'Beside the bakery', 'In front of the barangay hall', 'Near the waiting shed',
  'Across the public market', 'Beside the water refilling station', 'Near the school gate', 'In front of the chapel',
  'Corner of the hardware store', 'Near the drugstore', 'Beside the covered court', 'Before the bridge approach',
  'Near the bus stop', 'In front of the carinderia', 'Beside the rice field', 'Near the subdivision entrance',
];
const HAZARDS = ['deep', 'wide', 'water_filled', 'motorcycle_risk', 'causes_swerving', 'poor_lighting', 'near_school_or_crossing', 'damaged_vehicles'];
const COMMENTS = [
  'Smooth now, salamat po!', 'Quick repair, very happy.', 'Fixed but took a while.', 'Good work by the crew.',
  null, null, 'The patch is a bit uneven but much safer.', 'Thank you for acting on this.',
];
function pick(list) {
  return list[Math.floor(rand() * list.length)];
}
function between(a, b) {
  return a + rand() * (b - a);
}
function generatedReports(count) {
  const citizens = USERS.filter((u) => u[2] === 'citizen').map((u) => u[0]);
  const statuses = [
    ['submitted', 14], ['under_review', 9], ['verified', 9], ['assigned', 12],
    ['in_progress', 12], ['resolved', 34], ['rejected', 5],
  ];
  const total = statuses.reduce((n, [, w]) => n + w, 0);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    let roll = rand() * total;
    const status = statuses.find(([, w]) => (roll -= w) < 0)[0];
    const [road, brgy, lat0, lng0, roadType] = pick(ANCHORS);
    const severity = pick(['high', 'high', 'medium', 'medium', 'medium', 'low', 'low']);
    const hazards = HAZARDS.filter(() => rand() < (severity === 'high' ? 0.3 : 0.12));
    const lat = +(lat0 + between(-0.0035, 0.0035)).toFixed(5);
    const lng = +(lng0 + between(-0.0035, 0.0035)).toFixed(5);
    const team = pick(TEAMS);
    const days = {
      submitted: between(0.05, 3), under_review: between(1, 6), verified: between(3, 10), assigned: between(5, 15),
      in_progress: between(8, 22), resolved: between(14, 170), rejected: between(8, 60),
    }[status];
    let extra = {};
    if (status === 'assigned') extra = { team, due: Math.round(between(-2, 12)) };
    if (status === 'in_progress') extra = { team, due: Math.round(between(-3, 6)), progress: true, completed: rand() < 0.25 };
    if (status === 'resolved') {
      extra = { team, resolvedAfter: Math.round(between(3, Math.min(25, days - 1))) };
      if (rand() < 0.7) Object.assign(extra, { rating: pick([5, 5, 4, 4, 4, 3, 2]), comment: pick(COMMENTS) });
    }
    if (status === 'rejected') {
      extra = { reason: pick(['Photo shows a speed bump, not road damage.', 'Already repaired when inspected.', 'Location is a private driveway — outside LGU jurisdiction.']) };
    }
    out.push([pick(citizens), status, +days.toFixed(2), severity, road, brgy, pick(LANDMARKS), lat, lng, roadType, hazards, extra]);
  }
  return out;
}
REPORTS.push(...generatedReports(90));

const DESCRIPTIONS = {
  high: 'Large, deep pothole across most of the lane. Vehicles brake suddenly to avoid it and motorcycles have nearly fallen.',
  medium: 'Pothole about the size of a tyre. It collects water when it rains and is hard to see at night.',
  low: 'Small pothole near the edge of the road. Not dangerous yet but getting bigger.',
};

// Removes everything created by a previous seed run, including any report
// that demo accounts submitted or worked on while presenting the system.
async function removeDemoData(sql) {
  const demoUsers = sql`SELECT id FROM users WHERE email LIKE ${'%@' + DEMO_DOMAIN}`;
  const touched = sql`
    SELECT r.id FROM reports r
    WHERE r.is_demo
       OR r.reporter_id IN (${demoUsers})
       OR EXISTS (SELECT 1 FROM assignments a WHERE a.report_id = r.id AND a.assigned_by IN (${demoUsers}))
       OR EXISTS (SELECT 1 FROM repair_updates u WHERE u.report_id = r.id AND u.author_id IN (${demoUsers}))
       OR EXISTS (SELECT 1 FROM report_photos p WHERE p.report_id = r.id AND p.uploaded_by IN (${demoUsers}))`;
  const photos = await sql`SELECT storage_key FROM report_photos WHERE report_id IN (${touched})`;
  await sql.begin(async (tx) => {
    // The multi-LGU schema keeps duplicate links inside a tenant and uses
    // RESTRICT on deletion. Clear links to demo reports before removing them.
    const demoReportIds = tx`
      SELECT r.id FROM reports r
      WHERE r.is_demo
         OR r.reporter_id IN (SELECT id FROM users WHERE email LIKE ${'%@' + DEMO_DOMAIN})
         OR EXISTS (SELECT 1 FROM assignments a JOIN users u ON u.id = a.assigned_by WHERE a.report_id = r.id AND u.email LIKE ${'%@' + DEMO_DOMAIN})
         OR EXISTS (SELECT 1 FROM repair_updates ru JOIN users u ON u.id = ru.author_id WHERE ru.report_id = r.id AND u.email LIKE ${'%@' + DEMO_DOMAIN})
         OR EXISTS (SELECT 1 FROM report_photos p JOIN users u ON u.id = p.uploaded_by WHERE p.report_id = r.id AND u.email LIKE ${'%@' + DEMO_DOMAIN})`;
    await tx`
      UPDATE reports r
      SET duplicate_of_id = NULL,
          status = CASE WHEN r.status = 'duplicate' THEN 'under_review' ELSE r.status END,
          updated_at = now()
      WHERE r.id IN (${demoReportIds})
         OR r.duplicate_of_id IN (${demoReportIds})`;
    await tx`DELETE FROM reports WHERE id IN (
      SELECT r.id FROM reports r
      WHERE r.is_demo
         OR r.reporter_id IN (SELECT id FROM users WHERE email LIKE ${'%@' + DEMO_DOMAIN})
         OR EXISTS (SELECT 1 FROM assignments a JOIN users u ON u.id = a.assigned_by WHERE a.report_id = r.id AND u.email LIKE ${'%@' + DEMO_DOMAIN})
         OR EXISTS (SELECT 1 FROM repair_updates ru JOIN users u ON u.id = ru.author_id WHERE ru.report_id = r.id AND u.email LIKE ${'%@' + DEMO_DOMAIN})
         OR EXISTS (SELECT 1 FROM report_photos p JOIN users u ON u.id = p.uploaded_by WHERE p.report_id = r.id AND u.email LIKE ${'%@' + DEMO_DOMAIN}))`;
    await tx`DELETE FROM users WHERE email LIKE ${'%@' + DEMO_DOMAIN}`;
    await tx`DELETE FROM maintenance_teams WHERE name IN ${tx(TEAMS)}
             AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.team_id = maintenance_teams.id)
             AND NOT EXISTS (SELECT 1 FROM users u WHERE u.team_id = maintenance_teams.id)`;
  });
  await removePhotoFiles(photos.map((p) => p.storage_key));
  console.log(`Removed previous demo data (${photos.length} photos).`);
}

const AUTO = process.argv.includes('--auto');
const DEMO_SWITCH = (process.env.DEMO_DATA || '').trim().toLowerCase();

async function main() {
  if (AUTO && !['on', 'remove'].includes(DEMO_SWITCH)) {
    console.log('Demo data: off (set DEMO_DATA=on to load labelled sample data).');
    return;
  }
  if (config.isProduction && !['on', 'remove'].includes(DEMO_SWITCH)) {
    throw new Error('Refusing to load demo data when NODE_ENV=production. Set DEMO_DATA=on to allow it explicitly.');
  }
  const sql = getSql();
  const [existing] = await sql`SELECT 1 FROM users WHERE email = ${`admin@${DEMO_DOMAIN}`}`;
  if (DEMO_SWITCH === 'remove') {
    if (existing) await removeDemoData(sql);
    else console.log('Demo data: nothing to remove.');
    return;
  }
  const password = process.env.SEED_DEMO_PASSWORD || '';
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error('Set SEED_DEMO_PASSWORD (10+ characters with letters and numbers) before loading demo data.');
  }
  const fresh = process.argv.includes('--fresh');
  if (existing && !fresh) {
    console.log('Demo data is already loaded. Use `npm run db:seed -- --fresh` to recreate it.');
    return;
  }
  if (existing) await removeDemoData(sql);
  await fs.mkdir(config.uploadDir, { recursive: true });

  // Photos are written to disk first; if the transaction fails they are removed.
  const storedKeys = [];
  const photo = async (kind, label) => {
    const p = await demoPhoto(kind, label);
    storedKeys.push(p.storage_key);
    return p;
  };

  const hash = await hashPassword(password);
  const now = Date.now();
  try {
    await sql.begin(async (tx) => {
      // Agencies and teams -------------------------------------------------
      const agencyIds = {};
      for (const [name, jurisdiction, email, phone] of AGENCIES) {
        const [a] = await tx`
          INSERT INTO agencies (name, jurisdiction, contact_email, contact_phone) VALUES (${name}, ${jurisdiction}, ${email}, ${phone})
          ON CONFLICT (lgu_id, (lower(name))) DO UPDATE SET jurisdiction = EXCLUDED.jurisdiction RETURNING id`;
        agencyIds[jurisdiction] = a.id;
      }
      const teamIds = {};
      for (const name of TEAMS) {
        const [t] = await tx`
          INSERT INTO maintenance_teams (name, agency_id, description)
          VALUES (${name}, ${agencyIds.city_municipal}, 'Demo maintenance team')
          ON CONFLICT (lgu_id, (lower(name))) DO UPDATE SET is_active = TRUE RETURNING id`;
        teamIds[name] = t.id;
      }

      // Accounts -----------------------------------------------------------
      const userIds = {};
      for (const [local, name, role, team] of USERS) {
        const [u] = await tx`
          INSERT INTO users (email, password_hash, full_name, role, team_id, phone, created_at)
          VALUES (${`${local}@${DEMO_DOMAIN}`}, ${hash}, ${name}, ${role}, ${team ? teamIds[team] : null},
                  ${role === 'citizen' ? '0917 555 0' + String(100 + Object.keys(userIds).length) : null},
                  ${new Date(now - 160 * DAY)})
          RETURNING id`;
        userIds[local] = u.id;
      }
      const adminId = userIds.admin;

      // Settings -----------------------------------------------------------
      const settings = {
        lgu_name: 'City of Malolos (Demo LGU)',
        map_center: { lat: 14.8505, lng: 120.8150, zoom: 14 },
        road_type_agency: {
          national: agencyIds.national,
          provincial: agencyIds.provincial,
          city_municipal: agencyIds.city_municipal,
          barangay: agencyIds.barangay,
        },
      };
      // Update the default tenant's display name while keeping tenant ownership.
      await tx`UPDATE lgus SET name = 'City of Malolos (Demo LGU)', city = 'Malolos', province = 'Bulacan', updated_at = now() WHERE id = 1`;
      // Settings an administrator already saved are kept.
      for (const [key, value] of Object.entries(settings)) {
        await tx`
          INSERT INTO settings (lgu_id, key, value, updated_by) VALUES (1, ${key}, ${tx.json(value)}, ${adminId})
          ON CONFLICT (lgu_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by
          WHERE settings.updated_by IS NULL`;
      }

      // Reports ------------------------------------------------------------
      const reportIds = [];
      for (const [i, spec] of REPORTS.entries()) {
        const [who, status, daysAgo, severity, road, brgy, landmark, lat, lng, roadType, hazards, extra = {}] = spec;
        const reporterId = userIds[who];
        let t = now - daysAgo * DAY;
        // Advances this report's clock by `hours` (never into the future).
        const at = (hours) => {
          t += hours * 3_600_000;
          return new Date(Math.min(t, now - 60_000));
        };
        const created = new Date(t);
        const [{ n }] = await tx`SELECT nextval('report_code_seq')::int AS n`;
        const code = `WG-${created.getFullYear()}-${String(n).padStart(5, '0')}`;
        const agencyId = agencyIds[roadType] ?? null;
        const [r] = await tx`
          INSERT INTO reports (code, reporter_id, description, road_name, barangay, city, landmark, hazards, road_type,
                               reported_severity, severity, latitude, longitude, location_source, location_accuracy_m,
                               agency_id, is_demo, created_at, updated_at)
          VALUES (${code}, ${reporterId}, ${DESCRIPTIONS[severity]}, ${road}, ${brgy}, 'Malolos', ${landmark}, ${hazards},
                  ${roadType}, ${severity}, ${severity}, ${lat}, ${lng}, ${i % 3 === 0 ? 'map' : 'gps'},
                  ${i % 3 === 0 ? null : 6 + (i % 5) * 3}, ${agencyId}, TRUE, ${created}, ${created})
          RETURNING id`;
        reportIds.push(r.id);
        const ev = (type, opts = {}) =>
          tx`INSERT INTO report_events (report_id, actor_id, event_type, from_status, to_status, message, is_public, meta, created_at)
             VALUES (${r.id}, ${opts.actor ?? null}, ${type}, ${opts.from ?? null}, ${opts.to ?? null}, ${opts.message ?? null},
                     ${opts.public ?? true}, ${tx.json(opts.meta || {})}, ${opts.at})`;
        const notify = (userIdsList, title, body, when, type = 'status_changed') =>
          Promise.all(
            userIdsList.map(
              (uid) => tx`INSERT INTO notifications (user_id, report_id, type, title, body, created_at, read_at)
                          VALUES (${uid}, ${r.id}, ${type}, ${title}, ${body}, ${when},
                                  ${when < new Date(now - 2 * DAY) ? when : null})`,
            ),
          );
        const photos = [];
        const addPhoto = async (kind, label, uploader, when, updateId = null) => {
          const p = await photo(kind, `${code} · ${label}`);
          await tx`INSERT INTO report_photos (report_id, uploaded_by, kind, repair_update_id, storage_key, mime_type, width, height, size_bytes, created_at)
                   VALUES (${r.id}, ${uploader}, ${kind}, ${updateId}, ${p.storage_key}, ${p.mime_type}, ${p.width}, ${p.height}, ${p.size_bytes}, ${when})`;
          photos.push(p);
        };

        await addPhoto('report', 'reported damage', reporterId, created);
        if (severity === 'high') await addPhoto('report', 'second angle', reporterId, created);
        await ev('created', { actor: reporterId, to: 'submitted', message: 'Report submitted.', at: created });
        await notify([adminId, userIds.admin2], `New report ${code}`, `${severity} severity pothole on ${road}.`, created, 'report_submitted');

        let current = 'submitted';
        const crew = userIds[TEAM_CREW[extra.team] || 'crew.alpha'];
        const move = async (to, when, message = null, extraSet = {}) => {
          await tx`UPDATE reports SET ${tx({ status: to, updated_at: when, ...extraSet })} WHERE id = ${r.id}`;
          await ev('status_changed', { actor: to === 'in_progress' ? crew : adminId, from: current, to, message, at: when });
          await notify([reporterId], `${code}: ${STATUS_LABELS[to]}`, message || 'Your report status changed.', when);
          current = to;
        };

        // Each step advances the report's clock, so histories are realistic.
        const steps = {
          under_review: async () => move('under_review', at(3)),
          verified: async () => {
            const when = at(4);
            await move('verified', when, null, { verified_at: when });
          },
          assigned: async () => {
            const when = at(6);
            const due = extra.due !== undefined ? new Date(now + extra.due * DAY) : null;
            await tx`INSERT INTO assignments (report_id, team_id, assigned_by, instructions, due_date, assigned_at)
                     VALUES (${r.id}, ${teamIds[extra.team]}, ${adminId}, 'Inspect, cordon off and patch. Upload before/after photos.',
                             ${due ? due.toISOString().slice(0, 10) : null}, ${when})`;
            await move('assigned', when, `Assigned to ${extra.team}.`);
            await notify([crew], `New repair task ${code}`, `${severity} severity pothole on ${road}.`, when, 'task_assigned');
          },
          in_progress: async () => {
            const when = at(20);
            await move('in_progress', when);
            const note = 'Site inspected. Area cordoned off with cones; cold mix ordered.';
            const [u] = await tx`INSERT INTO repair_updates (report_id, author_id, update_type, note, created_at)
                                 VALUES (${r.id}, ${crew}, 'progress', ${note}, ${when}) RETURNING id`;
            await addPhoto('before', 'before repair', crew, when, u.id);
            await ev('repair_progress', { actor: crew, message: note, public: false, at: when });
          },
          completed: async () => {
            const when = at(extra.resolvedAfter ? Math.max(6, extra.resolvedAfter * 24 - 51) : 30);
            const note = 'Pothole cleaned, filled with hot asphalt and compacted. Road reopened.';
            const [u] = await tx`INSERT INTO repair_updates (report_id, author_id, update_type, note, created_at)
                                 VALUES (${r.id}, ${crew}, 'completion', ${note}, ${when}) RETURNING id`;
            await addPhoto('after', 'after repair', crew, when, u.id);
            await tx`UPDATE reports SET work_completed_at = ${when}, updated_at = ${when} WHERE id = ${r.id}`;
            await ev('repair_completed', {
              actor: crew,
              message: 'Repair work was reported as completed and is awaiting LGU verification.',
              at: when,
            });
          },
          resolved: async () => {
            const when = at(18);
            await tx`UPDATE assignments SET is_active = FALSE, ended_at = ${when}, end_reason = 'completed' WHERE report_id = ${r.id} AND is_active`;
            await move('resolved', when, 'Repair verified by the LGU.', { resolved_at: when });
            if (extra.rating) {
              const fbAt = at(30);
              await tx`INSERT INTO feedback (report_id, user_id, rating, comment, created_at)
                       VALUES (${r.id}, ${reporterId}, ${extra.rating}, ${extra.comment || null}, ${fbAt})`;
              await ev('feedback', { actor: reporterId, message: `Reporter rated the repair ${extra.rating}/5.`, meta: { rating: extra.rating }, at: fbAt });
            }
          },
        };
        const order = ['under_review', 'verified', 'assigned', 'in_progress', 'completed', 'resolved'];
        const lastStep = {
          submitted: -1,
          under_review: 0,
          verified: 1,
          assigned: 2,
          in_progress: extra.completed ? 4 : 3,
          resolved: 5,
          rejected: 0,
          duplicate: 0,
        }[status];
        for (let k = 0; k <= lastStep; k += 1) await steps[order[k]]();

        if (status === 'rejected') {
          await move('rejected', at(5), `Reason: ${extra.reason}`, { rejection_reason: extra.reason });
        }
        if (status === 'duplicate') {
          const originalId = reportIds[extra.duplicateOfIndex];
          const [orig] = await tx`SELECT code FROM reports WHERE id = ${originalId}`;
          await move('duplicate', at(5), `It will be tracked under report ${orig.code}.`, { duplicate_of_id: originalId });
        }
        if (i === 0) {
          await ev('duplicate_flagged', {
            message: 'System found 1 possible duplicate within 30 m.',
            public: false,
            at: created,
          });
        }
      }

      await tx`INSERT INTO audit_logs (actor_id, action, target_type, details) VALUES (${adminId}, 'demo.seed', 'system', ${tx.json({ reports: REPORTS.length })})`;
    });
  } catch (err) {
    await removePhotoFiles(storedKeys);
    throw err;
  }

  console.log('\nDemo data loaded (all records are labelled as demo):');
  console.log(`  ${REPORTS.length} reports, ${AGENCIES.length} agencies, ${TEAMS.length} maintenance teams, ${storedKeys.length} demo photos`);
  console.log('\nDemo accounts (password = SEED_DEMO_PASSWORD):');
  for (const [local, name, role, team] of USERS) {
    console.log(`  ${role.padEnd(12)} ${`${local}@${DEMO_DOMAIN}`.padEnd(32)} ${name}${team ? ` (${team})` : ''}`);
  }
}

main()
  .catch((err) => {
    console.error(`Seeding failed: ${err.message}`);
    // At start-up (--auto) a problem with demo data must not keep the app down.
    if (!AUTO) process.exitCode = 1;
  })
  .finally(() => closeSql());
