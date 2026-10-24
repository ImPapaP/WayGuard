// In-browser stand-in for the Wayguard API, used only by the live preview
// build (client/build-preview.mjs). It answers the same /api routes with the
// same JSON shapes and enforces the same roles and workflow rules as
// server/src, using the demo data held in memory (reset when the page
// reloads). The real application always uses the Node.js server.
import { AGENCIES, USERS, REPORTS, DESCRIPTIONS } from './seedData.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
export const PREVIEW_PASSWORD = 'preview';
const DEMO_DOMAIN = 'demo.wayguard.test';

const STATUS_LABELS = {
  submitted: 'Submitted',
  under_review: 'Under Review',
  verified: 'Verified',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  rejected: 'Rejected',
  duplicate: 'Duplicate',
};
const OPEN = ['submitted', 'under_review', 'verified', 'assigned', 'in_progress'];
const PUBLIC = ['verified', 'assigned', 'in_progress', 'resolved'];
const TRANSITIONS = {
  submitted: { under_review: ['admin'], rejected: ['admin'], duplicate: ['admin'] },
  under_review: { verified: ['admin'], rejected: ['admin'], duplicate: ['admin'] },
  verified: { assigned: ['admin'], rejected: ['admin'], duplicate: ['admin'], under_review: ['admin'] },
  assigned: { in_progress: ['maintenance', 'admin'], verified: ['admin'] },
  in_progress: { resolved: ['admin'] },
  resolved: {},
  rejected: { under_review: ['admin'] },
  duplicate: { under_review: ['admin'] },
};

class ApiErr extends Error {
  constructor(status, message, code = 'error', fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}
const bad = (m, fields) => new ApiErr(400, m, fields ? 'validation_error' : 'bad_request', fields);
const notFound = (m = 'Not found.') => new ApiErr(404, m, 'not_found');
const conflict = (m, code = 'conflict') => new ApiErr(409, m, code);

// ---------------------------------------------------------------- photos
// Demo photos are drawn as small SVG illustrations stamped "DEMO PHOTO".
let seedRand = 20261012;
function rand() {
  seedRand = (seedRand * 1664525 + 1013904223) % 4294967296;
  return seedRand / 4294967296;
}
function demoPhoto(kind, label) {
  const cx = 300 + Math.round(rand() * 80);
  const cy = 215 + Math.round(rand() * 40);
  const specks = Array.from({ length: 60 }, () => {
    const g = Math.round(70 + rand() * 60);
    return `<circle cx="${Math.round(rand() * 600)}" cy="${Math.round(rand() * 400)}" r="${(rand() * 1.6 + 0.6).toFixed(1)}" fill="rgb(${g},${g},${g + 4})"/>`;
  }).join('');
  const hole =
    kind === 'after'
      ? `<rect x="${cx - 115}" y="${cy - 60}" width="230" height="120" rx="9" fill="#2a2d33" stroke="#1d1f24" stroke-width="3"/>`
      : `<ellipse cx="${cx}" cy="${cy}" rx="${85 + Math.round(rand() * 35)}" ry="${40 + Math.round(rand() * 20)}" fill="#24221f"/><ellipse cx="${cx + 5}" cy="${cy + 4}" rx="60" ry="26" fill="#3b4a55" opacity="0.55"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" width="600" height="400"><rect width="600" height="400" fill="#5b5e63"/>${specks}<rect y="330" width="600" height="5" fill="#d9d4c3" opacity="0.8"/><rect x="40" y="185" width="80" height="8" fill="#f2c94c" opacity="0.85"/><rect x="490" y="185" width="80" height="8" fill="#f2c94c" opacity="0.85"/>${hole}<rect width="600" height="46" fill="#061429" opacity="0.88"/><text x="20" y="31" font-family="Helvetica,Arial,sans-serif" font-size="20" font-weight="700" fill="#FAAE0B">DEMO PHOTO</text><text x="168" y="31" font-family="Helvetica,Arial,sans-serif" font-size="15" fill="#F5F7FA">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ---------------------------------------------------------------- store
const db = {
  users: [],
  teams: [],
  agencies: [],
  reports: [],
  photos: [],
  events: [],
  assignments: [],
  updates: [],
  notifications: [],
  feedback: [],
  audit: [],
  settings: {
    lgu_name: 'City of Malolos (Demo LGU)',
    duplicate_radius_m: 30,
    duplicate_window_days: 90,
    max_photos_per_report: 5,
    map_center: { lat: 14.8505, lng: 120.815, zoom: 14 },
    road_type_agency: {},
    public_resolved_days: 90,
  },
  ids: {},
  codeSeq: 0,
};
let sessionUserId = null;

const nextId = (t) => (db.ids[t] = (db.ids[t] || 0) + 1);
const iso = (t) => new Date(t).toISOString();
const nowIso = () => new Date().toISOString();
const byId = (list, id) => list.find((x) => x.id === Number(id));
const userName = (id) => byId(db.users, id)?.full_name ?? null;

function addEvent(reportId, { actor = null, type, from = null, to = null, message = null, isPublic = true, meta = {}, at = nowIso() }) {
  db.events.push({ id: nextId('events'), report_id: reportId, actor_id: actor, event_type: type, from_status: from, to_status: to, message, is_public: isPublic, meta, created_at: at });
}
function notify(userIds, { reportId = null, type, title, body, at = nowIso(), read = false }) {
  for (const uid of new Set(userIds.filter(Boolean))) {
    const u = byId(db.users, uid);
    if (!u || !u.is_active) continue;
    db.notifications.push({ id: nextId('notifications'), user_id: uid, report_id: reportId, type, title, body, read_at: read ? at : null, created_at: at });
  }
}
const adminIds = () => db.users.filter((u) => u.role === 'admin' && u.is_active).map((u) => u.id);
const teamIds = (teamId) => db.users.filter((u) => u.role === 'maintenance' && u.team_id === teamId && u.is_active).map((u) => u.id);
function reporterMessage(code, status, extra = '') {
  const m = {
    under_review: 'An LGU administrator is now reviewing your report.',
    verified: 'Your report was verified. It will be scheduled for repair.',
    assigned: 'A maintenance team has been assigned to your report.',
    in_progress: 'Repair work has started on the reported pothole.',
    resolved: 'The repair was completed and verified. Tell us how it went!',
    rejected: 'Your report could not be accepted.',
    duplicate: 'Your report matches an existing report, which will be tracked instead.',
  };
  return { title: `${code}: ${STATUS_LABELS[status]}`, body: [m[status], extra].filter(Boolean).join(' ') };
}
function addPhoto(report, kind, uploader, at, updateId = null, url = null) {
  const id = nextId('photos');
  const src = url || demoPhoto(kind, `${report.code} · ${kind === 'report' ? 'reported damage' : `${kind} repair`}`);
  db.photos.push({ id, report_id: report.id, uploaded_by: uploader, kind, repair_update_id: updateId, url: src, width: 1200, height: 800, created_at: at });
  return id;
}
function newCode(at = Date.now()) {
  db.codeSeq += 1;
  return `WG-${new Date(at).getFullYear()}-${String(db.codeSeq).padStart(5, '0')}`;
}

// ---------------------------------------------------------------- seed
function seed() {
  const now = Date.now();
  const agencyByJ = {};
  for (const [name, jurisdiction, email, phone] of AGENCIES) {
    const a = { id: nextId('agencies'), name, jurisdiction, contact_email: email, contact_phone: phone, is_active: true, created_at: iso(now - 170 * DAY) };
    db.agencies.push(a);
    agencyByJ[jurisdiction] = a.id;
  }
  db.settings.road_type_agency = {
    national: agencyByJ.national,
    provincial: agencyByJ.provincial,
    city_municipal: agencyByJ.city_municipal,
    barangay: agencyByJ.barangay,
  };
  const teamByName = {};
  for (const name of ['Road Crew Alpha', 'Road Crew Bravo']) {
    const t = { id: nextId('teams'), name, agency_id: agencyByJ.city_municipal, description: 'Demo maintenance team', is_active: true, created_at: iso(now - 165 * DAY) };
    db.teams.push(t);
    teamByName[name] = t.id;
  }
  const userByLocal = {};
  USERS.forEach(([local, name, role, team], i) => {
    const u = {
      id: nextId('users'),
      email: `${local}@${DEMO_DOMAIN}`,
      password: PREVIEW_PASSWORD,
      full_name: name,
      phone: role === 'citizen' ? `0917 555 0${100 + i}` : null,
      role,
      team_id: team ? teamByName[team] : null,
      is_active: true,
      email_notifications: true,
      must_change_password: false,
      last_login_at: iso(now - (i + 1) * 5 * HOUR),
      created_at: iso(now - 160 * DAY),
    };
    db.users.push(u);
    userByLocal[local] = u.id;
  });
  const adminId = userByLocal.admin;

  for (const [i, spec] of REPORTS.entries()) {
    const [who, status, daysAgo, severity, road, brgy, landmark, lat, lng, roadType, hazards, extra = {}] = spec;
    const reporterId = userByLocal[who];
    let t = now - daysAgo * DAY;
    const at = (hours) => {
      t += hours * HOUR;
      return iso(Math.min(t, now - 60_000));
    };
    const created = iso(t);
    const r = {
      id: nextId('reports'),
      code: newCode(t),
      reporter_id: reporterId,
      description: DESCRIPTIONS[severity],
      road_name: road,
      barangay: brgy,
      city: 'Malolos',
      landmark,
      hazards,
      road_type: roadType,
      reported_severity: severity,
      severity,
      status: 'submitted',
      latitude: lat,
      longitude: lng,
      location_source: i % 3 === 0 ? 'map' : 'gps',
      location_accuracy_m: i % 3 === 0 ? null : 6 + (i % 5) * 3,
      agency_id: agencyByJ[roadType] ?? null,
      duplicate_of_id: null,
      rejection_reason: null,
      work_completed_at: null,
      verified_at: null,
      resolved_at: null,
      is_demo: true,
      created_at: created,
      updated_at: created,
    };
    db.reports.push(r);
    addPhoto(r, 'report', reporterId, created);
    if (severity === 'high') addPhoto(r, 'report', reporterId, created);
    addEvent(r.id, { actor: reporterId, type: 'created', to: 'submitted', message: 'Report submitted.', at: created });
    notify(adminIds(), { reportId: r.id, type: 'report_submitted', title: `New report ${r.code}`, body: `${severity[0].toUpperCase()}${severity.slice(1)} severity pothole on ${road}.`, at: created, read: daysAgo > 2 });
    const crew = extra.team === 'Road Crew Bravo' ? userByLocal['crew.bravo'] : userByLocal['crew.alpha'];
    const move = (to, when, message = null, sets = {}) => {
      const from = r.status;
      Object.assign(r, { status: to, updated_at: when }, sets);
      addEvent(r.id, { actor: to === 'in_progress' ? crew : adminId, type: 'status_changed', from, to, message, at: when });
      const note = reporterMessage(r.code, to);
      notify([reporterId], { reportId: r.id, type: 'status_changed', title: note.title, body: message || note.body, at: when, read: new Date(when) < new Date(now - 2 * DAY) });
    };
    const steps = {
      under_review: () => move('under_review', at(3)),
      verified: () => {
        const w = at(4);
        move('verified', w, null, { verified_at: w });
      },
      assigned: () => {
        const w = at(6);
        const due = extra.due !== undefined ? new Date(now + extra.due * DAY).toISOString().slice(0, 10) : null;
        db.assignments.push({ id: nextId('assignments'), report_id: r.id, team_id: teamByName[extra.team], assigned_by: adminId, instructions: 'Inspect, cordon off and patch. Upload before/after photos.', due_date: due, is_active: true, assigned_at: w, ended_at: null, end_reason: null });
        move('assigned', w, `Assigned to ${extra.team}.`);
        notify([crew], { reportId: r.id, type: 'task_assigned', title: `New repair task ${r.code}`, body: `${severity} severity pothole on ${road}.`, at: w });
      },
      in_progress: () => {
        const w = at(20);
        move('in_progress', w);
        const note = 'Site inspected. Area cordoned off with cones; cold mix ordered.';
        const u = { id: nextId('updates'), report_id: r.id, author_id: crew, update_type: 'progress', note, created_at: w };
        db.updates.push(u);
        addPhoto(r, 'before', crew, w, u.id);
        addEvent(r.id, { actor: crew, type: 'repair_progress', message: note, isPublic: false, at: w });
      },
      completed: () => {
        const w = at(extra.resolvedAfter ? Math.max(6, extra.resolvedAfter * 24 - 51) : 30);
        const note = 'Pothole cleaned, filled with hot asphalt and compacted. Road reopened.';
        const u = { id: nextId('updates'), report_id: r.id, author_id: crew, update_type: 'completion', note, created_at: w };
        db.updates.push(u);
        addPhoto(r, 'after', crew, w, u.id);
        Object.assign(r, { work_completed_at: w, updated_at: w });
        addEvent(r.id, { actor: crew, type: 'repair_completed', message: 'Repair work was reported as completed and is awaiting LGU verification.', at: w });
      },
      resolved: () => {
        const w = at(18);
        for (const a of db.assignments) if (a.report_id === r.id && a.is_active) Object.assign(a, { is_active: false, ended_at: w, end_reason: 'completed' });
        move('resolved', w, 'Repair verified by the LGU.', { resolved_at: w });
        if (extra.rating) {
          const f = at(30);
          db.feedback.push({ id: nextId('feedback'), report_id: r.id, user_id: reporterId, rating: extra.rating, comment: extra.comment || null, created_at: f });
          addEvent(r.id, { actor: reporterId, type: 'feedback', message: `Reporter rated the repair ${extra.rating}/5.`, meta: { rating: extra.rating }, at: f });
        }
      },
    };
    const order = ['under_review', 'verified', 'assigned', 'in_progress', 'completed', 'resolved'];
    const last = { submitted: -1, under_review: 0, verified: 1, assigned: 2, in_progress: extra.completed ? 4 : 3, resolved: 5, rejected: 0, duplicate: 0 }[status];
    for (let k = 0; k <= last; k += 1) steps[order[k]]();
    if (status === 'rejected') move('rejected', at(5), `Reason: ${extra.reason}`, { rejection_reason: extra.reason });
    if (status === 'duplicate') {
      const orig = db.reports[extra.duplicateOfIndex];
      move('duplicate', at(5), `It will be tracked under report ${orig.code}.`, { duplicate_of_id: orig.id });
    }
    if (i === 0) addEvent(r.id, { type: 'duplicate_flagged', message: 'System found 1 possible duplicate within 30 m.', isPublic: false, at: created });
  }
  db.audit.push({ id: nextId('audit'), actor_id: adminId, action: 'demo.seed', target_type: 'system', target_id: null, details: { reports: REPORTS.length }, ip: '127.0.0.1', created_at: iso(now - DAY) });
}

// ---------------------------------------------------------------- helpers
function distance(lat1, lng1, lat2, lng2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}
const ROAD_WORDS = new Set(['st', 'street', 'ave', 'avenue', 'rd', 'road', 'hwy', 'highway', 'blvd', 'boulevard', 'dr', 'drive', 'ext', 'extension']);
function tokens(s) {
  const t = String(s || '').toLowerCase().replace(/[^a-z0-9À-ɏ ]+/g, ' ').split(/\s+/).filter(Boolean);
  const m = t.filter((x) => !ROAD_WORDS.has(x));
  return new Set(m.length ? m : t);
}
function similarity(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let c = 0;
  for (const x of A) if (B.has(x)) c += 1;
  return c / new Set([...A, ...B]).size;
}
function candidates({ lat, lng, road, barangay, createdAt = null, excludeId = null, radius, windowDays }) {
  const ref = createdAt ? new Date(createdAt).getTime() : Date.now();
  return db.reports
    .filter((r) => r.id !== excludeId && !['rejected', 'duplicate', 'resolved'].includes(r.status))
    .filter((r) => Math.abs(new Date(r.created_at).getTime() - ref) <= windowDays * DAY)
    .map((r) => ({ r, d: distance(lat, lng, r.latitude, r.longitude) }))
    .filter(({ d }) => d <= radius)
    .map(({ r, d }) => {
      const days = Math.abs(new Date(r.created_at).getTime() - ref) / DAY;
      const score =
        Math.round(
          (0.6 * Math.max(0, 1 - (d / radius) ** 2) +
            0.25 * similarity(road, r.road_name) +
            0.1 * (barangay && r.barangay && barangay.toLowerCase() === r.barangay.toLowerCase() ? 1 : 0) +
            0.05 * Math.max(0, 1 - days / windowDays)) *
            100,
        ) / 100;
      return {
        id: r.id,
        code: r.code,
        status: r.status,
        severity: r.severity,
        road_name: r.road_name,
        barangay: r.barangay,
        landmark: r.landmark,
        created_at: r.created_at,
        latitude: r.latitude,
        longitude: r.longitude,
        distance_m: Math.round(d * 10) / 10,
        score,
        likelihood: score >= 0.7 ? 'high' : score >= 0.45 ? 'medium' : 'low',
      };
    })
    .sort((a, b) => b.score - a.score);
}
const activeAssignment = (reportId) => db.assignments.find((a) => a.report_id === reportId && a.is_active) || null;
const teamHas = (reportId, teamId, activeOnly = false) =>
  Boolean(teamId) && db.assignments.some((a) => a.report_id === reportId && a.team_id === teamId && (!activeOnly || a.is_active));
function photoOut(p) {
  return { id: p.id, kind: p.kind, repair_update_id: p.repair_update_id, width: p.width, height: p.height, created_at: p.created_at, url: p.url, thumb_url: p.url };
}
function firstPhoto(r) {
  const p = db.photos.find((x) => x.report_id === r.id && x.kind === 'report');
  return p ? { url: p.url, thumb_url: p.url } : null;
}
function publicUser(u) {
  if (!u) return null;
  const team = u.team_id ? byId(db.teams, u.team_id) : null;
  return {
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    phone: u.phone,
    role: u.role,
    team_id: u.team_id,
    team_name: team?.name || null,
    email_notifications: u.email_notifications,
    must_change_password: u.must_change_password,
    created_at: u.created_at,
  };
}
function adminUser(u) {
  return { ...publicUser(u), is_active: u.is_active, last_login_at: u.last_login_at, report_count: db.reports.filter((r) => r.reporter_id === u.id).length };
}
function publicShape(r) {
  const { id, code, status, severity, description, road_name, barangay, city, landmark, latitude, longitude, created_at, updated_at, resolved_at, is_demo } = r;
  return { id, code, status, severity, description, road_name, barangay, city, landmark, latitude, longitude, created_at, updated_at, resolved_at, is_demo };
}
function page(list, q, size = 20, max = 100) {
  const p = Math.max(1, Number.parseInt(q.page, 10) || 1);
  const ps = Math.min(max, Math.max(1, Number.parseInt(q.pageSize, 10) || size));
  return { items: list.slice((p - 1) * ps, p * ps), total: list.length, page: p, pageSize: ps };
}
function assertView(user, r) {
  if (user.role === 'admin') return;
  if (user.role === 'citizen' && r.reporter_id === user.id) return;
  if (user.role === 'maintenance' && teamHas(r.id, user.team_id)) return;
  throw notFound('Report not found.');
}
function getReport(id) {
  const r = byId(db.reports, id);
  if (!r) throw notFound('Report not found.');
  return r;
}
function textField(v, min, max, label, required = true) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s && !required) return null;
  if (s.length < min) return { error: min <= 1 ? `${label} is required.` : `${label} must be at least ${min} characters.` };
  if (s.length > max) return { error: `${label} must be at most ${max} characters.` };
  return { value: s };
}

function detail(r, user) {
  assertView(user, r);
  const isAdmin = user.role === 'admin';
  const isStaff = isAdmin || user.role === 'maintenance';
  const agency = r.agency_id ? byId(db.agencies, r.agency_id) : null;
  const dupOf = r.duplicate_of_id ? byId(db.reports, r.duplicate_of_id) : null;
  const photos = db.photos.filter((p) => p.report_id === r.id).map(photoOut);
  const events = db.events
    .filter((e) => e.report_id === r.id && (isStaff || e.is_public))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)
    .map(({ report_id, actor_id, ...e }) => ({ ...e, actor_name: isStaff ? userName(actor_id) : null, actor_role: byId(db.users, actor_id)?.role || null }));
  const assignments = db.assignments
    .filter((a) => a.report_id === r.id)
    .sort((a, b) => b.assigned_at.localeCompare(a.assigned_at))
    .map(({ report_id, assigned_by, ...a }) => ({ ...a, team_name: byId(db.teams, a.team_id)?.name, assigned_by_name: userName(assigned_by) }));
  const active = assignments.find((a) => a.is_active) || null;
  const fb = db.feedback.find((f) => f.report_id === r.id) || null;
  const out = {
    ...r,
    agency: agency ? { id: agency.id, name: agency.name, jurisdiction: agency.jurisdiction, contact_email: agency.contact_email, contact_phone: agency.contact_phone } : null,
    duplicate_of: dupOf ? { id: dupOf.id, code: dupOf.code, status: dupOf.status } : null,
    photos,
    events,
    active_assignment: active ? { team_id: active.team_id, team_name: active.team_name, due_date: active.due_date, assigned_at: active.assigned_at } : null,
    feedback: fb ? { rating: fb.rating, comment: fb.comment, created_at: fb.created_at } : null,
    can_give_feedback: user.role === 'citizen' && r.reporter_id === user.id && r.status === 'resolved' && !fb,
  };
  delete out.reporter_id;
  delete out.duplicate_of_id;
  if (!isAdmin) delete out.agency_id;
  if (isStaff) {
    out.assignments = assignments;
    if (active) out.active_assignment.instructions = active.instructions;
    out.repair_updates = db.updates
      .filter((u) => u.report_id === r.id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((u) => ({ id: u.id, update_type: u.update_type, note: u.note, created_at: u.created_at, author_name: userName(u.author_id), photos: photos.filter((p) => p.repair_update_id === u.id) }));
  }
  if (isAdmin) {
    const rep = byId(db.users, r.reporter_id);
    out.reporter = { id: rep.id, full_name: rep.full_name, email: rep.email, phone: rep.phone, created_at: rep.created_at, report_count: db.reports.filter((x) => x.reporter_id === rep.id).length };
    out.duplicate_candidates = candidates({
      lat: r.latitude,
      lng: r.longitude,
      road: r.road_name,
      barangay: r.barangay,
      createdAt: r.created_at,
      excludeId: r.id,
      radius: db.settings.duplicate_radius_m,
      windowDays: db.settings.duplicate_window_days,
    });
    out.duplicates_of_this = db.reports.filter((x) => x.duplicate_of_id === r.id).map((x) => ({ id: x.id, code: x.code, status: x.status, created_at: x.created_at }));
  }
  if (user.role === 'maintenance') out.is_active_for_my_team = teamHas(r.id, user.team_id, true);
  return out;
}

// ---------------------------------------------------------------- workflow
function assertTransition(r, to, user) {
  if (!TRANSITIONS[r.status]?.[to]?.includes(user.role)) {
    throw conflict(`A report that is "${STATUS_LABELS[r.status]}" cannot be moved to "${STATUS_LABELS[to]}".`, 'invalid_transition');
  }
}
function setStatus(r, to, user, { message = null, publicMessage = null, sets = {}, meta = {} } = {}) {
  const from = r.status;
  Object.assign(r, { status: to, updated_at: nowIso() }, sets);
  addEvent(r.id, { actor: user.id, type: 'status_changed', from, to, message: publicMessage, meta });
  if (message) addEvent(r.id, { actor: user.id, type: 'internal_note', message, isPublic: false });
  const n = reporterMessage(r.code, to, publicMessage || '');
  notify([r.reporter_id], { reportId: r.id, type: 'status_changed', ...n });
}
function crewCanWork(r, user) {
  if (user.role === 'admin') return;
  if (user.role !== 'maintenance') throw new ApiErr(403, 'You do not have permission to do that.', 'forbidden');
  if (!teamHas(r.id, user.team_id, true)) throw notFound('This task is not assigned to your team.');
}

const workflow = {
  review(r, user, b) {
    assertTransition(r, 'under_review', user);
    const note = b.note?.trim();
    if (r.status !== 'submitted' && !note) throw bad('Add a note explaining why this report is being reopened.');
    const reopening = r.status !== 'submitted';
    setStatus(r, 'under_review', user, {
      message: note || null,
      publicMessage: reopening ? 'The report was reopened for another review.' : null,
      sets: reopening ? { rejection_reason: null, duplicate_of_id: null, verified_at: null } : {},
    });
  },
  verify(r, user, b) {
    assertTransition(r, 'verified', user);
    const sets = { verified_at: nowIso() };
    if (b.severity && b.severity !== r.severity) {
      addEvent(r.id, { actor: user.id, type: 'severity_changed', message: `Severity changed from ${r.severity} to ${b.severity} after review.` });
      sets.severity = b.severity;
    }
    if (b.agency_id !== undefined && b.agency_id !== r.agency_id) {
      if (b.agency_id !== null) {
        const a = byId(db.agencies, b.agency_id);
        if (!a || !a.is_active) throw bad('Choose an active responsible agency.');
        addEvent(r.id, { actor: user.id, type: 'agency_set', message: `Responsible agency: ${a.name}.` });
      }
      sets.agency_id = b.agency_id;
    }
    setStatus(r, 'verified', user, { message: b.note || null, sets });
  },
  reject(r, user, b) {
    const reason = textField(b.reason, 5, 500, 'Reason');
    if (reason.error) throw bad('Please check the highlighted fields.', { reason: reason.error });
    assertTransition(r, 'rejected', user);
    setStatus(r, 'rejected', user, { publicMessage: `Reason: ${reason.value}`, sets: { rejection_reason: reason.value } });
  },
  duplicate(r, user, b) {
    assertTransition(r, 'duplicate', user);
    if (Number(b.duplicate_of_id) === r.id) throw bad('A report cannot be a duplicate of itself.');
    const o = byId(db.reports, b.duplicate_of_id);
    if (!o) throw bad('The original report was not found.');
    if (['duplicate', 'rejected'].includes(o.status)) throw bad(`${o.code} is itself ${STATUS_LABELS[o.status].toLowerCase()}; choose the report that is being tracked.`);
    setStatus(r, 'duplicate', user, { message: b.note || null, publicMessage: `It will be tracked under report ${o.code}.`, sets: { duplicate_of_id: o.id } });
    addEvent(o.id, { actor: user.id, type: 'duplicate_linked', message: `${r.code} was linked to this report as a duplicate.`, isPublic: false });
  },
  assign(r, user, b) {
    const team = byId(db.teams, b.team_id);
    if (!team || !team.is_active) throw bad('Choose an active maintenance team.');
    const current = activeAssignment(r.id);
    if (current) {
      if (!['assigned', 'in_progress'].includes(r.status)) throw conflict('Only active work can be reassigned.', 'invalid_transition');
      if (current.team_id === team.id) throw conflict(`This report is already assigned to ${team.name}.`);
      Object.assign(current, { is_active: false, ended_at: nowIso(), end_reason: 'reassigned' });
      notify(teamIds(current.team_id), { reportId: r.id, type: 'assignment_removed', title: `${r.code}: reassigned`, body: 'This task was reassigned to another team. No further work is needed from your team.' });
    } else {
      assertTransition(r, 'assigned', user);
    }
    db.assignments.push({ id: nextId('assignments'), report_id: r.id, team_id: team.id, assigned_by: user.id, instructions: b.instructions || null, due_date: b.due_date || null, is_active: true, assigned_at: nowIso(), ended_at: null, end_reason: null });
    if (current) {
      const from = r.status;
      Object.assign(r, { status: 'assigned', work_completed_at: null, updated_at: nowIso() });
      addEvent(r.id, { actor: user.id, type: 'reassigned', from, to: 'assigned', message: `Reassigned to ${team.name}.` });
    } else {
      setStatus(r, 'assigned', user, { publicMessage: `Assigned to ${team.name}.` });
    }
    notify(teamIds(team.id), {
      reportId: r.id,
      type: 'task_assigned',
      title: `New repair task ${r.code}`,
      body: `${r.severity[0].toUpperCase()}${r.severity.slice(1)} severity pothole on ${r.road_name}${b.due_date ? `, due ${b.due_date}` : ''}.`,
    });
  },
  unassign(r, user, b) {
    assertTransition(r, 'verified', user);
    const current = activeAssignment(r.id);
    if (current) {
      Object.assign(current, { is_active: false, ended_at: nowIso(), end_reason: 'unassigned' });
      notify(teamIds(current.team_id), { reportId: r.id, type: 'assignment_removed', title: `${r.code}: unassigned`, body: 'This task was removed from your team.' });
    }
    setStatus(r, 'verified', user, { message: b.note || null, publicMessage: 'The repair is being rescheduled.' });
  },
  'approve-completion'(r, user, b) {
    assertTransition(r, 'resolved', user);
    if (!r.work_completed_at) throw conflict('The maintenance team has not submitted this repair as completed yet.', 'not_completed');
    if (!db.photos.some((p) => p.report_id === r.id && p.kind === 'after')) throw conflict('A completion photo is required before closing the report.');
    const a = activeAssignment(r.id);
    if (a) {
      Object.assign(a, { is_active: false, ended_at: nowIso(), end_reason: 'completed' });
      notify(teamIds(a.team_id), { reportId: r.id, type: 'completion_approved', title: `${r.code}: repair approved`, body: 'The LGU verified your completed repair and closed the report.' });
    }
    setStatus(r, 'resolved', user, { message: b.note || null, publicMessage: 'Repair verified by the LGU.', sets: { resolved_at: nowIso() } });
  },
  'return-completion'(r, user, b) {
    const reason = textField(b.reason, 5, 1000, 'Reason');
    if (reason.error) throw bad('Please check the highlighted fields.', { reason: reason.error });
    if (r.status !== 'in_progress' || !r.work_completed_at) throw conflict('There is no completed repair waiting for verification.', 'not_completed');
    Object.assign(r, { work_completed_at: null, updated_at: nowIso() });
    addEvent(r.id, { actor: user.id, type: 'completion_returned', message: reason.value, isPublic: false });
    const a = activeAssignment(r.id);
    notify(a ? teamIds(a.team_id) : [], { reportId: r.id, type: 'completion_returned', title: `${r.code}: more work needed`, body: reason.value });
  },
};

function repairUpdate(r, user, type, note, files, kind) {
  crewCanWork(r, user);
  if (!['assigned', 'in_progress'].includes(r.status)) throw conflict('Repair updates can only be added to active work.', 'invalid_transition');
  if (r.work_completed_at && type !== 'progress') throw conflict('This repair is already waiting for LGU verification.');
  if (r.status === 'assigned') setStatus(r, 'in_progress', user);
  const a = activeAssignment(r.id);
  const u = { id: nextId('updates'), report_id: r.id, assignment_id: a?.id ?? null, author_id: user.id, update_type: type, note, created_at: nowIso() };
  db.updates.push(u);
  for (const f of files) addPhoto(r, kind, user.id, u.created_at, u.id, URL.createObjectURL(f));
  if (type === 'completion') {
    Object.assign(r, { work_completed_at: nowIso(), updated_at: nowIso() });
    addEvent(r.id, { actor: user.id, type: 'repair_completed', message: 'Repair work was reported as completed and is awaiting LGU verification.' });
    notify(adminIds(), { reportId: r.id, type: 'completion_submitted', title: `${r.code}: repair ready for verification`, body: `Completion submitted for ${r.road_name}. Review the after photos and close the report.` });
  } else {
    r.updated_at = nowIso();
    addEvent(r.id, { actor: user.id, type: 'repair_progress', message: note, isPublic: false });
  }
}

// ---------------------------------------------------------------- stats
function stats(q) {
  const inRange = (r) => (!q.from || r.created_at >= q.from) && (!q.to || r.created_at.slice(0, 10) <= q.to);
  const rs = db.reports.filter(inRange);
  const count = (f) => rs.filter(f).length;
  const resolved = rs.filter((r) => r.status === 'resolved');
  const avg = resolved.length ? Math.round((resolved.reduce((s, r) => s + (new Date(r.resolved_at) - new Date(r.created_at)) / DAY, 0) / resolved.length) * 10) / 10 : null;
  const now = new Date();
  const monthly = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const same = (v) => v && `${new Date(v).getFullYear()}-${String(new Date(v).getMonth() + 1).padStart(2, '0')}` === key;
    monthly.push({ month: key, reported: db.reports.filter((r) => same(r.created_at)).length, resolved: db.reports.filter((r) => r.status === 'resolved' && same(r.resolved_at)).length });
  }
  const brgy = {};
  for (const r of rs.filter((x) => OPEN.includes(x.status))) brgy[r.barangay || 'Unspecified'] = (brgy[r.barangay || 'Unspecified'] || 0) + 1;
  const fbs = db.feedback.filter((f) => inRange(byId(db.reports, f.report_id)));
  const recent = db.events
    .filter((e) => ['created', 'status_changed', 'repair_completed', 'reassigned', 'feedback'].includes(e.event_type))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    .slice(0, 8)
    .map((e) => ({ id: e.id, event_type: e.event_type, to_status: e.to_status, message: e.message, created_at: e.created_at, report_id: e.report_id, code: byId(db.reports, e.report_id).code, actor_name: userName(e.actor_id) }));
  return {
    generated_at: nowIso(),
    range: { from: q.from || null, to: q.to || null },
    totals: {
      total: rs.length,
      pending_review: count((r) => ['submitted', 'under_review'].includes(r.status)),
      awaiting_assignment: count((r) => r.status === 'verified'),
      active_repairs: count((r) => ['assigned', 'in_progress'].includes(r.status)),
      awaiting_verification: count((r) => r.status === 'in_progress' && r.work_completed_at),
      resolved: resolved.length,
      closed_invalid: count((r) => ['rejected', 'duplicate'].includes(r.status)),
      high_open_over_7_days: count((r) => OPEN.includes(r.status) && r.severity === 'high' && new Date(r.created_at) < new Date(Date.now() - 7 * DAY)),
      avg_resolution_days: avg,
    },
    by_status: Object.fromEntries(Object.keys(STATUS_LABELS).map((s) => [s, count((r) => r.status === s)]).filter(([, n]) => n)),
    by_severity: Object.fromEntries(['low', 'medium', 'high'].map((s) => [s, { total: count((r) => r.severity === s), open: count((r) => r.severity === s && OPEN.includes(r.status)) }])),
    monthly,
    top_barangays: Object.entries(brgy)
      .map(([barangay, open]) => ({ barangay, open }))
      .sort((a, b) => b.open - a.open || a.barangay.localeCompare(b.barangay))
      .slice(0, 8),
    teams: db.teams
      .filter((t) => t.is_active)
      .map((t) => ({
        id: t.id,
        name: t.name,
        active_tasks: db.assignments.filter((a) => a.team_id === t.id && a.is_active).length,
        completed: db.assignments.filter((a) => a.team_id === t.id && a.end_reason === 'completed' && inRange(byId(db.reports, a.report_id))).length,
      })),
    feedback: { count: fbs.length, average: fbs.length ? Math.round((fbs.reduce((s, f) => s + f.rating, 0) / fbs.length) * 100) / 100 : null },
    recent_activity: recent,
    demo_reports: db.reports.filter((r) => r.is_demo).length,
  };
}

// ---------------------------------------------------------------- admin list filters
function adminFilter(q) {
  const statuses = String(q.status || '').split(',').filter(Boolean);
  const sev = String(q.severity || '').split(',').filter(Boolean);
  const text = String(q.q || '').trim().toLowerCase();
  return db.reports.filter((r) => {
    if (statuses.length && !statuses.includes(r.status)) return false;
    if (sev.length && !sev.includes(r.severity)) return false;
    if (text && ![r.code, r.road_name, r.barangay, r.landmark, r.description].some((v) => (v || '').toLowerCase().includes(text))) return false;
    if (q.barangay && (r.barangay || '').toLowerCase() !== String(q.barangay).toLowerCase()) return false;
    if (q.team_id && activeAssignment(r.id)?.team_id !== Number(q.team_id)) return false;
    if (q.agency_id && r.agency_id !== Number(q.agency_id)) return false;
    if (q.from && r.created_at < q.from) return false;
    if (q.to && r.created_at.slice(0, 10) > q.to) return false;
    if (q.awaiting_completion === 'true' && !(r.status === 'in_progress' && r.work_completed_at)) return false;
    return true;
  });
}
const SEV_RANK = { high: 0, medium: 1, low: 2 };
const STATUS_RANK = { submitted: 0, under_review: 1, verified: 2, in_progress: 3, assigned: 4 };
const SORTS = {
  newest: (a, b) => b.created_at.localeCompare(a.created_at),
  oldest: (a, b) => a.created_at.localeCompare(b.created_at),
  updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
  severity: (a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.created_at.localeCompare(b.created_at),
  priority: (a, b) => (STATUS_RANK[a.status] ?? 5) - (STATUS_RANK[b.status] ?? 5) || SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.created_at.localeCompare(b.created_at),
};
function possibleDuplicates(r) {
  return db.reports.filter(
    (o) =>
      o.id !== r.id &&
      !['rejected', 'duplicate', 'resolved'].includes(o.status) &&
      Math.abs(new Date(o.created_at) - new Date(r.created_at)) <= db.settings.duplicate_window_days * DAY &&
      distance(r.latitude, r.longitude, o.latitude, o.longitude) <= db.settings.duplicate_radius_m,
  ).length;
}

function csv(rows) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    let s = Array.isArray(v) ? v.join('; ') : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cols = [['code', 'Report code'], ['status', 'Status'], ['severity', 'Severity'], ['road_name', 'Road'], ['barangay', 'Barangay'], ['landmark', 'Landmark'], ['latitude', 'Latitude'], ['longitude', 'Longitude'], ['created_at', 'Reported at (UTC)'], ['resolved_at', 'Resolved at (UTC)']];
  return [cols.map(([, l]) => cell(l)).join(','), ...rows.map((r) => cols.map(([k]) => cell(k === 'status' ? STATUS_LABELS[r.status] : r[k])).join(','))].join('\r\n');
}

// ---------------------------------------------------------------- routing
function requireUser(roles) {
  const u = byId(db.users, sessionUserId);
  if (!u || !u.is_active) throw new ApiErr(401, 'Please sign in to continue.', 'unauthorized');
  if (roles && !roles.includes(u.role)) throw new ApiErr(403, 'You do not have permission to do that.', 'forbidden');
  return u;
}

function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
}
function validPassword(p) {
  if (typeof p !== 'string' || p.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Password must contain at least one letter and one number.';
  return null;
}

const GAZETTEER = [
  ['Paseo del Congreso, Catmon, Malolos', 14.8436, 120.8113, 'Paseo del Congreso', 'Catmon'],
  ['Barasoain Church, San Gabriel, Malolos', 14.8466, 120.8125, 'Paseo del Congreso', 'San Gabriel'],
  ['MacArthur Highway, Longos, Malolos', 14.8528, 120.8194, 'MacArthur Highway', 'Longos'],
  ['MacArthur Highway, Tikay, Malolos', 14.8596, 120.8281, 'MacArthur Highway', 'Tikay'],
  ['Bulacan State University, Guinhawa, Malolos', 14.8578, 120.8136, 'MacArthur Highway', 'Guinhawa'],
  ['Mabini Street, Santo Niño, Malolos', 14.8419, 120.8095, 'Mabini Street', 'Santo Niño'],
  ['Bulihan Road, Bulihan, Malolos', 14.8697, 120.8241, 'Bulihan Road', 'Bulihan'],
  ['Atlag Road, Atlag, Malolos', 14.8315, 120.8132, 'Atlag Road', 'Atlag'],
];

async function handle(method, path, query, body) {
  let m;
  const me = () => byId(db.users, sessionUserId);

  // ---- public & auth
  if (path === '/api/health') return { status: 'ok', time: nowIso() };
  if (path === '/api/public/config') {
    return {
      lgu_name: db.settings.lgu_name,
      map_center: db.settings.map_center,
      max_photos_per_report: db.settings.max_photos_per_report,
      max_photo_mb: 8,
      duplicate_radius_m: db.settings.duplicate_radius_m,
      tiles: { url: 'preview', attribution: 'Preview basemap. Real OpenStreetMap streets appear in the installed app.', maxZoom: 19, preview: true },
      geocoder_enabled: true,
    };
  }
  if (path === '/api/public/reports') {
    const st = String(query.status || '').split(',').filter((s) => PUBLIC.includes(s));
    const sv = String(query.severity || '').split(',').filter(Boolean);
    const cutoff = Date.now() - db.settings.public_resolved_days * DAY;
    const items = db.reports
      .filter((r) => PUBLIC.includes(r.status) && (r.status !== 'resolved' || new Date(r.resolved_at) >= cutoff))
      .filter((r) => (!st.length || st.includes(r.status)) && (!sv.length || sv.includes(r.severity)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(publicShape);
    return { items };
  }
  if (path === '/api/public/stats') {
    const res = db.reports.filter((r) => r.status === 'resolved');
    return {
      total_reports: db.reports.length,
      resolved: res.length,
      in_repair_pipeline: db.reports.filter((r) => ['verified', 'assigned', 'in_progress'].includes(r.status)).length,
      avg_days_to_resolve: res.length ? Math.round((res.reduce((s, r) => s + (new Date(r.resolved_at) - new Date(r.created_at)) / DAY, 0) / res.length) * 10) / 10 : null,
    };
  }
  if (path === '/api/auth/me') return { user: publicUser(me()?.is_active ? me() : null) };
  if (path === '/api/auth/login' && method === 'POST') {
    const u = db.users.find((x) => x.email === String(body.email || '').trim().toLowerCase());
    if (!u || u.password !== body.password) throw new ApiErr(401, 'Incorrect e-mail or password.', 'invalid_credentials');
    if (!u.is_active) throw new ApiErr(403, 'This account has been deactivated. Contact your LGU administrator.', 'inactive');
    sessionUserId = u.id;
    u.last_login_at = nowIso();
    return { user: publicUser(u) };
  }
  if (path === '/api/auth/register' && method === 'POST') {
    const fields = {};
    const name = textField(body.full_name, 2, 100, 'Full name');
    if (name.error) fields.full_name = name.error;
    if (!validEmail(body.email)) fields.email = 'Enter a valid e-mail address.';
    const pw = validPassword(body.password);
    if (pw) fields.password = pw;
    if (Object.keys(fields).length) throw bad('Please check the highlighted fields.', fields);
    const email = body.email.trim().toLowerCase();
    if (db.users.some((u) => u.email === email)) throw conflict('An account with this e-mail already exists. Try signing in.');
    const u = { id: nextId('users'), email, password: body.password, full_name: name.value, phone: body.phone || null, role: 'citizen', team_id: null, is_active: true, email_notifications: true, must_change_password: false, last_login_at: nowIso(), created_at: nowIso() };
    db.users.push(u);
    sessionUserId = u.id;
    return [201, { user: publicUser(u) }];
  }
  if (path === '/api/auth/logout') {
    sessionUserId = null;
    return { ok: true };
  }
  if (path === '/api/auth/profile' && method === 'PATCH') {
    const u = requireUser();
    if (body.full_name !== undefined) {
      const n = textField(body.full_name, 2, 100, 'Full name');
      if (n.error) throw bad('Please check the highlighted fields.', { full_name: n.error });
      u.full_name = n.value;
    }
    if (body.phone !== undefined) u.phone = body.phone || null;
    if (body.email_notifications !== undefined) u.email_notifications = Boolean(body.email_notifications);
    return { user: publicUser(u) };
  }
  if (path === '/api/auth/change-password' && method === 'POST') {
    const u = requireUser();
    if (u.password !== body.current_password) throw new ApiErr(400, 'Your current password is incorrect.', 'invalid_password');
    const pw = validPassword(body.new_password);
    if (pw) throw bad('Please check the highlighted fields.', { new_password: pw });
    u.password = body.new_password;
    u.must_change_password = false;
    return { user: publicUser(u) };
  }

  // ---- citizen reports
  if (path === '/api/reports' && method === 'POST') {
    const u = requireUser(['citizen']);
    const f = Object.fromEntries([...body.entries()].filter(([, v]) => typeof v === 'string'));
    const files = body.getAll('photos').filter((x) => typeof x !== 'string' && x.size > 0);
    const fields = {};
    const desc = textField(f.description, 10, 2000, 'Description');
    if (desc.error) fields.description = desc.error;
    const road = textField(f.road_name, 2, 150, 'Road or street name');
    if (road.error) fields.road_name = road.error;
    if (!['low', 'medium', 'high'].includes(f.severity)) fields.severity = 'Choose a severity: low, medium or high.';
    const lat = Number(f.latitude);
    const lng = Number(f.longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) fields.latitude = 'Latitude is out of range.';
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) fields.longitude = 'Longitude is out of range.';
    if (Object.keys(fields).length) throw bad('Please check the highlighted fields.', fields);
    if (!files.length) throw bad('Please attach at least one photo.');
    if (files.length > db.settings.max_photos_per_report) throw bad(`You can attach at most ${db.settings.max_photos_per_report} photos.`);
    const recent = db.reports.find((r) => r.reporter_id === u.id && OPEN.includes(r.status) && Date.now() - new Date(r.created_at) < DAY && distance(lat, lng, r.latitude, r.longitude) <= 25);
    if (recent) throw conflict(`You already reported a pothole at this spot today (${recent.code}). You can follow its progress in My Reports.`);
    const created = nowIso();
    const r = {
      id: nextId('reports'),
      code: newCode(),
      reporter_id: u.id,
      description: desc.value,
      road_name: road.value,
      barangay: f.barangay?.trim() || null,
      city: f.city?.trim() || null,
      landmark: f.landmark?.trim() || null,
      hazards: (f.hazards || '').split(',').filter(Boolean),
      road_type: f.road_type || 'unknown',
      reported_severity: f.severity,
      severity: f.severity,
      status: 'submitted',
      latitude: lat,
      longitude: lng,
      location_source: f.location_source || 'map',
      location_accuracy_m: f.location_accuracy_m ? Number(f.location_accuracy_m) : null,
      agency_id: db.settings.road_type_agency[f.road_type] ?? null,
      duplicate_of_id: null,
      rejection_reason: null,
      work_completed_at: null,
      verified_at: null,
      resolved_at: null,
      is_demo: false,
      created_at: created,
      updated_at: created,
    };
    db.reports.push(r);
    for (const file of files) addPhoto(r, 'report', u.id, created, null, URL.createObjectURL(file));
    addEvent(r.id, { actor: u.id, type: 'created', to: 'submitted', message: 'Report submitted.', at: created });
    const c = candidates({ lat, lng, road: r.road_name, barangay: r.barangay, createdAt: created, excludeId: r.id, radius: db.settings.duplicate_radius_m, windowDays: db.settings.duplicate_window_days });
    if (c.length) addEvent(r.id, { type: 'duplicate_flagged', message: `System found ${c.length} possible duplicate${c.length > 1 ? 's' : ''}: ${c.slice(0, 5).map((x) => `${x.code} (${Math.round(x.distance_m)} m)`).join(', ')}.`, isPublic: false });
    notify(adminIds(), { reportId: r.id, type: 'report_submitted', title: `New report ${r.code}`, body: `${r.severity[0].toUpperCase()}${r.severity.slice(1)} severity pothole on ${r.road_name}${c.length ? ` — ${c.length} possible duplicate(s) nearby` : ''}.` });
    return [201, { report: { id: r.id, code: r.code, status: r.status, created_at: r.created_at }, possible_duplicates: c.length }];
  }
  if (path === '/api/reports/mine') {
    const u = requireUser(['citizen']);
    const st = String(query.status || '').split(',').filter(Boolean);
    const mine = db.reports.filter((r) => r.reporter_id === u.id);
    const list = mine
      .filter((r) => !st.length || st.includes(r.status))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
      .map((r) => ({
        id: r.id, code: r.code, status: r.status, severity: r.severity, road_name: r.road_name, barangay: r.barangay, landmark: r.landmark,
        created_at: r.created_at, updated_at: r.updated_at, resolved_at: r.resolved_at, work_completed_at: r.work_completed_at,
        latitude: r.latitude, longitude: r.longitude, is_demo: r.is_demo, has_feedback: db.feedback.some((f) => f.report_id === r.id), photo: firstPhoto(r),
      }));
    const counts = {};
    for (const r of mine) counts[r.status] = (counts[r.status] || 0) + 1;
    return { ...page(list, query), counts };
  }
  if (path === '/api/reports/nearby') {
    requireUser();
    const lat = Number(query.lat);
    const lng = Number(query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw bad('Invalid location.');
    const radius = Math.min(300, Math.max(db.settings.duplicate_radius_m, Number(query.radius) || 100));
    const items = candidates({ lat, lng, road: query.road || '', barangay: null, radius, windowDays: db.settings.duplicate_window_days }).map((c) => ({
      code: c.code, status: c.status, severity: c.severity, road_name: c.road_name, landmark: c.landmark, created_at: c.created_at, distance_m: Math.round(c.distance_m),
    }));
    return { radius_m: radius, items };
  }
  if ((m = path.match(/^\/api\/reports\/(\d+)$/))) {
    const u = requireUser();
    return { report: detail(getReport(m[1]), u) };
  }
  if ((m = path.match(/^\/api\/reports\/(\d+)\/feedback$/)) && method === 'POST') {
    const u = requireUser(['citizen']);
    const r = getReport(m[1]);
    if (r.reporter_id !== u.id) throw notFound('Report not found.');
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw bad('Please check the highlighted fields.', { rating: 'Choose a rating from 1 to 5.' });
    if (r.status !== 'resolved') throw conflict('Feedback can be given once the repair is resolved.');
    if (db.feedback.some((f) => f.report_id === r.id)) throw conflict('You already sent feedback for this report.');
    db.feedback.push({ id: nextId('feedback'), report_id: r.id, user_id: u.id, rating, comment: body.comment || null, created_at: nowIso() });
    addEvent(r.id, { actor: u.id, type: 'feedback', message: `Reporter rated the repair ${rating}/5.`, meta: { rating } });
    notify(adminIds(), { reportId: r.id, type: 'feedback_received', title: `${r.code}: feedback ${rating}/5`, body: body.comment || 'The reporter rated the completed repair.' });
    return [201, { ok: true }];
  }

  // ---- notifications
  if (path === '/api/notifications') {
    const u = requireUser();
    const mine = db.notifications.filter((n) => n.user_id === u.id);
    const list = mine
      .filter((n) => query.unread !== 'true' || !n.read_at)
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
      .map(({ user_id, ...n }) => ({ ...n, report_code: n.report_id ? byId(db.reports, n.report_id)?.code : null }));
    return { ...page(list, query, 20, 50), unread: mine.filter((n) => !n.read_at).length };
  }
  if (path === '/api/notifications/unread-count') {
    const u = requireUser();
    return { unread: db.notifications.filter((n) => n.user_id === u.id && !n.read_at).length };
  }
  if (path === '/api/notifications/read-all') {
    const u = requireUser();
    let n = 0;
    for (const x of db.notifications) if (x.user_id === u.id && !x.read_at) {
      x.read_at = nowIso();
      n += 1;
    }
    return { updated: n };
  }
  if ((m = path.match(/^\/api\/notifications\/(\d+)\/read$/))) {
    const u = requireUser();
    const n = db.notifications.find((x) => x.id === Number(m[1]) && x.user_id === u.id);
    if (n && !n.read_at) n.read_at = nowIso();
    return { ok: true };
  }

  // ---- address search (sample places for the preview)
  if (path === '/api/geo/search') {
    requireUser();
    const q = String(query.q || '').trim().toLowerCase();
    if (q.length < 3) throw bad('Type at least 3 characters to search.');
    const words = q.split(/\s+/);
    const items = GAZETTEER.filter(([label]) => words.every((w) => label.toLowerCase().includes(w))).map(([label, lat, lng, road, brgy]) => ({
      label: `${label}, Bulacan`, latitude: lat, longitude: lng, road_name: road, barangay: brgy, city: 'Malolos',
    }));
    return { items };
  }
  if (path === '/api/geo/reverse') {
    requireUser();
    const lat = Number(query.lat);
    const lng = Number(query.lng);
    let best = null;
    for (const [label, glat, glng, road, brgy] of GAZETTEER) {
      const d = distance(lat, lng, glat, glng);
      if (d < 600 && (!best || d < best.d)) best = { d, label, road, brgy };
    }
    return { result: best ? { label: best.label, road_name: best.road, barangay: best.brgy, city: 'Malolos' } : null };
  }

  // ---- administrator
  if (path.startsWith('/api/admin/')) {
    const u = requireUser(['admin']);
    if (path === '/api/admin/reports') {
      const sort = SORTS[query.sort] || SORTS.priority;
      let list = adminFilter(query);
      const withDup = list.map((r) => ({ r, dups: possibleDuplicates(r) }));
      const filtered = query.has_duplicates === 'true' ? withDup.filter((x) => x.dups > 0) : withDup;
      const items = filtered
        .sort((a, b) => sort(a.r, b.r))
        .map(({ r, dups }) => {
          const a = activeAssignment(r.id);
          return {
            id: r.id, code: r.code, status: r.status, severity: r.severity, reported_severity: r.reported_severity, road_name: r.road_name, barangay: r.barangay,
            city: r.city, landmark: r.landmark, created_at: r.created_at, updated_at: r.updated_at, work_completed_at: r.work_completed_at,
            latitude: r.latitude, longitude: r.longitude, is_demo: r.is_demo, agency_name: byId(db.agencies, r.agency_id)?.name || null,
            team_name: a ? byId(db.teams, a.team_id)?.name : null, possible_duplicates: dups,
            photo_count: db.photos.filter((p) => p.report_id === r.id && p.kind === 'report').length,
          };
        });
      list = items;
      return page(list, query);
    }
    if (path === '/api/admin/map') {
      return {
        items: adminFilter(query).map((r) => ({
          id: r.id, code: r.code, status: r.status, severity: r.severity, road_name: r.road_name, barangay: r.barangay, landmark: r.landmark,
          latitude: r.latitude, longitude: r.longitude, created_at: r.created_at, work_completed_at: r.work_completed_at, is_demo: r.is_demo,
        })),
      };
    }
    if (path === '/api/admin/barangays') {
      const c = {};
      for (const r of db.reports) if (r.barangay) c[r.barangay] = (c[r.barangay] || 0) + 1;
      return { items: Object.entries(c).sort(([a], [b]) => a.localeCompare(b)).map(([barangay, n]) => ({ barangay, n })) };
    }
    if ((m = path.match(/^\/api\/admin\/reports\/(\d+)\/(review|verify|reject|duplicate|assign|unassign|approve-completion|return-completion)$/))) {
      const r = getReport(m[1]);
      workflow[m[2]](r, u, body || {});
      return { ok: true, status: r.status };
    }
    if ((m = path.match(/^\/api\/admin\/reports\/(\d+)$/)) && method === 'PATCH') {
      const r = getReport(m[1]);
      if (['resolved', 'rejected', 'duplicate'].includes(r.status)) throw conflict('Closed reports cannot be edited. Reopen the report first.');
      const changed = [];
      for (const k of ['severity', 'agency_id', 'road_type', 'road_name', 'barangay', 'landmark']) {
        if (body[k] !== undefined && body[k] !== r[k]) {
          r[k] = body[k];
          changed.push(k.replace('_id', '').replace('_', ' '));
        }
      }
      if (changed.length) {
        r.updated_at = nowIso();
        addEvent(r.id, { actor: u.id, type: 'details_updated', message: `Updated ${changed.join(', ')}.`, isPublic: changed.includes('severity') });
      }
      return { ok: true };
    }
    if ((m = path.match(/^\/api\/admin\/reports\/(\d+)\/notes$/))) {
      const r = getReport(m[1]);
      const msg = textField(body.message, 2, 1000, 'Note');
      if (msg.error) throw bad('Please check the highlighted fields.', { message: msg.error });
      addEvent(r.id, { actor: u.id, type: body.is_public ? 'public_note' : 'internal_note', message: msg.value, isPublic: Boolean(body.is_public) });
      if (body.is_public) notify([r.reporter_id], { reportId: r.id, type: 'report_update', title: `${r.code}: update from the LGU`, body: msg.value });
      return [201, { ok: true }];
    }
    if (path === '/api/admin/stats') return stats(query);
    if (path === '/api/admin/users' && method === 'GET') {
      const q = String(query.q || '').toLowerCase();
      const list = db.users
        .filter((x) => (!query.role || x.role === query.role) && (query.status !== 'active' || x.is_active) && (query.status !== 'inactive' || !x.is_active))
        .filter((x) => !q || x.full_name.toLowerCase().includes(q) || x.email.includes(q))
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
        .map(adminUser);
      return page(list, query);
    }
    if (path === '/api/admin/users' && method === 'POST') {
      const fields = {};
      const name = textField(body.full_name, 2, 100, 'Full name');
      if (name.error) fields.full_name = name.error;
      if (!validEmail(body.email)) fields.email = 'Enter a valid e-mail address.';
      const pw = validPassword(body.temporary_password);
      if (pw) fields.temporary_password = pw;
      if (body.role === 'maintenance' && !body.team_id) fields.team_id = 'Maintenance personnel must belong to a team.';
      if (Object.keys(fields).length) throw bad('Please check the highlighted fields.', fields);
      const email = body.email.trim().toLowerCase();
      if (db.users.some((x) => x.email === email)) throw conflict('An account with this e-mail already exists.');
      const nu = { id: nextId('users'), email, password: body.temporary_password, full_name: name.value, phone: body.phone || null, role: body.role, team_id: body.role === 'maintenance' ? body.team_id : null, is_active: true, email_notifications: true, must_change_password: true, last_login_at: null, created_at: nowIso() };
      db.users.push(nu);
      db.audit.push({ id: nextId('audit'), actor_id: u.id, action: 'user.create', target_type: 'user', target_id: String(nu.id), details: { email, role: nu.role }, ip: '127.0.0.1', created_at: nowIso() });
      return [201, { user: adminUser(nu) }];
    }
    if ((m = path.match(/^\/api\/admin\/users\/(\d+)$/))) {
      const t = byId(db.users, m[1]);
      if (!t) throw notFound('User not found.');
      const next = { ...t, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) };
      if (next.role !== 'maintenance') next.team_id = null;
      if (next.role === 'maintenance' && !next.team_id) throw bad('Maintenance personnel must belong to a team.', { team_id: 'Choose a team.' });
      if (t.id === u.id && (next.role !== 'admin' || !next.is_active)) throw conflict('You cannot remove your own administrator access.', 'self_lockout');
      if (t.role === 'admin' && t.is_active && (next.role !== 'admin' || !next.is_active) && !db.users.some((x) => x.id !== t.id && x.role === 'admin' && x.is_active)) {
        throw conflict('At least one active administrator is required.');
      }
      const details = {};
      for (const k of ['full_name', 'phone', 'role', 'team_id', 'is_active']) if (next[k] !== t[k]) details[k] = { from: t[k], to: next[k] };
      Object.assign(t, { full_name: next.full_name, phone: next.phone, role: next.role, team_id: next.team_id, is_active: next.is_active });
      if (Object.keys(details).length) db.audit.push({ id: nextId('audit'), actor_id: u.id, action: 'user.update', target_type: 'user', target_id: String(t.id), details, ip: '127.0.0.1', created_at: nowIso() });
      return { changed: Object.keys(details).length > 0, user: adminUser(t) };
    }
    if ((m = path.match(/^\/api\/admin\/users\/(\d+)\/reset-password$/))) {
      const t = byId(db.users, m[1]);
      if (!t) throw notFound('User not found.');
      if (t.id === u.id) throw bad('Use "Change password" on your profile to change your own password.');
      const pw = validPassword(body.temporary_password);
      if (pw) throw bad('Please check the highlighted fields.', { temporary_password: pw });
      Object.assign(t, { password: body.temporary_password, must_change_password: true });
      db.audit.push({ id: nextId('audit'), actor_id: u.id, action: 'user.reset_password', target_type: 'user', target_id: String(t.id), details: {}, ip: '127.0.0.1', created_at: nowIso() });
      return { ok: true };
    }
    if (path === '/api/admin/teams' && method === 'GET') {
      return {
        items: db.teams.map((t) => ({
          ...t,
          agency_name: byId(db.agencies, t.agency_id)?.name || null,
          member_count: db.users.filter((x) => x.team_id === t.id && x.is_active).length,
          active_tasks: db.assignments.filter((a) => a.team_id === t.id && a.is_active).length,
        })),
      };
    }
    if (path === '/api/admin/agencies' && method === 'GET') {
      return { items: db.agencies.map((a) => ({ ...a, report_count: db.reports.filter((r) => r.agency_id === a.id).length })) };
    }
    if ((m = path.match(/^\/api\/admin\/(teams|agencies)(?:\/(\d+))?$/))) {
      const list = db[m[1]];
      const label = m[1] === 'teams' ? 'Team name' : 'Agency name';
      if (body.name !== undefined) {
        const n = textField(body.name, 2, 120, label);
        if (n.error) throw bad('Please check the highlighted fields.', { name: n.error });
        if (list.some((x) => x.name.toLowerCase() === n.value.toLowerCase() && x.id !== Number(m[2]))) throw conflict('That record already exists.');
        body.name = n.value;
      }
      if (m[2]) {
        const item = byId(list, m[2]);
        if (!item) throw notFound();
        if (m[1] === 'teams' && body.is_active === false && db.assignments.some((a) => a.team_id === item.id && a.is_active)) {
          throw conflict('This team still has active tasks. Reassign them first.');
        }
        Object.assign(item, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)));
        return { ok: true };
      }
      const item = { id: nextId(m[1]), is_active: true, created_at: nowIso(), description: null, agency_id: null, contact_email: null, contact_phone: null, ...body };
      list.push(item);
      db.audit.push({ id: nextId('audit'), actor_id: u.id, action: `${m[1] === 'teams' ? 'team' : 'agency'}.create`, target_type: m[1], target_id: String(item.id), details: { name: item.name }, ip: '127.0.0.1', created_at: nowIso() });
      return [201, { id: item.id }];
    }
    if (path === '/api/admin/settings' && method === 'GET') return { settings: db.settings };
    if (path === '/api/admin/settings' && method === 'PUT') {
      const fields = {};
      if (body.lgu_name !== undefined && String(body.lgu_name).trim().length < 2) fields.lgu_name = 'Enter the LGU name.';
      if (body.duplicate_radius_m !== undefined && !(body.duplicate_radius_m >= 5 && body.duplicate_radius_m <= 500)) fields.duplicate_radius_m = 'Use 5 to 500 metres.';
      if (body.max_photos_per_report !== undefined && !(body.max_photos_per_report >= 1 && body.max_photos_per_report <= 10)) fields.max_photos_per_report = 'Use 1 to 10.';
      if (Object.keys(fields).length) throw bad('Please check the highlighted fields.', fields);
      Object.assign(db.settings, body);
      db.audit.push({ id: nextId('audit'), actor_id: u.id, action: 'settings.update', target_type: 'settings', target_id: null, details: body, ip: '127.0.0.1', created_at: nowIso() });
      return { settings: db.settings };
    }
    if (path === '/api/admin/audit') {
      const list = [...db.audit].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id).map(({ actor_id, ...l }) => ({ ...l, actor_name: userName(actor_id) }));
      return page(list, query, 30);
    }
  }

  // ---- maintenance
  if (path === '/api/maintenance/tasks') {
    const u = requireUser(['maintenance']);
    const scope = query.scope === 'history' ? 'history' : 'active';
    const mine = db.assignments.filter((a) => a.team_id === u.team_id && (scope === 'active' ? a.is_active : !a.is_active));
    const items = mine
      .map((a) => ({ a, r: byId(db.reports, a.report_id) }))
      .sort((x, y) =>
        scope === 'active'
          ? Number(Boolean(x.r.work_completed_at)) - Number(Boolean(y.r.work_completed_at)) || (x.a.due_date || '9999').localeCompare(y.a.due_date || '9999') || SEV_RANK[x.r.severity] - SEV_RANK[y.r.severity]
          : (y.a.ended_at || '').localeCompare(x.a.ended_at || ''),
      )
      .map(({ a, r }) => ({
        id: r.id, code: r.code, status: r.status, severity: r.severity, road_name: r.road_name, barangay: r.barangay, landmark: r.landmark, description: r.description,
        latitude: r.latitude, longitude: r.longitude, work_completed_at: r.work_completed_at, resolved_at: r.resolved_at, is_demo: r.is_demo,
        assigned_at: a.assigned_at, due_date: a.due_date, instructions: a.instructions, ended_at: a.ended_at, end_reason: a.end_reason, photo: firstPhoto(r),
      }));
    const active = db.assignments.filter((a) => a.team_id === u.team_id && a.is_active).map((a) => byId(db.reports, a.report_id));
    return {
      team: { id: u.team_id, name: byId(db.teams, u.team_id)?.name },
      scope,
      counts: {
        assigned: active.filter((r) => r.status === 'assigned').length,
        in_progress: active.filter((r) => r.status === 'in_progress' && !r.work_completed_at).length,
        awaiting_verification: active.filter((r) => r.work_completed_at).length,
      },
      ...page(items, query, 50),
    };
  }
  if ((m = path.match(/^\/api\/maintenance\/tasks\/(\d+)\/(start|updates|complete)$/)) && method === 'POST') {
    const u = requireUser(['maintenance']);
    const r = getReport(m[1]);
    if (m[2] === 'start') {
      crewCanWork(r, u);
      assertTransition(r, 'in_progress', u);
      setStatus(r, 'in_progress', u, { message: body.note || null });
      return { ok: true, status: r.status };
    }
    const note = textField(body.get('note'), 3, 2000, m[2] === 'complete' ? 'Repair notes' : 'Note');
    if (note.error) throw bad('Please check the highlighted fields.', { note: note.error });
    const files = body.getAll('photos').filter((x) => typeof x !== 'string' && x.size > 0);
    if (m[2] === 'complete' && !files.length) throw bad('Please attach at least one photo.');
    if (files.length > 6) throw bad('You can attach at most 6 photos.');
    repairUpdate(r, u, m[2] === 'complete' ? 'completion' : 'progress', note.value, files, m[2] === 'complete' ? 'after' : body.get('photo_kind') || 'progress');
    return [201, { ok: true, status: r.status }];
  }

  throw notFound('API endpoint not found.');
}

// ---------------------------------------------------------------- install
export function exportCsv(params) {
  return csv(adminFilter(params));
}

// Preview only: a route for the simulated drive. It heads north towards an
// open, verified high-severity demo report and carries on past it.
export function demoDriveRoute() {
  const target =
    db.reports.find((r) => r.severity === 'high' && ['verified', 'assigned', 'in_progress'].includes(r.status)) ||
    db.reports.find((r) => PUBLIC.includes(r.status));
  if (!target) return [];
  const pts = [];
  // ~13 m per step (about 47 km/h at one step every second)
  for (let i = -45; i <= 20; i += 1) pts.push({ lat: target.latitude + i * 0.000117, lng: target.longitude + i * 0.00002 });
  return pts;
}

export function signInAs(email) {
  const u = db.users.find((x) => x.email === email);
  if (u) sessionUserId = u.id;
  return publicUser(u);
}

export function installMockServer() {
  seed();
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = (init.method || 'GET').toUpperCase();
    let body = init.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    const query = Object.fromEntries(url.searchParams);
    // Simulate a little network latency so loading states are visible.
    await new Promise((r) => setTimeout(r, 120));
    try {
      if (method !== 'GET' && init.headers?.['X-Wayguard-CSRF'] !== '1') throw new ApiErr(403, 'Request blocked by CSRF protection.', 'csrf');
      const out = await handle(method, url.pathname, query, body ?? {});
      const [status, data] = Array.isArray(out) ? out : [200, out];
      return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      const status = err instanceof ApiErr ? err.status : 500;
      if (!(err instanceof ApiErr)) console.error('[preview api]', err);
      return new Response(
        JSON.stringify({ error: { code: err.code || 'server_error', message: err instanceof ApiErr ? err.message : 'Something went wrong in the preview.', fields: err.fields } }),
        { status, headers: { 'Content-Type': 'application/json' } },
      );
    }
  };
}
